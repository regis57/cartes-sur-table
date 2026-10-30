/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { Server, type Namespace, type Socket } from 'socket.io';
import {
  Table, Matchmaking, PrivateTables, ProfileStore, pickBotNames, AVATAR_COUNT, VERSION,
  securityHeaders, httpRateLimit, isOriginAllowed, getClientIp, createRateLimiter, sanitizeName,
  isValidTableId, isValidInviteCode, isValidProfileToken, isValidRejoinKey, isPlainObject, isSmallInt,
  ChallengeStore, verifyRegistration, verifyAssertion, isB64url, b64urlEncode, ALG_ES256, ALG_RS256,
  type Seat, type Outbox, type LobbyEntry, type RegisteredGame, type RoundEndInfo, type BotLevel, type ClientToServer, type ServerToClient,
} from '@jdc/core';
import { loadConfig, type Config } from './config.ts';
import { GAMES, SOON } from './games.ts';
import { createBotPool } from './bot-pool.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIR = path.resolve(here, '../../client/public');

interface SocketData {
  ip: string;
  profile: { id: string; pseudo: string; avatar: number } | null;
  tableId: string | null;
  inQueue: boolean;
  privateCode: string | null;
}

type GameSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

export interface AppHandle {
  app: express.Express;
  httpServer: http.Server;
  io: Server;
  store: ProfileStore;
  cfg: Config;
  tables: Map<string, Table<unknown, unknown, unknown>>;
  start(): Promise<{ address: string; port: number }>;
  close(): Promise<void>;
}

export function createApp(overrides: Partial<Config> = {}): AppHandle {
  const cfg: Config = { ...loadConfig(), ...overrides };
  const store = new ProfileStore(cfg.databasePath);
  const tables = new Map<string, Table<unknown, unknown, unknown>>();
  // Les fils de calcul des bots ne se lancent qu'à la première demande d'un bot.
  const botPool = cfg.botWorkers > 0 ? createBotPool({ size: cfg.botWorkers }) : null;

  // ---------- HTTP ----------

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'weak');
  app.use(securityHeaders({ hsts: true }));
  app.use(httpRateLimit({ windowMs: 60_000, max: cfg.httpMaxPerMinute, trust: cfg.trustProxy }));

  // Derrière Cloudflare, une arrivée en clair est renvoyée vers HTTPS (le tunnel dit le protocole d'origine).
  app.use((req, res, next) => {
    if (cfg.publicOrigin && req.path !== '/healthz' && req.headers['x-forwarded-proto'] === 'http') {
      res.redirect(301, cfg.publicOrigin + req.originalUrl);
      return;
    }
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  const api = express.Router();
  // `inflate: false` : aucun navigateur ne compresse ce qu'il envoie, et un corps compressé est la
  // porte d'entrée des attaques par décompression (la faille de body-parser GHSA-27r3-jxmh-p828).
  api.use(express.json({ limit: '4kb', strict: true, inflate: false }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/version', (_req, res) => {
    res.json({ version: process.env['APP_VERSION'] || VERSION, revision: process.env['APP_REVISION'] || 'dev', builtAt: process.env['APP_BUILT_AT'] || null });
  });

  api.get('/jeux', (_req, res) => {
    res.json({ games: [...GAMES.map((g) => g.meta), ...SOON], avatars: AVATAR_COUNT });
  });

  /** Jeton porté par l'en-tête Authorization : jamais dans l'URL (journaux), jamais en cookie (CSRF). */
  function bearer(req: Request): string | null {
    const h = req.headers.authorization;
    if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
    const t = h.slice(7).trim();
    return isValidProfileToken(t) ? t : null;
  }

  // Création de profil : écriture durable, donc limite propre et basse (par IP, par heure).
  api.post('/profil', httpRateLimit({ windowMs: 3_600_000, max: 10, trust: cfg.trustProxy }), (req, res) => {
    const body: unknown = req.body;
    if (!isPlainObject(body) || !isValidProfileToken(body['token'])) {
      res.status(400).json({ error: 'jeton-invalide' });
      return;
    }
    const p = store.create(body['token'], body['pseudo'], body['avatar']);
    if (!p) {
      res.status(409).json({ error: 'jeton-deja-utilise' });
      return;
    }
    res.status(201).json({ profile: p, stats: [], achievements: [] });
  });

  api.get('/profil', (req, res) => {
    const t = bearer(req);
    const p = t ? store.getByToken(t) : null;
    if (!p) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    res.json(store.export(p.id));
  });

  api.patch('/profil', (req, res) => {
    const t = bearer(req);
    const p = t ? store.getByToken(t) : null;
    const body: unknown = req.body;
    if (!p || !isPlainObject(body)) {
      res.status(p ? 400 : 401).json({ error: p ? 'requete-invalide' : 'profil-inconnu' });
      return;
    }
    const changes: { pseudo?: unknown; avatar?: unknown } = {};
    if ('pseudo' in body) changes.pseudo = body['pseudo'];
    if ('avatar' in body) changes.avatar = body['avatar'];
    res.json({ profile: store.update(p.id, changes) });
  });

  /** Droit d'accès et portabilité : tout, en JSON, à télécharger. */
  api.get('/profil/export', (req, res) => {
    const t = bearer(req);
    const p = t ? store.getByToken(t) : null;
    if (!p) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    res.setHeader('Content-Disposition', 'attachment; filename="mon-profil-jeuxdecartes.json"');
    res.json({ exportedAt: new Date().toISOString(), ...store.export(p.id) });
  });

  // ---------- passkeys ----------
  // Le serveur ne garde que la clé publique. Le domaine (rpId) et l'origine attendue
  // viennent de PUBLIC_ORIGIN ; sans lui (développement), de l'hôte demandé.

  const challenges = new ChallengeStore();
  // En production sans PUBLIC_ORIGIN, aucune passkey : le domaine attendu ne doit jamais
  // être tiré des en-têtes de la requête (c'est ce que promettent le bilan et le guide).
  const passkeysOff = cfg.production && !cfg.publicOrigin;
  api.use('/passkeys', (_req, res, next) => {
    if (passkeysOff) {
      res.status(503).json({ error: 'passkeys-indisponibles' });
      return;
    }
    next();
  });
  const rpOf = (req: Request): { rpId: string; origins: string[] } => {
    if (cfg.publicOrigin) return { rpId: new URL(cfg.publicOrigin).hostname, origins: [cfg.publicOrigin, ...cfg.allowedOrigins] };
    const host = String(req.headers.host ?? 'localhost');
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
    return { rpId: host.replace(/:\d+$/, ''), origins: [`${proto}://${host}`] };
  };
  const profileOf = (req: Request): { id: string; pseudo: string; avatar: number } | null => {
    const t = bearer(req);
    return t ? store.getByToken(t) : null;
  };
  const passkeyLimit = httpRateLimit({ windowMs: 3_600_000, max: 30, trust: cfg.trustProxy });

  api.post('/passkeys/options', passkeyLimit, (req, res) => {
    const p = profileOf(req);
    if (!p) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    const { rpId } = rpOf(req);
    res.json({
      challenge: challenges.issue(p.id),
      rp: { id: rpId, name: 'Cartes sur table' },
      user: { id: b64urlEncode(Buffer.from(p.id, 'hex')), name: p.pseudo, displayName: p.pseudo },
      pubKeyCredParams: [{ type: 'public-key', alg: ALG_ES256 }, { type: 'public-key', alg: ALG_RS256 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      attestation: 'none',
      timeout: 120_000,
      excludeCredentials: store.passkeys(p.id).map((k) => ({ type: 'public-key', id: k.id })),
    });
  });

  // Note : CodeQL (js/missing-rate-limiting) ne reconnaît que quelques bibliothèques de
  // limitation et signale ces deux routes ; `passkeyLimit` (30/h/IP) et la limite globale
  // de l'application s'y appliquent pourtant. Alertes à rejeter comme faux positifs.
  api.post('/passkeys', passkeyLimit, (req, res) => {
    const p = profileOf(req);
    const body: unknown = req.body;
    if (!p || !isPlainObject(body)) {
      res.status(p ? 400 : 401).json({ error: p ? 'requete-invalide' : 'profil-inconnu' });
      return;
    }
    const { rpId, origins } = rpOf(req);
    try {
      const reg = verifyRegistration({ rawId: body['rawId'], clientDataJSON: body['clientDataJSON'], attestationObject: body['attestationObject'] }, rpId, origins);
      const ch = challenges.consume(reg.challenge);
      if (!ch || ch.profileId !== p.id) {
        res.status(400).json({ error: 'defi-invalide' });
        return;
      }
      const added = store.addPasskey(p.id, { id: reg.credentialId, publicKeyPem: reg.publicKeyPem, alg: reg.alg, signCount: reg.signCount, name: body['name'] ?? 'Passkey' });
      if (!added) {
        res.status(409).json({ error: 'passkey-refusee' });
        return;
      }
      res.status(201).json({ passkey: added });
    } catch (err) {
      res.status(400).json({ error: 'enregistrement-invalide', detail: err instanceof Error ? err.message : 'erreur' });
    }
  });

  api.delete('/passkeys/:id', (req, res) => {
    const p = profileOf(req);
    if (!p) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    const id = req.params['id'];
    const deleted = isB64url(id) ? store.deletePasskey(p.id, id) : false;
    res.status(deleted ? 200 : 404).json({ deleted });
  });

  api.post('/passkeys/auth/options', passkeyLimit, (req, res) => {
    const { rpId } = rpOf(req);
    res.json({ challenge: challenges.issue(null), rpId, allowCredentials: [], userVerification: 'preferred', timeout: 120_000 });
  });

  /** Authentification par passkey : rend un jeton de session, à garder comme un jeton de profil. */
  api.post('/passkeys/auth', passkeyLimit, (req, res) => {
    const body: unknown = req.body;
    if (!isPlainObject(body) || !isB64url(body['rawId'])) {
      res.status(400).json({ error: 'requete-invalide' });
      return;
    }
    const key = store.findPasskey(body['rawId']);
    if (!key) {
      res.status(401).json({ error: 'passkey-inconnue' });
      return;
    }
    const { rpId, origins } = rpOf(req);
    try {
      const ok = verifyAssertion(
        { rawId: body['rawId'], clientDataJSON: body['clientDataJSON'], authenticatorData: body['authenticatorData'], signature: body['signature'] },
        key.publicKeyPem, key.alg, key.signCount, rpId, origins,
      );
      const ch = challenges.consume(ok.challenge);
      if (!ch) {
        res.status(400).json({ error: 'defi-invalide' });
        return;
      }
      store.touchPasskey(ok.credentialId, ok.signCount);
      const token = store.createSession(key.profileId);
      if (!token) {
        res.status(401).json({ error: 'profil-inconnu' });
        return;
      }
      res.json({ token, ...store.export(key.profileId) });
    } catch (err) {
      res.status(401).json({ error: 'authentification-invalide', detail: err instanceof Error ? err.message : 'erreur' });
    }
  });

  /** Déconnecte tous les appareils entrés par passkey (le jeton d'origine reste valable). */
  api.post('/profil/sessions/revoke', (req, res) => {
    const p = profileOf(req);
    if (!p) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    res.json({ revoked: store.revokeSessions(p.id) });
  });

  /** Droit à l'effacement : immédiat, réel, sans question. */
  api.delete('/profil', (req, res) => {
    const t = bearer(req);
    if (!t) {
      res.status(401).json({ error: 'profil-inconnu' });
      return;
    }
    const p = store.getByToken(t);
    const deleted = p ? store.delete(p.id) : false;
    res.status(deleted ? 200 : 404).json({ deleted });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'introuvable' });
  });
  app.use('/api', api);

  app.use(
    express.static(CLIENT_DIR, {
      dotfiles: 'ignore',
      index: 'index.html',
      extensions: ['html'],
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        // L'agent de service pilote tout le site : il doit pouvoir sortir de son dossier,
        // et ne jamais rester en cache, sinon une version corrigée n'arriverait jamais.
        if (filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
        }
      },
    }),
  );
  // La page 404 est lue une fois au démarrage : rien n'est lu sur disque à la demande.
  let notFoundPage = 'Introuvable';
  try {
    notFoundPage = readFileSync(path.join(CLIENT_DIR, '404.html'), 'utf8');
  } catch {
    /* client non construit : texte brut */
  }
  app.use((_req, res) => {
    res.status(404).type(notFoundPage.startsWith('<') ? 'html' : 'text/plain').send(notFoundPage);
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = isPlainObject(err) && typeof err['status'] === 'number' ? (err['status'] as number) : 500;
    if (status >= 500) console.error('[http]', err instanceof Error ? err.message : err);
    res.status(status).type('text/plain').send(status >= 500 ? 'Erreur interne' : 'Requête refusée');
  });

  const httpServer = http.createServer(app);
  httpServer.requestTimeout = 15_000;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 5_000;

  // ---------- Socket.io ----------

  const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: 4096,
    connectTimeout: 10_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    serveClient: true,
    allowRequest: (req, cb) => cb(null, isOriginAllowed(req.headers.origin, req.headers.host, cfg.allowedOrigins)),
  });

  // Socket.io répond lui-même à `/socket.io/` (fichier client, interrogation longue), avant
  // Express : sans ceci, ces réponses partiraient sans aucun des en-têtes de sécurité. Cet
  // écouteur passe devant celui de Socket.io (d'où sa place après la création du serveur),
  // et les en-têtes sont posés avant, qu'Engine.IO fusionne avec les siens en écrivant la réponse.
  const enTetesSocketIo = securityHeaders({ hsts: true });
  httpServer.prependListener('request', (req, res) => {
    if (req.url?.startsWith('/socket.io/')) enTetesSocketIo(req, res, () => undefined);
  });

  const connectionsPerIp = new Map<string, number>();

  // L'espace de noms par défaut « / » n'a aucun usage : refusé, pour qu'il ne serve pas
  // à contourner les limites des espaces de jeu.
  io.of('/').use((_socket, next) => next(new Error('forbidden')));

  for (const game of GAMES) mountGame(game);

  function mountGame(game: RegisteredGame): void {
    const nsp: Namespace<ClientToServer, ServerToClient, Record<string, never>, SocketData> = io.of(`/jeu/${game.meta.id}`);
    const defaultSeats = game.def.seatCounts[0] as number;
    const privateTables = new PrivateTables();

    const matchmaking = new Matchmaking(defaultSeats, cfg.matchmakingSeconds, {
      launch: (entries) => launchTable('online', entries, defaultSeats, 'normal'),
      status: (entries, countdown) => {
        for (const e of entries) nsp.to(e.humanId).emit('queueStatus', { players: entries.map((x) => ({ name: x.name, avatar: x.avatar })), countdown });
      },
    });

    // La table parle en événements génériques ; ici, à la frontière du réseau, ils
    // prennent le type du protocole (les noms sont ceux de ServerToClient).
    const outbox = (tableId: string, seats: () => readonly Seat[]): Outbox => ({
      toSeat: (seat, event, payload) => {
        const h = seats()[seat]?.humanId;
        if (h) nsp.to(h).emit(event as keyof ServerToClient, payload as never);
      },
      toAll: (event, payload) => nsp.to(tableId).emit(event as keyof ServerToClient, payload as never),
    });

    // Les succès d'une manche (« huit magique », « capot »…) s'inscrivent à la fin de chaque
    // manche : n'enregistrer qu'à la fin de la partie perdait tous ceux des manches d'avant.
    // La partie elle-même (statistiques, succès communs) s'inscrit à la fin de la partie.
    function onRoundEnd(info: RoundEndInfo): void {
      info.seats.forEach((s, i) => {
        if (s.isBot || !s.profileId) return;
        const propres = info.achievements[i] ?? [];
        const fresh = info.matchOver
          ? store.recordMatch(s.profileId, game.meta.id, { won: info.winners.includes(i), rounds: info.round, gameAchievements: propres })
          : store.unlock(s.profileId, propres.map((c) => `${game.meta.id}:${c}`));
        if (fresh.length > 0 && s.humanId) nsp.to(s.humanId).emit('achievements', { codes: fresh });
      });
    }

    function launchTable(prefix: 'solo' | 'online' | 'private', entries: LobbyEntry[], seatCount: number, botLevel: BotLevel): void {
      const humans = entries.flatMap((e) => {
        const sock = nsp.sockets.get(e.humanId);
        return sock ? [{ e, sock }] : [];
      });
      if (humans.length === 0) return;
      if (tables.size >= cfg.maxTables) {
        for (const { sock } of humans) {
          sock.data.inQueue = false;
          sock.data.privateCode = null;
          sock.emit('serverBusy');
        }
        return;
      }
      const tableId = Table.newId(prefix);
      const seats: Seat[] = humans.map(({ e }) => ({
        name: e.name, avatar: e.avatar, isBot: false, humanId: e.humanId, rejoinKey: Table.newRejoinKey(), rejoinDeadline: null, profileId: e.profileId,
      }));
      const botNames = pickBotNames(seatCount - seats.length, seats.map((s) => s.name));
      for (const name of botNames) seats.push({ name, avatar: (name.length + seats.length) % AVATAR_COUNT, isBot: true, humanId: null, rejoinKey: null, rejoinDeadline: null, profileId: null });
      const table = new Table(tableId, game.def, seats, outbox(tableId, () => seats), {
        botLevel,
        botThinkMs: cfg.botThinkMs,
        ...(botPool ? { botEngine: botPool } : {}),
        rejoinGraceMs: cfg.rejoinGraceMs,
        ...(cfg.timings ? { timings: cfg.timings } : {}),
        onDestroy: (t) => {
          tables.delete(t.id);
          // Prévenir d'abord : une fois les connexions retirées du salon, l'annonce n'atteint plus personne.
          nsp.to(t.id).emit('tableClosed', { tableId: t.id });
          for (const s of t.seats) {
            const sock = s.humanId ? nsp.sockets.get(s.humanId) : undefined;
            if (sock) {
              sock.leave(t.id);
              sock.data.tableId = null;
            }
          }
        },
        onRoundEnd,
        onHumanReleased: (humanId, id) => {
          const sock = nsp.sockets.get(humanId);
          if (sock && sock.data.tableId === id) {
            sock.leave(id);
            sock.data.tableId = null;
          }
        },
      });
      tables.set(tableId, table as unknown as Table<unknown, unknown, unknown>);
      humans.forEach(({ sock }, i) => {
        sock.data.inQueue = false;
        sock.data.privateCode = null;
        sock.data.tableId = tableId;
        sock.join(tableId);
        sock.emit('seat', { tableId, seat: i, rejoinKey: seats[i]?.rejoinKey ?? null });
      });
      table.start();
    }

    /** Une table privée disparaît (hôte parti, attente trop longue) : ses membres sont libérés et prévenus. */
    function dissolve(humanIds: readonly string[], code: string): void {
      for (const id of humanIds) {
        const s = nsp.sockets.get(id);
        if (s && s.data.privateCode === code) {
          s.data.privateCode = null;
          s.emit('privateDissolved', { code });
        }
      }
    }

    function sweepPrivate(): void {
      for (const t of privateTables.sweep()) dissolve(t.entries.map((e) => e.humanId), t.code);
    }

    function privateStatus(code: string): void {
      const pending = [...nsp.sockets.values()].filter((s) => s.data.privateCode === code);
      for (const s of pending) {
        const p = privateTables.findByHuman(s.id);
        if (!p) continue;
        s.emit('privateStatus', { code: p.code, seats: p.seats, isHost: p.hostId === s.id, players: p.entries.map((e) => ({ name: e.name, avatar: e.avatar })) });
      }
    }

    nsp.use((socket, next) => {
      const ip = getClientIp(socket.request, cfg.trustProxy);
      if ((connectionsPerIp.get(ip) ?? 0) >= cfg.maxConnPerIp) {
        next(new Error('too_many_connections'));
        return;
      }
      // La place est prise ici, au moment même du contrôle, et rendue à la fermeture de la
      // connexion : compter plus tard (à l'événement « connection ») laissait passer d'un
      // coup des dizaines de demandes groupées dans une seule requête.
      connectionsPerIp.set(ip, (connectionsPerIp.get(ip) ?? 0) + 1);
      let rendue = false;
      const rendre = (): void => {
        if (rendue) return;
        rendue = true;
        const left = (connectionsPerIp.get(ip) ?? 1) - 1;
        if (left <= 0) connectionsPerIp.delete(ip);
        else connectionsPerIp.set(ip, left);
      };
      socket.once('disconnect', rendre);
      socket.conn.once('close', rendre);
      socket.data.ip = ip;
      socket.data.profile = null;
      socket.data.tableId = null;
      socket.data.inQueue = false;
      socket.data.privateCode = null;
      const auth: unknown = socket.handshake.auth;
      if (isPlainObject(auth) && isValidProfileToken(auth['token'])) {
        const p = store.getByToken(auth['token']);
        if (p) socket.data.profile = { id: p.id, pseudo: p.pseudo, avatar: p.avatar };
      }
      next();
    });

    nsp.on('connection', (socket: GameSocket) => {

      const allow = createRateLimiter({ capacity: cfg.rateBurst, refillPerSec: cfg.ratePerSec });
      let violations = 0;
      socket.use((_packet, next) => {
        if (allow()) {
          next();
          return;
        }
        violations += 1;
        if (violations >= cfg.rateBurst) socket.disconnect(true);
        next(new Error('rate_limited'));
      });

      const on = <E extends keyof ClientToServer>(event: E, handler: (data: unknown) => void): void => {
        const listener = (...args: unknown[]): void => {
          try {
            handler(args[0]);
          } catch (err) {
            console.error(`[socket] ${event} :`, err instanceof Error ? err.message : err);
          }
        };
        // Le typage de Socket.io exige la signature exacte de l'événement ; notre
        // écouteur générique reçoit `unknown` et revalide tout, ce qui est plus strict.
        (socket as unknown as { on(ev: string, fn: (...a: unknown[]) => void): void }).on(event, listener);
      };

      /** Qui joue : le profil s'il y en a un, sinon ce que l'invité déclare (assaini, jamais stocké). */
      const identity = (data: unknown): LobbyEntry => {
        const p = socket.data.profile;
        if (p) return { humanId: socket.id, name: p.pseudo, avatar: p.avatar, profileId: p.id };
        const d = isPlainObject(data) ? data : {};
        return { humanId: socket.id, name: sanitizeName(d['name']), avatar: isSmallInt(d['avatar'], 0, AVATAR_COUNT) ? d['avatar'] : 0, profileId: null };
      };

      const free = (): boolean => !socket.data.tableId && !socket.data.inQueue && !socket.data.privateCode;

      const myTable = (data: unknown): { table: Table<unknown, unknown, unknown>; seat: number } | null => {
        if (!isPlainObject(data) || !isValidTableId(data['tableId']) || data['tableId'] !== socket.data.tableId) return null;
        const table = tables.get(data['tableId']);
        if (!table) return null;
        const seat = table.seats.findIndex((s) => !s.isBot && s.humanId === socket.id);
        return seat === -1 ? null : { table, seat };
      };

      on('solo', (data) => {
        if (!free()) return;
        const d = isPlainObject(data) ? data : {};
        const level: BotLevel = d['level'] === 'facile' ? 'facile' : 'normal';
        const seatCount = isSmallInt(d['seats'], 2, 9) && game.def.seatCounts.includes(d['seats']) ? d['seats'] : defaultSeats;
        launchTable('solo', [identity(data)], seatCount, level);
      });

      on('joinQueue', (data) => {
        if (!free()) return;
        socket.data.inQueue = true;
        matchmaking.join(identity(data));
      });

      on('leaveQueue', () => {
        if (!socket.data.inQueue) return;
        socket.data.inQueue = false;
        matchmaking.leave(socket.id);
      });

      on('forceStart', () => {
        if (socket.data.inQueue) matchmaking.forceStart(socket.id);
      });

      on('createPrivate', (data) => {
        sweepPrivate();
        if (!free()) return;
        const d = isPlainObject(data) ? data : {};
        const seatCount = isSmallInt(d['seats'], 2, 9) && game.def.seatCounts.includes(d['seats']) ? d['seats'] : defaultSeats;
        const t = privateTables.create(game.meta.id, seatCount, identity(data));
        if (!t) {
          socket.emit('serverBusy');
          return;
        }
        socket.data.privateCode = t.code;
        privateStatus(t.code);
      });

      on('joinPrivate', (data) => {
        sweepPrivate();
        if (!free() || !isPlainObject(data)) return;
        const code = typeof data['code'] === 'string' ? data['code'].toUpperCase() : '';
        if (!isValidInviteCode(code)) {
          socket.emit('error', { code: 'code-invalide' });
          return;
        }
        const t = privateTables.join(code, identity(data));
        if (!t) {
          socket.emit('error', { code: 'table-introuvable' });
          return;
        }
        socket.data.privateCode = t.code;
        privateStatus(t.code);
      });

      on('leavePrivate', () => {
        const code = socket.data.privateCode;
        if (!code) return;
        const r = privateTables.leave(socket.id);
        socket.data.privateCode = null;
        if (!r) return;
        if (r.dissolved) dissolve(r.table.entries.map((e) => e.humanId), code);
        else privateStatus(code);
      });

      on('startPrivate', () => {
        sweepPrivate();
        const code = socket.data.privateCode;
        if (!code) return;
        const t = privateTables.start(code, socket.id);
        if (!t) {
          // La table n'existe plus (expirée) : l'appelant ne doit pas rester bloqué dans l'attente.
          if (!privateTables.findByHuman(socket.id)) dissolve([socket.id], code);
          return;
        }
        launchTable('private', t.entries, t.seats, 'normal');
      });

      on('move', (data) => {
        const found = myTable(data);
        if (!found || !isPlainObject(data)) return;
        found.table.onMove(found.seat, data['key']);
      });

      on('nextRound', (data) => {
        const found = myTable(data);
        if (found) found.table.nextRound(found.seat);
      });

      on('restart', (data) => {
        const found = myTable(data);
        if (found) found.table.restartMatch(found.seat);
      });

      on('emote', (data) => {
        const found = myTable(data);
        if (!found || !isPlainObject(data)) return;
        found.table.onEmote(found.seat, data['kind'], data['code']);
      });

      on('rejoin', (data) => {
        if (!free() || !isPlainObject(data) || !isValidTableId(data['tableId']) || !isValidRejoinKey(data['rejoinKey'])) return;
        const table = tables.get(data['tableId']);
        if (!table || table.def.id !== game.meta.id) return;
        const seat = table.rejoin(data['rejoinKey'], socket.id);
        if (seat === null) {
          socket.emit('error', { code: 'reprise-impossible' });
          return;
        }
        socket.data.tableId = table.id;
        socket.join(table.id);
        socket.emit('seat', { tableId: table.id, seat, rejoinKey: data['rejoinKey'] });
      });

      on('quit', (data) => {
        const found = myTable(data);
        if (!found) return;
        socket.leave(found.table.id);
        socket.data.tableId = null;
        found.table.leave(found.seat, 'quit');
      });

      socket.on('disconnect', () => {
        if (socket.data.inQueue) matchmaking.leave(socket.id);
        if (socket.data.privateCode) {
          const code = socket.data.privateCode;
          const r = privateTables.leave(socket.id);
          if (r?.dissolved) dissolve(r.table.entries.map((e) => e.humanId), code);
          else if (r) privateStatus(code);
        }
        const table = socket.data.tableId ? tables.get(socket.data.tableId) : undefined;
        if (table) {
          const seat = table.seats.findIndex((s) => !s.isBot && s.humanId === socket.id);
          if (seat !== -1) table.leave(seat, 'disconnect');
        }
      });
    });

  }

  // ---------- entretien ----------

  const purgeTimer = setInterval(() => {
    try {
      const n = store.purgeInactive(cfg.purgeDays);
      if (n > 0) console.log(`[profils] ${n} profil(s) inactif(s) depuis ${cfg.purgeDays} jours effacé(s)`);
      const sNb = store.purgeSessions(180);
      if (sNb > 0) console.log(`[profils] ${sNb} session(s) sans usage depuis 180 jours effacée(s)`);
    } catch (err) {
      console.error('[profils] purge :', err instanceof Error ? err.message : err);
    }
  }, 6 * 60 * 60 * 1000);
  purgeTimer.unref();

  function start(): Promise<{ address: string; port: number }> {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(cfg.port, cfg.host, () => {
        httpServer.off('error', reject);
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') resolve({ address: addr.address, port: addr.port });
        else reject(new Error('adresse inconnue'));
      });
    });
  }

  function close(): Promise<void> {
    clearInterval(purgeTimer);
    for (const t of tables.values()) t.destroy();
    tables.clear();
    return new Promise((resolve) => {
      io.close(() => {
        store.close();
        void (botPool ? botPool.close() : Promise.resolve()).then(resolve, resolve);
      });
    });
  }

  return { app, httpServer, io, store, cfg, tables, start, close };
}
