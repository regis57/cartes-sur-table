/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Le 8 Américain : seulement le rendu de la table et du bilan. Tout le parcours
 * (identité, modes, file, table privée, menu, réactions, reprise) est dans salle.ts.
 */
import './theme.ts';
import { $, h, fill, img, show, hide, toast, onAction, openDialog, closeDialog } from './ui.ts';
import { t } from './i18n.ts';
import { avatarSrc } from './avatars.ts';
import { demarrerSalle, type SalleContext } from './salle.ts';
import type { SeatView } from '@jdc/core/table.ts';
import type { RoundEndPayload } from '@jdc/core/protocol.ts';
import type { HuitView, Card, Move } from '@jdc/huit-americain';

const GAME = 'huit-americain';
const PHRASES = ['bien-joue', 'joli-coup', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va', 'change-de-couleur', 'un-huit', 'je-pioche', 'plus-qu-une', 'la-revanche', 'au-revoir'];
const POSITIONS: Record<number, string[]> = { 2: ['bas', 'haut'], 3: ['bas', 'gauche', 'droite'], 4: ['bas', 'gauche', 'haut', 'droite'] };

let pendingEight: Card | null = null;
let ctxRef: SalleContext<HuitView> | null = null;

const isRed = (c: Card): boolean => c.suit === '♥' || c.suit === '♦';
const cardText = (c: Card): string => `${c.value}${c.suit}`;

function cardEl(c: Card, extra = ''): HTMLElement {
  const el = h('div', `carte${isRed(c) ? ' rouge' : ''}${extra ? ' ' + extra : ''}`);
  // Un seul index, en haut à gauche, toujours à l'endroit et du côté du joueur : dans une
  // main en éventail, c'est la seule zone jamais recouverte par la carte voisine.
  const coin = h('span', 'coin');
  coin.append(document.createTextNode(c.value), h('span', '', c.suit));
  el.append(coin, h('span', 'centre', c.suit));
  el.setAttribute('aria-label', cardText(c));
  return el;
}

function backEl(): HTMLElement {
  return h('div', 'carte dos');
}

function renderTable(view: SeatView<HuitView>, ctx: SalleContext<HuitView>): void {
  ctxRef = ctx;
  const g = view.game;
  const mySeat = ctx.mySeat();
  const n = g.seats;
  const positions = POSITIONS[n] ?? POSITIONS[4] ?? [];
  for (let ui = 0; ui < 4; ui++) hide($(`siege-${ui}`));

  positions.forEach((pos, ui) => {
    const abs = (ui + mySeat) % n;
    const seat = view.seats[abs];
    if (!seat) return;
    const zone = $(`siege-${ui}`);
    zone.className = `siege ${pos}${g.current === abs && !g.roundOver ? ' actif' : ''}`;
    zone.dataset['seat'] = String(abs);
    show(zone);
    ctx.seatLabel(zone.querySelector<HTMLElement>('.etiquette') as HTMLElement, seat, abs, g.scores[abs] ?? 0, t('table.cards_n', { n: g.handCounts[abs] ?? 0 }));

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
            } else if (options[0]) ctx.move(options[0].key);
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
  fill($('couleur'), `${t('table.suit')} `, h('span', g.activeSuit === '♥' || g.activeSuit === '♦' ? 'rouge' : '', g.activeSuit));
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

function renderRoundEnd(data: RoundEndPayload, box: HTMLElement): void {
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
  box.append(table);
}

function zoneForSeat(seat: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.siege[data-seat="${seat}"]`);
}

demarrerSalle<HuitView>({
  id: GAME,
  phrases: PHRASES,
  seatCounts: [4],
  zoneForSeat,
  renderTable,
  renderRoundEnd,
  dialogs: ['dlg-couleur'],
  forcedKey: 'table.forced_draw',
}).then(() => {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-suit]');
    const view = ctxRef?.view();
    if (!el || !pendingEight || !view || !ctxRef) return;
    const suit = el.dataset['suit'];
    const key = view.game.legal.find((l) => l.move.type === 'play' && l.move.card.value === '8' && l.move.card.suit === pendingEight!.suit && l.move.suit === suit)?.key;
    pendingEight = null;
    closeDialog('dlg-couleur');
    if (key) ctxRef.move(key);
  });
  onAction({
    'draw': () => {
      const key = ctxRef?.view()?.game.legal.find((l) => l.move.type === 'draw')?.key;
      if (key) ctxRef?.move(key);
    },
  });
}).catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
