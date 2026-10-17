/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Aucune donnée reçue du réseau n'est interprétée comme du HTML : textContent et
 * createElement seulement. Les réactions sont des codes, dessinés depuis /img/emotes.
 */

/**
 * LA SALLE : tout ce qui entoure une table et qui ne dépend pas du jeu.
 *
 * Identité, choix du mode (solo, en ligne, entre amis), file d'attente, table privée,
 * niveau des bots, nombre de joueurs, règles, menu, réactions, fin de manche, reprise
 * après coupure. Un jeu n'écrit que le rendu de sa table et de son bilan ; le parcours
 * est le même pour tous les jeux, et une correction ici vaut pour tous.
 */

import { $, h, img, show, hide, fill, toast, onAction, openDialog, closeDialog } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';
import { basculerTheme, currentTheme } from './theme.ts';
import { identity } from './profile.ts';
import { avatarSrc } from './avatars.ts';
import { connectGame, saveSeat, loadSeat, type GameSocket } from './net.ts';
import { enregistrerAgent, EVENEMENT_NOUVELLE_VERSION } from './installer.ts';
import type { SeatView, PublicSeat } from '@jdc/core/table.ts';
import type { RoundEndPayload } from '@jdc/core/protocol.ts';

export const EMOJIS = ['sourire', 'rire', 'clin-oeil', 'etonne', 'triste', 'reflechit', 'applaudit', 'pouce', 'coeur', 'bravo', 'dodo', 'grimace'] as const;

export interface SalleContext<V> {
  readonly mySeat: () => number;
  readonly tableId: () => string | null;
  readonly view: () => SeatView<V> | null;
  /** Envoie un coup par sa clé (celle donnée dans `legal`). */
  readonly move: (key: string) => void;
  /** Nom d'un siège, avec « (vous) » pour le sien. */
  readonly seatName: (s: PublicSeat, idx: number) => string;
  /** Remplit l'étiquette standard d'un siège (avatar, nom, score, bot, en attente), en gardant les bulles. */
  readonly seatLabel: (label: HTMLElement, s: PublicSeat, idx: number, score: number, extra: string, options?: { dealer?: boolean }) => void;
  /**
   * Pose (ou retire) l'annonce d'un siège : une bulle qui reste, à côté du joueur, le temps
   * des enchères — « Passe », « Garde », « Je prends ♠ ». C'est la lecture d'une vraie table :
   * on voit qui a dit quoi sans relire une ligne de texte.
   */
  readonly seatAnnounce: (label: HTMLElement, texte: string | null) => void;
}

export interface SalleJeu<V> {
  readonly id: string;
  readonly phrases: readonly string[];
  readonly seatCounts: readonly number[];
  /** Zone d'écran (élément `.siege`) qui porte ce siège, pour les bulles de réaction. */
  zoneForSeat(seat: number): HTMLElement | null;
  renderTable(view: SeatView<V>, ctx: SalleContext<V>): void;
  /**
   * Remplit le conteneur du bilan ; le titre et les boutons sont communs. Peut renvoyer
   * un sous-titre propre au jeu (sinon « manche remportée par … »).
   */
  renderRoundEnd(data: RoundEndPayload, container: HTMLElement, ctx: SalleContext<V>): string | void;
  /** Boîtes de dialogue propres au jeu, fermées quand la partie est interrompue. */
  readonly dialogs?: readonly string[];
  /** Clé i18n du bandeau quand le socle joue un coup forcé pour la personne. */
  readonly forcedKey?: string;
}

const LOBBY_SECTIONS = ['modes', 'file', 'privee-choix', 'privee-attente'] as const;
type LobbySection = (typeof LOBBY_SECTIONS)[number];

/** Construit le lobby commun dans `#lobby`. Le HTML du jeu n'a qu'à poser la section vide. */
function buildLobby(jeu: SalleJeu<unknown>): void {
  const lobby = $('lobby');
  lobby.textContent = '';

  const back = h('a', 'retour-jeux', `← ${t('lobby.all_games')}`);
  back.href = '/';
  lobby.append(back);
  const titre = h('h1', '', t(`games.${jeu.id}.name`));
  const beta = h('span', 'beta', t('site.beta'));
  beta.title = t('site.beta_hint');
  titre.append(document.createTextNode(' '), beta);
  lobby.append(titre);
  if (has(`games.${jeu.id}.blurb`)) lobby.append(h('p', '', t(`games.${jeu.id}.blurb`)));
  const ident = h('p', 'lobby-identite');
  ident.id = 'lobby-identite';
  lobby.append(ident);

  const modes = h('div', 'modes');
  modes.id = 'modes';
  for (const [action, key] of [['solo', 'solo'], ['online', 'online'], ['private', 'private']] as const) {
    const b = h('button', 'mode');
    b.type = 'button';
    b.dataset['action'] = action;
    b.append(h('b', '', t(`lobby.${key}`)), h('span', '', t(`lobby.${key}_hint`)));
    modes.append(b);
  }
  lobby.append(modes);

  const options = h('div', 'options');
  options.id = 'options';
  if (jeu.seatCounts.length > 1) {
    const ligne = h('div', 'ligne');
    const lab = h('label', '', t('lobby.seats'));
    lab.htmlFor = 'sieges';
    const sel = h('select', 'champ');
    sel.id = 'sieges';
    for (const n of jeu.seatCounts) {
      const o = h('option', '', t('lobby.seats_n', { n }));
      o.value = String(n);
      sel.append(o);
    }
    ligne.append(lab, sel);
    options.append(ligne);
  }
  const niveau = h('div', 'ligne');
  const labN = h('label', '', t('lobby.level'));
  labN.htmlFor = 'niveau';
  const selN = h('select', 'champ');
  selN.id = 'niveau';
  for (const [v, key] of [['normal', 'level_normal'], ['facile', 'level_facile']] as const) {
    const o = h('option', '', t(`lobby.${key}`));
    o.value = v;
    selN.append(o);
  }
  niveau.append(labN, selN);
  options.append(niveau);
  const regles = h('button', 'btn btn-craie', t('lobby.rules'));
  regles.type = 'button';
  regles.dataset['action'] = 'rules';
  options.append(regles);
  lobby.append(options);

  // File d'attente publique.
  const file = h('div');
  file.id = 'file';
  file.hidden = true;
  file.append(h('h2', '', t('lobby.searching')));
  const compte = h('div', 'compte', '60');
  compte.id = 'compte';
  file.append(compte, h('p', '', t('lobby.waiting')));
  const fileListe = h('ul', 'sans attente-liste');
  fileListe.id = 'file-liste';
  file.append(fileListe);
  file.append(boutons([['force-start', 'lobby.start_now', 'laiton'], ['leave-queue', 'lobby.leave_queue', 'craie']]));
  lobby.append(file);

  // Table privée : créer ou rejoindre.
  const choix = h('div');
  choix.id = 'privee-choix';
  choix.hidden = true;
  choix.append(boutons([['create-private', 'lobby.create_private', 'laiton']]), h('p'));
  const labC = h('label', '', t('lobby.code_label'));
  labC.htmlFor = 'code';
  choix.append(labC);
  const ligneCode = h('div', 'ligne');
  const code = h('input', 'champ code');
  code.id = 'code';
  code.type = 'text';
  code.maxLength = 7;
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.setAttribute('autocapitalize', 'characters');
  const join = h('button', 'btn btn-craie', t('lobby.join_private'));
  join.type = 'button';
  join.dataset['action'] = 'join-private';
  ligneCode.append(code, join);
  choix.append(ligneCode);
  const hint = h('p');
  hint.append(h('small', '', t('lobby.code_hint')));
  choix.append(hint, boutons([['back-modes', 'site.cancel', 'craie']]));
  lobby.append(choix);

  // Table privée : en attente des amis.
  const attente = h('div');
  attente.id = 'privee-attente';
  attente.hidden = true;
  attente.append(h('p', '', t('lobby.your_code')));
  const pCode = h('p');
  const partage = h('span', 'code-partage');
  partage.id = 'code-partage';
  pCode.append(partage);
  attente.append(pCode, boutons([['copy-code', 'lobby.copy_code', 'craie']]), h('p', '', t('lobby.waiting')));
  const privListe = h('ul', 'sans attente-liste');
  privListe.id = 'privee-liste';
  attente.append(privListe);
  const conseil = h('p');
  conseil.id = 'privee-conseil';
  attente.append(conseil);
  const b2 = boutons([['start-private', 'lobby.launch', 'laiton'], ['leave-private', 'lobby.leave_private', 'craie']]);
  const lancer = b2.querySelector<HTMLElement>('[data-action="start-private"]');
  if (lancer) {
    lancer.id = 'btn-lancer';
    lancer.hidden = true;
  }
  attente.append(b2);
  lobby.append(attente);
}

function boutons(defs: readonly (readonly [string, string, 'laiton' | 'craie' | 'rouge'])[]): HTMLElement {
  const box = h('div', 'boutons');
  for (const [action, key, style] of defs) {
    const b = h('button', `btn btn-${style}`, t(key));
    b.type = 'button';
    b.dataset['action'] = action;
    box.append(b);
  }
  return box;
}

/** Les boîtes de dialogue communes à tous les jeux : menu, règles, réactions, bilan, information. */
function buildDialogs(jeu: SalleJeu<unknown>): void {
  const dlg = (id: string, ...children: Node[]): HTMLDialogElement => {
    const d = h('dialog');
    d.id = id;
    d.append(...children);
    document.body.append(d);
    return d;
  };
  dlg('dlg-menu', h('h2', '', t('table.menu')), boutons([['close-menu', 'table.resume', 'craie'], ['scoresheet', 'table.scoresheet', 'craie'], ['rules', 'lobby.rules', 'craie'], ['theme', 'table.theme', 'craie'], ['quit', 'table.quit', 'rouge']]));

  const marque = h('div', 'marque');
  marque.id = 'marque-tableau';
  dlg('dlg-marque', h('h2', '', t('table.scoresheet_title')), marque, boutons([['close-scoresheet', 'site.close', 'craie']]));

  const btnTheme = document.querySelector<HTMLButtonElement>('[data-action="theme"]');
  if (btnTheme) btnTheme.textContent = t(currentTheme() === 'dark' ? 'table.theme_light' : 'table.theme_dark');

  const regles = h('div', 'regles');
  regles.id = 'regles-texte';
  dlg('dlg-regles', h('h2', '', t('lobby.rules_title', { game: t(`games.${jeu.id}.name`) })), regles, boutons([['close-rules', 'site.close', 'craie']]));
  for (let i = 1; i <= 30; i++) {
    const key = `games.${jeu.id}.rules.${i}`;
    if (!has(key)) break;
    regles.append(h('p', '', t(key)));
  }

  const grille = h('div', 'choix-grille');
  grille.id = 'emojis';
  dlg('dlg-emojis', h('h2', '', t('table.emotes')), grille, h('p'), boutons([['close-emotes', 'site.close', 'craie']]));
  const liste = h('div', 'choix-liste');
  liste.id = 'phrases';
  dlg('dlg-phrases', h('h2', '', t('table.phrases')), liste, h('p'), boutons([['close-emotes', 'site.close', 'craie']]));

  const titre = h('h2');
  titre.id = 'manche-titre';
  const sous = h('p');
  sous.id = 'manche-sous';
  const tableau = h('div');
  tableau.id = 'manche-tableau';
  const bm = boutons([['next-round', 'table.next_round', 'laiton'], ['restart', 'table.play_again', 'laiton']]);
  (bm.querySelector('[data-action="next-round"]') as HTMLElement).id = 'btn-manche';
  const rejouer = bm.querySelector('[data-action="restart"]') as HTMLElement;
  rejouer.id = 'btn-rejouer';
  rejouer.hidden = true;
  const home = h('a', 'btn btn-craie', t('site.back_home'));
  home.href = '/';
  bm.append(home);
  dlg('dlg-manche', titre, sous, tableau, bm);

  const info = h('p');
  info.id = 'info-texte';
  const bi = boutons([['rejoin', 'table.rejoin', 'laiton']]);
  const reprendre = bi.querySelector('[data-action="rejoin"]') as HTMLElement;
  reprendre.id = 'btn-reprendre';
  reprendre.hidden = true;
  const home2 = h('a', 'btn btn-craie', t('site.back_home'));
  home2.href = '/';
  bi.append(home2);
  dlg('dlg-info', info, bi);
}

export async function demarrerSalle<V>(jeu: SalleJeu<V>): Promise<void> {
  await loadLocale();
  enregistrerAgent();
  buildLobby(jeu as SalleJeu<unknown>);
  buildDialogs(jeu as SalleJeu<unknown>);

  let socket: GameSocket<V>;
  let me: { name: string; avatar: number } = { name: '', avatar: 0 };
  let tableId: string | null = null;
  let mySeat = -1;
  let view: SeatView<V> | null = null;
  const bubbles = new Map<number, ReturnType<typeof setTimeout>>();

  const ctx: SalleContext<V> = {
    mySeat: () => mySeat,
    tableId: () => tableId,
    view: () => view,
    move: (key) => {
      if (tableId) socket.emit('move', { tableId, key });
    },
    seatName: (s, idx) => (idx === mySeat ? `${s.name} (${t('table.you').toLowerCase()})` : s.name),
    seatLabel: (label, s, idx, score, extra, options) => {
      const bulles = [...label.querySelectorAll('.bulle')];
      label.textContent = '';
      label.append(img(avatarSrc(s.avatar), '', 'avatar'));
      const nom = h('span', 'nom', ctx.seatName(s, idx));
      if (options?.dealer) {
        // Le jeton du donneur, comme à la table : une pastille, pas un mot de plus à lire.
        const jeton = h('span', 'jeton-donneur', 'D');
        jeton.title = t('table.dealer_title');
        jeton.setAttribute('aria-label', t('table.dealer_title'));
        nom.append(document.createTextNode(' '), jeton);
      }
      label.append(nom);
      const infos = h('span', 'infos');
      infos.append(h('span', 'pts', t('table.score', { n: score })));
      if (extra) infos.append(document.createTextNode(` · ${extra}`));
      if (s.awaiting) infos.append(h('span', 'etat', ` · ${t('table.awaiting')}`));
      else if (s.isBot) infos.append(h('span', 'etat', ` · ${t('table.bot')}`));
      label.append(infos);
      label.append(...bulles);
    },
    seatAnnounce: (label, texte) => {
      const ancienne = label.querySelector('.bulle.annonce');
      if (texte === null) {
        ancienne?.remove();
        return;
      }
      if (ancienne) {
        ancienne.textContent = texte;
        return;
      }
      label.append(h('div', 'bulle annonce', texte));
    },
  };

  const showLobbySection = (id: LobbySection): void => {
    for (const x of LOBBY_SECTIONS) (x === id ? show : hide)($(x));
    (id === 'modes' ? show : hide)($('options'));
  };

  const renderQueue = (list: HTMLElement, players: { name: string; avatar: number }[]): void => {
    list.textContent = '';
    for (const p of players) {
      const li = h('li');
      li.append(img(avatarSrc(p.avatar), '', 'avatar'), document.createTextNode(p.name));
      list.append(li);
    }
  };

  const render = (): void => {
    if (!view) return;
    hide($('lobby'));
    show($('table'));
    jeu.renderTable(view, ctx);
  };

  /** Un texte de la table, que le jeu peut remplacer (au tarot, on dit « donne », pas « manche »). */
  const tg = (key: string, params: Record<string, string | number> = {}): string =>
    (has(`games.${jeu.id}.ui.${key}`) ? t(`games.${jeu.id}.ui.${key}`, params) : t(`table.${key}`, params));

  const renderRoundEnd = (data: RoundEndPayload): void => {
    $('manche-titre').textContent = data.matchOver ? t('table.match_end') : tg('round_end');
    const winnerName = data.summary.roundWinner !== null ? data.seats[data.summary.roundWinner]?.name ?? '' : '';
    const box = $('manche-tableau');
    box.textContent = '';
    const custom = jeu.renderRoundEnd(data, box, ctx);
    $('manche-sous').textContent = data.matchOver && data.winner !== null
      ? (data.winners.length > 1 ? custom ?? t('table.match_winners', { names: data.winners.map((w) => data.seats[w]?.name ?? '').join(' & ') }) : t('table.match_winner', { name: data.seats[data.winner]?.name ?? '' }))
      : custom ?? (winnerName ? tg('round_won_by', { name: winnerName }) : tg('round_no_winner'));
    $('btn-manche').textContent = tg('next_round');
    (data.matchOver ? hide : show)($('btn-manche'));
    (data.matchOver ? show : hide)($('btn-rejouer'));
    openDialog('dlg-manche');
  };

  /**
   * La feuille de marque, commune à tous les jeux : une ligne par manche finie (avec le mot du
   * jeu : contrat, atout…), les points de chacun, et les totaux. Les noms des sièges remplacent
   * les jetons « {n} » de la ligne, qui vient des règles et ne connaît pas les noms.
   */
  const renderScoresheet = (): void => {
    const box = $('marque-tableau');
    box.textContent = '';
    if (!view) return;
    const seats = view.seats;
    const names = (txt: string): string => txt.replace(/\{(\d+)\}/g, (_m, n: string) => seats[Number(n)]?.name ?? '');
    if (view.rounds.length === 0) {
      box.append(h('p', '', t('table.scoresheet_empty')));
      return;
    }
    const table = h('table', 'tableau marque-grille');
    const head = h('tr');
    head.append(h('th', '', tg('scoresheet_round')));
    seats.forEach((s) => {
      const th = h('th');
      th.append(img(avatarSrc(s.avatar), '', 'avatar'), h('span', 'nom-court', s.name));
      head.append(th);
    });
    table.append(head);
    for (const r of view.rounds) {
      const row = h('tr');
      const first = h('td', 'manche-nom');
      first.append(h('b', '', String(r.round)));
      if (r.label) first.append(h('span', 'libelle', names(r.label)));
      row.append(first);
      r.points.forEach((p, i) => {
        const td = h('td', p > 0 ? 'gagne' : p < 0 ? 'perdu' : '', `${p > 0 ? '+' : ''}${p}`);
        if (r.winner === i) td.classList.add('gagnant');
        row.append(td);
      });
      table.append(row);
    }
    const last = view.rounds[view.rounds.length - 1];
    const tot = h('tr', 'totaux');
    tot.append(h('td', '', t('table.scoresheet_total')));
    (last?.totals ?? []).forEach((v) => tot.append(h('td', '', String(v))));
    table.append(tot);
    box.append(table);
  };

  const showBubble = (seat: number, node: Node): void => {
    const zone = jeu.zoneForSeat(seat);
    const label = zone?.querySelector<HTMLElement>('.etiquette');
    if (!label) return;
    label.querySelector('.bulle:not(.annonce)')?.remove();
    const b = h('div', 'bulle');
    b.append(node);
    label.append(b);
    const old = bubbles.get(seat);
    if (old) clearTimeout(old);
    bubbles.set(seat, setTimeout(() => b.remove(), 3500));
  };

  const info = (text: string, canRejoin: boolean): void => {
    $('info-texte').textContent = text;
    (canRejoin ? show : hide)($('btn-reprendre'));
    for (const id of ['dlg-manche', 'dlg-emojis', 'dlg-phrases', 'dlg-menu', 'dlg-regles', 'dlg-marque', ...(jeu.dialogs ?? [])]) closeDialog(id);
    openDialog('dlg-info');
  };

  // Une nouvelle version du site a pris la main pendant la partie : on l'applique au
  // premier moment calme (manche suivante, retour au lobby), le siège est repris ensuite.
  let nouvelleVersion = false;
  window.addEventListener(EVENEMENT_NOUVELLE_VERSION, () => {
    nouvelleVersion = true;
    toast(t('site.new_version'), 'info');
  });

  const backToLobby = (): void => {
    if (nouvelleVersion) {
      location.reload();
      return;
    }
    tableId = null;
    mySeat = -1;
    view = null;
    saveSeat(null);
    hide($('table'));
    show($('lobby'));
    showLobbySection('modes');
  };

  const id = await identity();
  me = { name: id.name || t('site.guest'), avatar: id.avatar };
  fill($('lobby-identite'), img(avatarSrc(me.avatar), '', 'avatar'), ` ${me.name}`);

  const emojis = $('emojis');
  for (const code of EMOJIS) {
    const b = h('button');
    b.type = 'button';
    b.setAttribute('aria-label', t(`emotes.${code}`));
    b.append(img(`/img/emotes/${code}.svg`, ''));
    b.addEventListener('click', () => {
      if (tableId) socket.emit('emote', { tableId, kind: 'emoji', code });
      closeDialog('dlg-emojis');
    });
    emojis.append(b);
  }
  const phrases = $('phrases');
  for (const code of jeu.phrases) {
    const b = h('button', '', t(`phrases.${jeu.id}.${code}`));
    b.type = 'button';
    b.addEventListener('click', () => {
      if (tableId) socket.emit('emote', { tableId, kind: 'phrase', code });
      closeDialog('dlg-phrases');
    });
    phrases.append(b);
  }

  socket = await connectGame<V>(jeu.id, id.token);
  const ident = (): { name: string; avatar: number } => ({ name: me.name, avatar: me.avatar });
  const seatsChoice = (): number | undefined => {
    const sel = document.getElementById('sieges') as HTMLSelectElement | null;
    return sel ? Number(sel.value) : undefined;
  };

  socket.on('connect_error', () => toast(t('site.offline'), 'erreur'));
  socket.on('serverBusy', () => {
    toast(t('site.busy'), 'erreur');
    showLobbySection('modes');
  });
  socket.on('error', (e) => {
    const key = e.code === 'code-invalide' ? 'lobby.code_invalid' : e.code === 'table-introuvable' ? 'lobby.table_not_found' : 'table.rejoin_failed';
    toast(t(key), 'erreur');
    if (e.code === 'reprise-impossible') backToLobby();
  });
  socket.on('queueStatus', (d) => {
    showLobbySection('file');
    $('compte').textContent = String(d.countdown);
    renderQueue($('file-liste'), d.players);
  });
  socket.on('privateStatus', (d) => {
    showLobbySection('privee-attente');
    $('code-partage').textContent = d.code;
    renderQueue($('privee-liste'), d.players);
    $('privee-conseil').textContent = d.isHost ? t('lobby.host_hint') : t('lobby.guest_hint');
    (d.isHost ? show : hide)($('btn-lancer'));
  });
  socket.on('privateDissolved', () => {
    toast(t('lobby.dissolved'), 'info');
    showLobbySection('modes');
  });
  socket.on('seat', (d) => {
    tableId = d.tableId;
    mySeat = d.seat;
    if (d.rejoinKey) saveSeat({ gameId: jeu.id, tableId: d.tableId, rejoinKey: d.rejoinKey });
    closeDialog('dlg-info');
  });
  socket.on('tableStarted', () => closeDialog('dlg-manche'));
  socket.on('state', (v) => {
    view = v;
    mySeat = v.seat;
    tableId = v.tableId;
    render();
  });
  socket.on('seats', (d) => {
    if (view && d.tableId === view.tableId) {
      view = { ...view, seats: d.seats };
      render();
    }
  });
  socket.on('roundEnd', renderRoundEnd);
  socket.on('forced', () => {
    if (jeu.forcedKey) $('statut').textContent = t(jeu.forcedKey);
  });
  socket.on('emote', (d) => {
    if (d.kind === 'emoji') showBubble(d.seat, img(`/img/emotes/${d.code}.svg`, t(`emotes.${d.code}`)));
    else showBubble(d.seat, document.createTextNode(has(`phrases.${jeu.id}.${d.code}`) ? t(`phrases.${jeu.id}.${d.code}`) : d.code));
  });
  socket.on('afk', () => info(t('table.afk'), true));
  socket.on('tableClosed', (d) => {
    if (d.tableId !== tableId) return;
    saveSeat(null);
    info(t('table.closed'), false);
  });
  socket.on('achievements', (d) => {
    for (const code of d.codes) toast(t('achievements.unlocked', { name: t(`achievements.${code}.name`) }), 'succes');
  });

  // Reprise après rechargement de la page.
  const saved = loadSeat(jeu.id);
  if (saved) socket.once('connect', () => socket.emit('rejoin', { tableId: saved.tableId, rejoinKey: saved.rejoinKey }));

  onAction({
    'solo': () => {
      const level = $<HTMLSelectElement>('niveau').value === 'facile' ? 'facile' : 'normal';
      const seats = seatsChoice();
      socket.emit('solo', seats ? { ...ident(), level, seats } : { ...ident(), level });
    },
    'online': () => {
      showLobbySection('file');
      $('file-liste').textContent = '';
      socket.emit('joinQueue', ident());
    },
    'private': () => showLobbySection('privee-choix'),
    'back-modes': () => showLobbySection('modes'),
    'force-start': () => socket.emit('forceStart'),
    'leave-queue': () => {
      socket.emit('leaveQueue');
      showLobbySection('modes');
    },
    'create-private': () => {
      const seats = seatsChoice();
      socket.emit('createPrivate', seats ? { ...ident(), seats } : ident());
    },
    'join-private': () => socket.emit('joinPrivate', { ...ident(), code: $<HTMLInputElement>('code').value.trim().toUpperCase() }),
    'copy-code': () => {
      navigator.clipboard?.writeText($('code-partage').textContent ?? '').then(() => toast(t('site.copied'), 'succes'), () => undefined);
    },
    'start-private': () => socket.emit('startPrivate'),
    'leave-private': () => {
      socket.emit('leavePrivate');
      showLobbySection('modes');
    },
    'rules': () => {
      closeDialog('dlg-menu');
      openDialog('dlg-regles');
    },
    'scoresheet': () => {
      closeDialog('dlg-menu');
      renderScoresheet();
      openDialog('dlg-marque');
    },
    'close-scoresheet': () => closeDialog('dlg-marque'),
    'theme': () => {
      const suivant = basculerTheme();
      const b = document.querySelector<HTMLButtonElement>('[data-action="theme"]');
      if (b) b.textContent = t(suivant === 'dark' ? 'table.theme_light' : 'table.theme_dark');
    },
    'close-rules': () => closeDialog('dlg-regles'),
    'menu': () => openDialog('dlg-menu'),
    'close-menu': () => closeDialog('dlg-menu'),
    'quit': () => {
      if (!tableId || !confirm(t('table.quit_confirm'))) return;
      socket.emit('quit', { tableId });
      closeDialog('dlg-menu');
      backToLobby();
    },
    'open-emojis': () => openDialog('dlg-emojis'),
    'open-phrases': () => openDialog('dlg-phrases'),
    'close-emotes': () => {
      closeDialog('dlg-emojis');
      closeDialog('dlg-phrases');
    },
    'next-round': () => {
      closeDialog('dlg-manche');
      if (tableId) socket.emit('nextRound', { tableId });
      if (nouvelleVersion) location.reload(); // la reprise rend le siège, avec la vue à jour
    },
    'restart': () => {
      closeDialog('dlg-manche');
      if (tableId) socket.emit('restart', { tableId });
      if (nouvelleVersion) location.reload();
    },
    'rejoin': () => {
      const s = loadSeat(jeu.id);
      if (s) socket.emit('rejoin', { tableId: s.tableId, rejoinKey: s.rejoinKey });
      closeDialog('dlg-info');
    },
  });
}
