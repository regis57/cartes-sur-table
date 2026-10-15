/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Aucune donnée reçue du réseau n'est interprétée comme du HTML : textContent et
 * createElement seulement. Les réactions sont des codes, dessinés depuis /img/emotes.
 */
import './theme.ts';
import { $, h, img, show, hide, fill, toast, onAction, openDialog, closeDialog } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';
import { identity, getGuest } from './profile.ts';
import { avatarSrc } from './avatars.ts';
import { connectGame, saveSeat, loadSeat, type GameSocket } from './net.ts';
import type { SeatView, PublicSeat } from '@jdc/core/table.ts';
import type { RoundEndPayload } from '@jdc/core/protocol.ts';
import type { HuitView, Card, Move } from '@jdc/huit-americain';

const GAME = 'huit-americain';
const EMOJIS = ['sourire', 'rire', 'clin-oeil', 'etonne', 'triste', 'reflechit', 'applaudit', 'pouce', 'coeur', 'bravo', 'dodo', 'grimace'];
const PHRASES = ['bien-joue', 'joli-coup', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va', 'change-de-couleur', 'un-huit', 'je-pioche', 'plus-qu-une', 'la-revanche', 'au-revoir'];
const POSITIONS: Record<number, string[]> = { 2: ['bas', 'haut'], 3: ['bas', 'gauche', 'droite'], 4: ['bas', 'gauche', 'haut', 'droite'] };

let socket: GameSocket<HuitView>;
let me: { name: string; avatar: number } = { name: '', avatar: 0 };
let tableId: string | null = null;
let mySeat = -1;
let view: SeatView<HuitView> | null = null;
let pendingEight: Card | null = null;
const bubbles = new Map<number, ReturnType<typeof setTimeout>>();

const isRed = (c: Card): boolean => c.suit === '♥' || c.suit === '♦';
const cardText = (c: Card): string => `${c.value}${c.suit}`;

function cardEl(c: Card, extra = ''): HTMLElement {
  const el = h('div', `carte${isRed(c) ? ' rouge' : ''}${extra ? ' ' + extra : ''}`);
  const coin = h('span', 'coin');
  coin.append(document.createTextNode(c.value), h('span', '', c.suit));
  const coinBas = coin.cloneNode(true) as HTMLElement;
  coinBas.classList.add('bas');
  el.append(coin, h('span', 'centre', c.suit), coinBas);
  el.setAttribute('aria-label', cardText(c));
  return el;
}

function backEl(): HTMLElement {
  return h('div', 'carte dos');
}

function seatName(s: PublicSeat, idx: number): string {
  return idx === mySeat ? `${s.name} (${t('table.you').toLowerCase()})` : s.name;
}

// ---------- lobby ----------

function showLobbySection(id: 'modes' | 'file' | 'privee-choix' | 'privee-attente'): void {
  for (const x of ['modes', 'file', 'privee-choix', 'privee-attente']) {
    if (x === id) show($(x));
    else hide($(x));
  }
  const niveau = $('niveau').parentElement as HTMLElement;
  if (id === 'modes') show(niveau);
  else hide(niveau);
}

function renderQueue(list: HTMLElement, players: { name: string; avatar: number }[]): void {
  list.textContent = '';
  for (const p of players) {
    const li = h('li');
    li.append(img(avatarSrc(p.avatar), '', 'avatar'), document.createTextNode(p.name));
    list.append(li);
  }
}

// ---------- table ----------

function renderTable(): void {
  if (!view) return;
  const g = view.game;
  hide($('lobby'));
  show($('table'));
  const n = g.seats;
  const positions = POSITIONS[n] ?? POSITIONS[4] ?? [];
  for (let ui = 0; ui < 4; ui++) hide($(`siege-${ui}`));

  positions.forEach((pos, ui) => {
    const abs = (ui + mySeat) % n;
    const seat = view!.seats[abs];
    if (!seat) return;
    const zone = $(`siege-${ui}`);
    zone.className = `siege ${pos}${g.current === abs && !g.roundOver ? ' actif' : ''}`;
    show(zone);
    const label = zone.querySelector<HTMLElement>('.etiquette') as HTMLElement;
    const bubble = label.querySelector('.bulle');
    label.textContent = '';
    label.append(img(avatarSrc(seat.avatar), '', 'avatar'));
    label.append(h('span', 'nom', seatName(seat, abs)));
    const infos = h('span', 'infos');
    infos.append(h('span', 'pts', t('table.score', { n: g.scores[abs] ?? 0 })));
    infos.append(document.createTextNode(` · ${t('table.cards_n', { n: g.handCounts[abs] ?? 0 })}`));
    if (seat.awaiting) infos.append(h('span', 'etat', ` · ${t('table.awaiting')}`));
    else if (seat.isBot) infos.append(h('span', 'etat', ` · ${t('table.bot')}`));
    label.append(infos);
    if (bubble) label.append(bubble);

    const hand = zone.querySelector<HTMLElement>('.main') as HTMLElement;
    hand.className = `main ${pos === 'gauche' || pos === 'droite' ? 'verticale' : 'horizontale'}${ui === 0 ? ' moi' : ''}`;
    hand.textContent = '';
    if (ui === 0) {
      const legalByCard = new Map<string, { key: string; move: Move }[]>();
      for (const l of g.legal) {
        if (l.move.type !== 'play') continue;
        const k = cardText(l.move.card);
        const arr = legalByCard.get(k) ?? [];
        arr.push(l);
        legalByCard.set(k, arr);
      }
      g.hand.forEach((c) => {
        const options = legalByCard.get(cardText(c));
        const el = cardEl(c, options ? 'jouable' : 'injouable');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        if (options) {
          const play = (): void => {
            if (c.value === '8') {
              pendingEight = c;
              openDialog('dlg-couleur');
            } else {
              const key = options[0]?.key;
              if (key && tableId) socket.emit('move', { tableId, key });
            }
          };
          el.addEventListener('click', play);
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              play();
            }
          });
        }
        hand.append(el);
      });
    } else {
      const count = g.handCounts[abs] ?? 0;
      for (let i = 0; i < Math.min(count, pos === 'haut' ? 12 : 8); i++) hand.append(backEl());
    }
  });

  fill($('defausse'), cardEl(g.discardTop));
  $('pioche-n').textContent = String(g.deckCount);
  const couleur = $('couleur');
  couleur.textContent = '';
  couleur.append(document.createTextNode(t('table.suit') + ' '));
  couleur.append(h('span', g.activeSuit === '♥' || g.activeSuit === '♦' ? 'rouge' : '', g.activeSuit));
  $('sens').textContent = g.direction === 1 ? t('table.direction_ccw') : t('table.direction_cw');
  $('pioche').classList.toggle('jouable', g.legal.some((l) => l.move.type === 'draw'));

  const statut = $('statut');
  if (g.roundOver) statut.textContent = t('table.round_end');
  else if (g.current === mySeat) statut.textContent = t('table.your_turn');
  else statut.textContent = t('table.turn_of', { name: view.seats[g.current]?.name ?? '' });
  if (g.lastAction && !g.roundOver) {
    const who = view.seats[g.lastAction.seat]?.name ?? '';
    let txt = '';
    if (g.lastAction.type === 'play' && g.lastAction.card) {
      txt = g.lastAction.suit
        ? t('table.last_play_suit', { name: who, card: cardText(g.lastAction.card), suit: g.lastAction.suit })
        : t('table.last_play', { name: who, card: cardText(g.lastAction.card) });
    } else if (g.lastAction.type === 'draw') txt = t('table.last_draw', { name: who });
    else txt = t('table.last_pass', { name: who });
    statut.textContent = `${txt} — ${statut.textContent}`;
  }
}

function renderRoundEnd(data: RoundEndPayload): void {
  const matchOver = data.matchOver;
  $('manche-titre').textContent = matchOver ? t('table.match_end') : t('table.round_end');
  const winnerName = data.summary.roundWinner !== null ? data.seats[data.summary.roundWinner]?.name ?? '' : '';
  $('manche-sous').textContent = matchOver && data.winner !== null
    ? t('table.match_winner', { name: data.seats[data.winner]?.name ?? '' })
    : t('table.round_won_by', { name: winnerName });
  const table = h('table', 'tableau');
  const head = h('tr');
  head.append(h('th', '', ''), h('th', '', t('table.cards_left')), h('th', '', t('table.round_points')), h('th', '', t('table.total')));
  table.append(head);
  data.summary.perSeat.forEach((ps, i) => {
    const row = h('tr');
    const name = h('td');
    name.append(img(avatarSrc(data.seats[i]?.avatar ?? 0), '', 'avatar'), document.createTextNode(' ' + (data.seats[i]?.name ?? '')));
    row.append(name);
    const cards = h('td');
    const left = Array.isArray(ps.detail) ? (ps.detail as Card[]) : [];
    if (left.length === 0) cards.append(h('em', '', '—'));
    for (const c of left) cards.append(h('span', `mini${isRed(c) ? ' rouge' : ''}`, cardText(c)));
    row.append(cards, h('td', '', `+${ps.roundPoints}`), h('td', '', t('table.score', { n: ps.total })));
    if (i === data.summary.roundWinner) row.classList.add('gagnant');
    table.append(row);
  });
  fill($('manche-tableau'), table);
  if (matchOver) {
    hide($('btn-manche'));
    show($('btn-rejouer'));
  } else {
    show($('btn-manche'));
    hide($('btn-rejouer'));
  }
  openDialog('dlg-manche');
}

function showBubble(seat: number, node: Node): void {
  if (!view) return;
  const n = view.game.seats;
  const ui = (seat - mySeat + n) % n;
  const label = $(`siege-${ui}`).querySelector<HTMLElement>('.etiquette');
  if (!label) return;
  label.querySelector('.bulle')?.remove();
  const b = h('div', 'bulle');
  b.append(node);
  label.append(b);
  const old = bubbles.get(seat);
  if (old) clearTimeout(old);
  bubbles.set(seat, setTimeout(() => b.remove(), 3500));
}

function info(text: string, canRejoin: boolean): void {
  $('info-texte').textContent = text;
  if (canRejoin) show($('btn-reprendre'));
  else hide($('btn-reprendre'));
  for (const id of ['dlg-manche', 'dlg-couleur', 'dlg-emojis', 'dlg-phrases', 'dlg-menu']) closeDialog(id);
  openDialog('dlg-info');
}

function backToLobby(): void {
  tableId = null;
  mySeat = -1;
  view = null;
  saveSeat(null);
  hide($('table'));
  show($('lobby'));
  showLobbySection('modes');
}

// ---------- démarrage ----------

async function main(): Promise<void> {
  await loadLocale();
  const id = await identity();
  me = { name: id.name || t('site.guest'), avatar: id.avatar };
  $('lobby-identite').textContent = '';
  $('lobby-identite').append(img(avatarSrc(me.avatar), '', 'avatar'), document.createTextNode(` ${me.name}`));

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
  for (const code of PHRASES) {
    const b = h('button', '', t(`phrases.${GAME}.${code}`));
    b.type = 'button';
    b.addEventListener('click', () => {
      if (tableId) socket.emit('emote', { tableId, kind: 'phrase', code });
      closeDialog('dlg-phrases');
    });
    phrases.append(b);
  }

  socket = await connectGame<HuitView>(GAME, id.token);
  const ident = (): { name: string; avatar: number } => ({ name: me.name, avatar: me.avatar });

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
    if (d.isHost) show($('btn-lancer'));
    else hide($('btn-lancer'));
  });
  socket.on('privateDissolved', () => {
    toast(t('lobby.dissolved'), 'info');
    showLobbySection('modes');
  });
  socket.on('seat', (d) => {
    tableId = d.tableId;
    mySeat = d.seat;
    if (d.rejoinKey) saveSeat({ gameId: GAME, tableId: d.tableId, rejoinKey: d.rejoinKey });
    closeDialog('dlg-info');
  });
  socket.on('tableStarted', () => {
    closeDialog('dlg-manche');
  });
  socket.on('state', (v) => {
    view = v;
    mySeat = v.seat;
    tableId = v.tableId;
    renderTable();
  });
  socket.on('seats', (d) => {
    if (view && d.tableId === view.tableId) {
      view = { ...view, seats: d.seats };
      renderTable();
    }
  });
  socket.on('roundEnd', (d) => {
    renderRoundEnd(d);
  });
  socket.on('forced', () => {
    $('statut').textContent = t('table.forced_draw');
  });
  socket.on('emote', (d) => {
    if (d.kind === 'emoji') showBubble(d.seat, img(`/img/emotes/${d.code}.svg`, t(`emotes.${d.code}`)));
    else showBubble(d.seat, document.createTextNode(has(`phrases.${GAME}.${d.code}`) ? t(`phrases.${GAME}.${d.code}`) : d.code));
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
  const saved = loadSeat(GAME);
  if (saved) socket.once('connect', () => socket.emit('rejoin', { tableId: saved.tableId, rejoinKey: saved.rejoinKey }));

  onAction({
    'solo': () => {
      const level = $<HTMLSelectElement>('niveau').value === 'facile' ? 'facile' : 'normal';
      socket.emit('solo', { ...ident(), level });
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
    'create-private': () => socket.emit('createPrivate', ident()),
    'join-private': () => socket.emit('joinPrivate', { ...ident(), code: $<HTMLInputElement>('code').value.trim().toUpperCase() }),
    'copy-code': () => {
      navigator.clipboard?.writeText($('code-partage').textContent ?? '').then(() => toast(t('site.copied'), 'succes'), () => undefined);
    },
    'start-private': () => socket.emit('startPrivate'),
    'leave-private': () => {
      socket.emit('leavePrivate');
      showLobbySection('modes');
    },
    'draw': () => {
      const key = view?.game.legal.find((l) => l.move.type === 'draw')?.key;
      if (key && tableId) socket.emit('move', { tableId, key });
    },
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
    },
    'restart': () => {
      closeDialog('dlg-manche');
      if (tableId) socket.emit('restart', { tableId });
    },
    'rejoin': () => {
      const s = loadSeat(GAME);
      if (s) socket.emit('rejoin', { tableId: s.tableId, rejoinKey: s.rejoinKey });
      closeDialog('dlg-info');
    },
  });

  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-suit]');
    if (!el || !pendingEight || !view || !tableId) return;
    const suit = el.dataset['suit'];
    const key = view.game.legal.find((l) => l.move.type === 'play' && l.move.card.value === '8' && l.move.card.suit === pendingEight!.suit && l.move.suit === suit)?.key;
    pendingEight = null;
    closeDialog('dlg-couleur');
    if (key) socket.emit('move', { tableId, key });
  });

  void getGuest;
}

main().catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
