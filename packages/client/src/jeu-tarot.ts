/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Le tarot : rendu de la table et du bilan. Le parcours est dans salle.ts.
 * Aucune donnée du réseau n'est interprétée comme du HTML.
 */
import './theme.ts';
import { $, h, img, show, hide, toast, prefersReducedMotion } from './ui.ts';
import { t } from './i18n.ts';
import { avatarSrc } from './avatars.ts';
import { demarrerSalle, type SalleContext } from './salle.ts';
import type { SeatView } from '@jdc/core/table.ts';
import type { RoundEndPayload } from '@jdc/core/protocol.ts';
import type { TarotView, Card, Move, TrickCard, DonneResult, HistoryEntry } from '@jdc/tarot';

const GAME = 'tarot';
const PHRASES = ['bien-joue', 'joli-pli', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va', 'je-prends', 'je-passe', 'coupe', 'le-petit', 'excuse', 'au-revoir'];
const POSITIONS: Record<number, string[]> = {
  4: ['bas', 'gauche', 'haut', 'droite'],
  5: ['bas', 'gauche', 'haut-gauche', 'haut-droite', 'droite'],
};
/** Zone d'écran utilisée pour chaque position (à quatre, le haut prend la zone haut-gauche). */
const ZONE_FOR: Record<string, number> = { bas: 0, gauche: 1, 'haut-gauche': 2, haut: 2, 'haut-droite': 3, droite: 4 };
const BID_KEYS = ['passe', 'petite', 'garde', 'garde-sans', 'garde-contre'];

let lastTrickShownAt = 0;
let lastTrickKey = '';
let hideTrickTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- cartes ----------

const isRed = (c: Card): boolean => c.t === 'c' && (c.suit === '♥' || c.suit === '♦');

export function cardKey(c: Card): string {
  if (c.t === 'e') return 'EXC';
  if (c.t === 'a') return `A${c.rank}`;
  return `${c.value}${c.suit}`;
}

function cardLabel(c: Card): string {
  if (c.t === 'e') return t('tarot.excuse');
  if (c.t === 'a') return t('tarot.atout_n', { n: c.rank });
  return `${c.value}${c.suit}`;
}

function cardEl(c: Card, extra = ''): HTMLElement {
  const cls = ['carte'];
  if (isRed(c)) cls.push('rouge');
  if (c.t === 'a') cls.push('atout');
  if (c.t === 'e') cls.push('excuse');
  if (extra) cls.push(extra);
  const el = h('div', cls.join(' '));
  const coin = h('span', 'coin');
  if (c.t === 'c') {
    coin.append(document.createTextNode(c.value), h('span', '', c.suit));
    el.append(coin, h('span', 'centre', c.suit));
  } else if (c.t === 'a') {
    coin.append(document.createTextNode(String(c.rank)));
    el.append(coin, h('span', 'centre', String(c.rank)), h('span', 'legende', t('tarot.atout')));
  } else {
    coin.append(document.createTextNode('★'));
    el.append(coin, h('span', 'centre', '★'), h('span', 'legende', t('tarot.excuse')));
  }
  el.setAttribute('aria-label', cardLabel(c));
  return el;
}

function backEl(): HTMLElement {
  return h('div', 'carte dos');
}

function miniCard(c: Card): HTMLElement {
  const s = h('span', `mini${isRed(c) ? ' rouge' : ''}${c.t === 'a' ? ' atout' : ''}`, c.t === 'c' ? `${c.value}${c.suit}` : c.t === 'a' ? `${c.rank}` : '★');
  s.title = cardLabel(c);
  return s;
}

// ---------- table ----------

function uiPositions(n: number): string[] {
  return POSITIONS[n] ?? POSITIONS[4] ?? [];
}

function zoneOf(pos: string): HTMLElement {
  return $(`siege-${ZONE_FOR[pos] ?? 0}`);
}

function bidName(b: number): string {
  return t(`tarot.bid.${BID_KEYS[b] ?? 'passe'}`);
}

function renderTable(view: SeatView<TarotView>, ctx: SalleContext<TarotView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  const n = g.seats;
  const positions = uiPositions(n);
  const grille = document.querySelector<HTMLElement>('.table-jeu-grille');
  grille?.classList.toggle('cinq', n === 5);
  grille?.classList.toggle('quatre', n !== 5);
  document.querySelector<HTMLElement>('.tarot .centre')?.classList.toggle('en-jeu', g.phase === 'play');
  for (let ui = 0; ui < 5; ui++) hide($(`siege-${ui}`));

  const active = g.phase === 'bidding' ? g.bidTurn : g.phase === 'callKing' || g.phase === 'ecart' ? g.preneur : g.phase === 'play' ? g.current : -1;

  positions.forEach((pos, i) => {
    const abs = (i + me) % n;
    const seat = view.seats[abs];
    if (!seat) return;
    const zone = zoneOf(pos);
    zone.className = `siege ${pos}${active === abs && !g.roundOver ? ' actif' : ''}`;
    zone.dataset['seat'] = String(abs);
    show(zone);

    // Étiquette : score, nombre de cartes, rôle (preneur, partenaire), enchère annoncée.
    const bits: string[] = [t('table.cards_n', { n: g.handCounts[abs] ?? 0 })];
    if (g.phase === 'bidding' && (g.bids[abs] ?? -1) >= 0) bits.push(bidName(g.bids[abs] ?? 0));
    if (g.phase !== 'bidding' && abs === g.preneur && g.preneur >= 0) bits.push(t('tarot.role.preneur'));
    if (g.partner === abs) bits.push(t('tarot.role.partenaire'));
    const poignee = g.poignees.find((p) => p.seat === abs);
    if (poignee) bits.push(t('tarot.poignee_badge', { n: poignee.count }));
    ctx.seatLabel(zone.querySelector<HTMLElement>('.etiquette') as HTMLElement, seat, abs, g.scores[abs] ?? 0, bits.join(' · '));

    const hand = zone.querySelector<HTMLElement>('.main') as HTMLElement;
    hand.className = `main ${pos === 'gauche' || pos === 'droite' ? 'verticale' : 'horizontale'}${i === 0 ? ' moi' : ''}`;
    hand.textContent = '';
    if (i === 0) renderMyHand(hand, g, ctx);
    else {
      const count = g.handCounts[abs] ?? 0;
      for (let k = 0; k < Math.min(count, pos.startsWith('haut') ? 10 : 7); k++) hand.append(backEl());
    }
  });

  renderCentre(view, ctx);
  renderStatus(view, ctx);
}

function renderMyHand(hand: HTMLElement, g: TarotView, ctx: SalleContext<TarotView>): void {
  const legalByCard = new Map<string, string>();
  for (const l of g.legal) {
    if (l.move.type === 'play' || l.move.type === 'discard') legalByCard.set(cardKey(l.move.card), l.key);
  }
  const interactive = g.phase === 'play' || g.phase === 'ecart';
  for (const c of g.hand) {
    const key = legalByCard.get(cardKey(c));
    const el = cardEl(c, interactive ? (key ? 'jouable' : 'injouable') : '');
    if (key) {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const play = (): void => ctx.move(key);
      el.addEventListener('click', play);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          play();
        }
      });
    }
    hand.append(el);
  }
}

function renderCentre(view: SeatView<TarotView>, ctx: SalleContext<TarotView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  const name = (s: number): string => view.seats[s]?.name ?? '';

  // Le contrat en cours.
  const contrat = $('contrat');
  contrat.textContent = '';
  if (g.phase !== 'bidding' && g.preneur >= 0) {
    contrat.append(h('b', '', bidName(g.bestBid)));
    contrat.append(document.createTextNode(` — ${t('tarot.taken_by', { name: name(g.preneur) })}`));
    if (g.calledCard) {
      contrat.append(h('br'));
      contrat.append(document.createTextNode(t('tarot.called', { card: `${g.calledCard.t === 'c' ? g.calledCard.value : ''}${g.calledCard.t === 'c' ? g.calledCard.suit : ''}` })));
      if (g.partner !== null) contrat.append(document.createTextNode(` · ${t('tarot.partner_is', { name: name(g.partner) })}`));
    }
  } else if (g.phase === 'bidding') {
    contrat.append(h('b', '', t('tarot.bidding')));
    if (g.bestBid > 0 && g.preneur >= 0) contrat.append(document.createTextNode(` — ${bidName(g.bestBid)} (${name(g.preneur)})`));
  }

  // Le pli en cours, ou le dernier pli le temps de le voir.
  const pli = $('pli');
  pli.textContent = '';
  const n = g.seats;
  const positions = uiPositions(n);
  const posOf = (seat: number): string => positions[(seat - me + n) % n] ?? 'bas';
  let shown: readonly TrickCard[] = g.trick;
  let winner: number | null = null;
  if (g.trick.length === 0 && g.lastTrick && g.phase === 'play') {
    const key = g.lastTrick.cards.map((c) => cardKey(c.card)).join(',') + `:${g.tricksPlayed}`;
    if (key !== lastTrickKey) {
      lastTrickKey = key;
      lastTrickShownAt = Date.now();
      if (hideTrickTimer) clearTimeout(hideTrickTimer);
      hideTrickTimer = setTimeout(() => renderCentre(view, ctx), prefersReducedMotion() ? 600 : 1600);
    }
    if (Date.now() - lastTrickShownAt < (prefersReducedMotion() ? 600 : 1600)) {
      shown = g.lastTrick.cards;
      winner = g.lastTrick.winner;
    }
  }
  for (const tc of shown) {
    const slot = h('div', `pli-carte ${posOf(tc.seat)}${winner === tc.seat ? ' gagnante' : ''}`);
    slot.append(cardEl(tc.card));
    pli.append(slot);
  }

  // Le chien, pendant l'écart.
  const chien = $('chien');
  chien.textContent = '';
  if (g.phase === 'ecart' && g.chien) {
    show(chien);
    chien.append(h('div', 'legende-zone', t('tarot.chien')));
    const row = h('div', 'cartes-rangee');
    for (const c of g.chien) row.append(cardEl(c));
    chien.append(row);
    if (g.ecart) {
      chien.append(h('div', 'legende-zone', t('tarot.ecart_progress', { n: g.ecart.length, total: g.chienSize })));
      const er = h('div', 'cartes-rangee petite');
      for (const c of g.ecart) er.append(cardEl(c));
      chien.append(er);
    }
  } else hide(chien);

  // Les choix du moment : enchères, appel au Roi, poignée.
  const choix = $('choix');
  choix.textContent = '';
  const legal = g.legal;
  if (g.phase === 'bidding' && legal.length) {
    choix.append(h('p', 'consigne', t('tarot.your_bid')));
    const row = h('div', 'boutons');
    for (const l of legal) {
      if (l.move.type !== 'bid') continue;
      const b = h('button', `btn ${l.move.bid === 0 ? 'btn-craie' : 'btn-laiton'}`, bidName(l.move.bid));
      b.type = 'button';
      b.addEventListener('click', () => ctx.move(l.key));
      row.append(b);
    }
    choix.append(row);
  } else if (g.phase === 'callKing' && legal.length) {
    choix.append(h('p', 'consigne', t('tarot.call_prompt')));
    const row = h('div', 'cartes-rangee');
    for (const l of legal) {
      if (l.move.type !== 'call') continue;
      const c: Card = { t: 'c', suit: l.move.suit, value: l.move.value, rank: l.move.value === 'R' ? 14 : 13 };
      const el = cardEl(c, 'jouable');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('click', () => ctx.move(l.key));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ctx.move(l.key);
        }
      });
      row.append(el);
    }
    choix.append(row);
  } else if (g.phase === 'ecart' && legal.length) {
    choix.append(h('p', 'consigne', t('tarot.ecart_prompt', { n: g.ecartNeeded })));
  } else if (g.phase === 'play' && g.myPoignee) {
    const l = legal.find((x) => x.move.type === 'poignee');
    if (l) {
      const b = h('button', 'btn btn-laiton', t('tarot.announce_poignee', { n: g.myPoignee.count, bonus: g.myPoignee.bonus }));
      b.type = 'button';
      b.addEventListener('click', () => ctx.move(l.key));
      choix.append(b);
    }
  }

  // Compteur de plis et numéro de donne.
  $('plis').textContent = g.phase === 'play' || g.roundOver
    ? `${t('tarot.trick_n', { n: Math.min(g.tricksPlayed + 1, g.totalTricks), total: g.totalTricks })} · ${t('tarot.round_n', { n: g.roundNumber, total: g.totalRounds })}`
    : t('tarot.round_n', { n: g.roundNumber, total: g.totalRounds });
}

function renderStatus(view: SeatView<TarotView>, ctx: SalleContext<TarotView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  const name = (s: number): string => view.seats[s]?.name ?? '';
  const statut = $('statut');
  let txt = '';
  if (g.roundOver) txt = t('table.round_end');
  else if (g.phase === 'bidding') txt = g.bidTurn === me ? t('tarot.your_bid') : t('tarot.bid_of', { name: name(g.bidTurn) });
  else if (g.phase === 'callKing') txt = g.preneur === me ? t('tarot.call_prompt') : t('tarot.calling', { name: name(g.preneur) });
  else if (g.phase === 'ecart') txt = g.preneur === me ? t('tarot.ecart_prompt', { n: g.ecartNeeded }) : t('tarot.ecart_of', { name: name(g.preneur) });
  else if (g.current === me) txt = t('table.your_turn');
  else txt = t('table.turn_of', { name: name(g.current) });

  const ev = g.lastEvent;
  let prefix = '';
  if (ev && !g.roundOver) {
    switch (ev.type) {
      case 'redeal': prefix = t('tarot.event.redeal'); break;
      case 'bid': prefix = t('tarot.event.bid', { name: name(ev.seat), bid: bidName(ev.bid) }); break;
      case 'call': prefix = t('tarot.event.call', { name: name(ev.seat), card: ev.card.t === 'c' ? `${ev.card.value}${ev.card.suit}` : '' }); break;
      case 'ecart-done': prefix = t('tarot.event.ecart_done', { name: name(ev.seat) }); break;
      case 'poignee': prefix = t('tarot.event.poignee', { name: name(ev.seat), n: ev.count, bonus: ev.bonus }); break;
      case 'partner': prefix = t('tarot.event.partner', { name: name(ev.seat) }); break;
      case 'trick': prefix = t('tarot.event.trick', { name: name(ev.winner) }); break;
    }
  }
  statut.textContent = prefix ? `${prefix} — ${txt}` : txt;
}

// ---------- bilan ----------

function resultLines(r: DonneResult, names: (s: number) => string): HTMLElement {
  const box = h('div', 'bilan-donne');
  const l1 = h('p');
  l1.append(h('b', '', `${bidName(r.bid)}`), document.createTextNode(` — ${t('tarot.taken_by', { name: names(r.preneur) })}`));
  if (r.partner !== null) l1.append(document.createTextNode(` · ${t('tarot.partner_is', { name: names(r.partner) })}`));
  box.append(l1);
  const l2 = h('p', r.won ? 'gagne' : 'perdu');
  l2.textContent = `${t(r.won ? 'tarot.contract_won' : 'tarot.contract_lost')} : ${t('tarot.points_vs_target', { pts: r.attackPoints, target: r.target, bouts: r.bouts })}`;
  box.append(l2);
  const bonus: string[] = [];
  if (r.petitAuBout !== 0) bonus.push(`${t('tarot.petit_au_bout')} ${r.petitAuBout > 0 ? '+' : ''}${r.petitAuBout}`);
  if (r.poignees !== 0) bonus.push(`${t('tarot.poignees')} ${r.poignees > 0 ? '+' : ''}${r.poignees}`);
  if (bonus.length) box.append(h('p', '', bonus.join(' · ')));
  box.append(h('p', '', t('tarot.value', { n: r.value })));
  return box;
}

function renderRoundEnd(data: RoundEndPayload, box: HTMLElement, ctx: SalleContext<TarotView>): string | void {
  const view = ctx.view();
  const g = view?.game;
  const names = (s: number): string => data.seats[s]?.name ?? '';
  if (g?.result) box.append(resultLines(g.result, names));
  const sub = g?.result
    ? (g.result.won ? t('tarot.donne_won', { name: names(g.result.preneur) }) : t('tarot.donne_lost', { name: names(g.result.preneur) }))
    : undefined;

  const table = h('table', 'tableau');
  const head = h('tr');
  head.append(h('th', '', ''), h('th', '', t('tarot.role_col')), h('th', '', t('table.round_points')), h('th', '', t('table.total')));
  table.append(head);
  data.summary.perSeat.forEach((ps, i) => {
    const row = h('tr');
    const name = h('td');
    name.append(img(avatarSrc(data.seats[i]?.avatar ?? 0), '', 'avatar'), document.createTextNode(' ' + names(i)));
    const role = (ps.detail as { role?: string } | null)?.role ?? 'defense';
    row.append(name, h('td', '', t(`tarot.role.${role}`)), h('td', ps.roundPoints >= 0 ? 'gagne' : 'perdu', `${ps.roundPoints >= 0 ? '+' : ''}${ps.roundPoints}`), h('td', '', t('table.score', { n: ps.total })));
    if (i === data.summary.roundWinner) row.classList.add('gagnant');
    table.append(row);
  });
  box.append(table);

  // L'historique de la partie, donne par donne.
  if (g && g.history.length > 1) {
    box.append(h('h3', '', t('tarot.history')));
    const hist = h('table', 'tableau historique');
    const hh = h('tr');
    hh.append(h('th', '', '#'), h('th', '', t('tarot.role.preneur')), h('th', '', t('tarot.contract')), h('th', '', t('tarot.result_col')), h('th', '', t('tarot.value_col')));
    hist.append(hh);
    for (const e of g.history as readonly HistoryEntry[]) {
      const row = h('tr');
      row.append(h('td', '', String(e.round)), h('td', '', names(e.result.preneur)), h('td', '', bidName(e.result.bid)),
        h('td', e.result.won ? 'gagne' : 'perdu', t(e.result.won ? 'tarot.won_short' : 'tarot.lost_short')), h('td', '', String(e.result.value)));
      hist.append(row);
    }
    box.append(hist);
  }
  return sub;
}

function zoneForSeat(seat: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.siege[data-seat="${seat}"]`);
}

demarrerSalle<TarotView>({
  id: GAME,
  phrases: PHRASES,
  seatCounts: [4, 5],
  zoneForSeat,
  renderTable,
  renderRoundEnd,
  forcedKey: 'tarot.forced_play',
}).catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});

export type { Move };
