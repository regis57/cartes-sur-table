/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * La belote : rendu de la table et du bilan. Le parcours est dans salle.ts.
 * Aucune donnée du réseau n'est interprétée comme du HTML.
 */
import './theme.ts';
import { $, h, img, show, hide, toast, prefersReducedMotion } from './ui.ts';
import { t } from './i18n.ts';
import { avatarSrc } from './avatars.ts';
import { demarrerSalle, type SalleContext } from './salle.ts';
import type { SeatView } from '@jdc/core/table.ts';
import type { RoundEndPayload } from '@jdc/core/protocol.ts';
import type { BeloteView, Card, Move, TrickCard, DonneResult, HistoryEntry, Declaration } from '@jdc/belote';

const GAME = 'belote';
const PHRASES = ['bien-joue', 'joli-pli', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va', 'je-prends', 'je-passe', 'coupe', 'belote', 'rebelote', 'au-revoir'];
const POSITIONS = ['bas', 'gauche', 'haut', 'droite'] as const;
const ZONE_FOR: Record<string, number> = { bas: 0, gauche: 1, haut: 2, droite: 3 };

let lastTrickShownAt = 0;
let lastTrickKey = '';
let hideTrickTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- cartes ----------

const isRed = (suit: string): boolean => suit === '♥' || suit === '♦';
const cardKey = (c: Card): string => `${c.value}${c.suit}`;
const teamOf = (seat: number): 0 | 1 => (seat % 2) as 0 | 1;

function cardEl(c: Card, trump: string | null, extra = ''): HTMLElement {
  const cls = ['carte'];
  if (isRed(c.suit)) cls.push('rouge');
  if (trump && c.suit === trump) cls.push('atout-belote');
  if (extra) cls.push(extra);
  const el = h('div', cls.join(' '));
  const coin = h('span', 'coin');
  coin.append(document.createTextNode(c.value), h('span', '', c.suit));
  el.append(coin, h('span', 'centre', c.suit));
  if (trump && c.suit === trump) el.append(h('span', 'legende', t('belote.trump')));
  el.setAttribute('aria-label', `${c.value}${c.suit}${trump && c.suit === trump ? ` (${t('belote.trump')})` : ''}`);
  return el;
}

function backEl(): HTMLElement {
  return h('div', 'carte dos');
}

function suitEl(suit: string): HTMLElement {
  return h('span', `atout-symbole${isRed(suit) ? ' rouge' : ''}`, suit);
}

// ---------- table ----------

function zoneOf(pos: string): HTMLElement {
  return $(`siege-${ZONE_FOR[pos] ?? 0}`);
}

/** Nom d'une équipe vu de ce siège : « Nous » ou « Eux ». */
function teamName(team: 0 | 1, me: number): string {
  return teamOf(me) === team ? t('belote.team_we') : t('belote.team_them');
}

function renderTable(view: SeatView<BeloteView>, ctx: SalleContext<BeloteView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  document.querySelector<HTMLElement>('.belote .centre')?.classList.toggle('en-jeu', g.phase === 'play');
  const bidding = g.phase === 'bid1' || g.phase === 'bid2';
  const active = bidding ? g.bidTurn : g.phase === 'play' ? g.current : -1;

  POSITIONS.forEach((pos, i) => {
    const abs = (i + me) % 4;
    const seat = view.seats[abs];
    if (!seat) return;
    const zone = zoneOf(pos);
    zone.className = `siege ${pos}${active === abs && !g.roundOver ? ' actif' : ''}${teamOf(abs) === teamOf(me) ? ' equipe-nous' : ''}`;
    zone.dataset['seat'] = String(abs);
    show(zone);

    const bits: string[] = [t('table.cards_n', { n: g.handCounts[abs] ?? 0 })];
    if (abs === g.dealer) bits.push(t('belote.dealer'));
    if (!bidding && abs === g.taker && g.taker >= 0) bits.push(t('belote.role.preneur'));
    if (g.beloteSeat === abs) bits.push(t('belote.belote_badge'));
    ctx.seatLabel(zone.querySelector<HTMLElement>('.etiquette') as HTMLElement, seat, abs, g.scores[abs] ?? 0, bits.join(' · '));

    const hand = zone.querySelector<HTMLElement>('.main') as HTMLElement;
    hand.className = `main ${pos === 'gauche' || pos === 'droite' ? 'verticale' : 'horizontale'}${i === 0 ? ' moi' : ''}`;
    hand.textContent = '';
    if (i === 0) renderMyHand(hand, g, ctx);
    else {
      const count = g.handCounts[abs] ?? 0;
      for (let k = 0; k < count; k++) hand.append(backEl());
    }
  });

  renderCentre(view, ctx);
  renderStatus(view, ctx);
}

function renderMyHand(hand: HTMLElement, g: BeloteView, ctx: SalleContext<BeloteView>): void {
  const legalByCard = new Map<string, string>();
  for (const l of g.legal) if (l.move.type === 'play') legalByCard.set(cardKey(l.move.card), l.key);
  const interactive = g.phase === 'play';
  for (const c of g.hand) {
    const key = legalByCard.get(cardKey(c));
    const el = cardEl(c, g.trump, interactive ? (key ? 'jouable' : 'injouable') : '');
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

function renderCentre(view: SeatView<BeloteView>, ctx: SalleContext<BeloteView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  const name = (s: number): string => view.seats[s]?.name ?? '';
  const bidding = g.phase === 'bid1' || g.phase === 'bid2';

  // Le contrat : qui a pris, à quoi ; pendant les enchères, « qui prend ? ».
  const contrat = $('contrat');
  contrat.textContent = '';
  if (!bidding && g.trump && g.taker >= 0) {
    contrat.append(h('b', '', t('belote.trump')), document.createTextNode(' '), suitEl(g.trump));
    contrat.append(h('br'), document.createTextNode(t('belote.taken_by', { name: name(g.taker) })));
    if (g.phase === 'play' || g.roundOver) {
      contrat.append(h('br'), document.createTextNode(`${teamName(0, me)} ${g.wonPoints[0]} – ${g.wonPoints[1]} ${teamName(1, me)}`));
    }
  } else if (bidding) {
    contrat.append(h('b', '', t('belote.bidding')));
  }

  // Le pli en cours, ou le dernier pli le temps de le voir.
  const pli = $('pli');
  pli.textContent = '';
  const posOf = (seat: number): string => POSITIONS[(seat - me + 4) % 4] ?? 'bas';
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
    slot.append(cardEl(tc.card, g.trump));
    pli.append(slot);
  }

  // La retourne, pendant les enchères.
  const retourne = $('retourne');
  retourne.textContent = '';
  if (bidding && g.turned) {
    show(retourne);
    retourne.append(h('div', 'legende-zone', t('belote.turned')));
    const row = h('div', 'cartes-rangee');
    row.append(cardEl(g.turned, g.phase === 'bid1' ? g.turned.suit : null));
    retourne.append(row);
  } else hide(retourne);

  // Les annonces, une fois montrées.
  const annonces = $('annonces');
  annonces.textContent = '';
  if (g.declarations && g.declarations.length && g.phase === 'play' && g.tricksPlayed <= 2) {
    show(annonces);
    const team = g.declarationsTeam;
    annonces.append(h('div', 'legende-zone', team === null ? t('belote.declarations_none') : t('belote.declarations_points', { n: g.declarations.filter((d) => teamOf(d.seat) === team).reduce((s, d) => s + d.points, 0), team: teamName(team, me) })));
    for (const d of g.declarations as readonly Declaration[]) {
      const line = h('div', `annonce${team === teamOf(d.seat) ? '' : ' perdu'}`);
      line.append(h('span', 'qui', `${name(d.seat)} : ${t(`belote.declaration.${d.kind}`)} (${d.points})`));
      const row = h('div', 'cartes-rangee');
      for (const c of d.cards) row.append(cardEl(c, g.trump));
      line.append(row);
      annonces.append(line);
    }
  } else hide(annonces);

  // Les choix du moment : prendre ou passer.
  const choix = $('choix');
  choix.textContent = '';
  const legal = g.legal;
  if (bidding && legal.length) {
    choix.append(h('p', 'consigne', t(g.phase === 'bid1' ? 'belote.your_bid_1' : 'belote.your_bid_2')));
    const row = h('div', 'boutons');
    for (const l of legal) {
      if (l.move.type === 'pass') {
        const b = h('button', 'btn btn-craie', t('belote.pass'));
        b.type = 'button';
        b.addEventListener('click', () => ctx.move(l.key));
        row.append(b);
      } else if (l.move.type === 'take') {
        const b = h('button', 'btn btn-laiton');
        b.type = 'button';
        b.append(suitEl(l.move.suit), document.createTextNode(g.phase === 'bid1' ? t('belote.take') : t('belote.take_suit', { suit: '' }).trim()));
        b.addEventListener('click', () => ctx.move(l.key));
        row.append(b);
      }
    }
    choix.append(row);
  }

  // Compteur de plis, numéro de donne, objectif.
  const bits = [t('belote.round_n', { n: g.roundNumber }), t('belote.target', { n: g.targetScore })];
  if (g.phase === 'play' || g.roundOver) bits.unshift(t('belote.trick_n', { n: Math.min(g.tricksPlayed + 1, g.totalTricks), total: g.totalTricks }));
  if (g.litige > 0) bits.push(t('belote.litige', { n: g.litige }));
  $('plis').textContent = bits.join(' · ');
}

function renderStatus(view: SeatView<BeloteView>, ctx: SalleContext<BeloteView>): void {
  const g = view.game;
  const me = ctx.mySeat();
  const name = (s: number): string => view.seats[s]?.name ?? '';
  const statut = $('statut');
  let txt = '';
  if (g.roundOver) txt = t('table.round_end');
  else if (g.phase === 'bid1' || g.phase === 'bid2') txt = g.bidTurn === me ? t(g.phase === 'bid1' ? 'belote.your_bid_1' : 'belote.your_bid_2') : t('belote.bid_of', { name: name(g.bidTurn) });
  else if (g.current === me) txt = t('table.your_turn');
  else txt = t('table.turn_of', { name: name(g.current) });

  const ev = g.lastEvent;
  let prefix = '';
  if (ev && !g.roundOver) {
    switch (ev.type) {
      case 'redeal': prefix = t('belote.event.redeal'); break;
      case 'pass': prefix = t('belote.event.pass', { name: name(ev.seat) }); break;
      case 'take': prefix = t('belote.event.take', { name: name(ev.seat), suit: ev.suit }); break;
      case 'belote': prefix = t(ev.second ? 'belote.event.rebelote' : 'belote.event.belote', { name: name(ev.seat) }); break;
      case 'declarations': prefix = t('belote.event.declarations', { team: teamName(ev.team, me), n: ev.points }); break;
      case 'trick': prefix = t('belote.event.trick', { name: name(ev.winner) }); break;
    }
  }
  statut.textContent = prefix ? `${prefix} — ${txt}` : txt;
}

// ---------- bilan ----------

function resultLines(r: DonneResult, names: (s: number) => string, me: number): HTMLElement {
  const box = h('div', 'bilan-donne');
  const l1 = h('p');
  l1.append(h('b', '', t('belote.trump_is', { suit: r.trump })), document.createTextNode(` — ${t('belote.taken_by', { name: names(r.taker) })}`));
  box.append(l1);
  const takerTeam = teamOf(r.taker);
  const l2 = h('p', r.capot !== null ? 'gagne' : r.litige ? '' : r.made ? 'gagne' : 'perdu');
  l2.textContent = r.capot !== null ? `${t('belote.capot')} (${teamName(r.capot, me)})` : r.litige ? t('belote.litige_result') : t(r.made ? 'belote.contract_won' : 'belote.contract_lost');
  box.append(l2);
  box.append(h('p', '', t('belote.cards_points', { a: `${teamName(takerTeam, me)} ${r.cardPoints[takerTeam]}`, b: `${r.cardPoints[1 - takerTeam] ?? 0} ${teamName((1 - takerTeam) as 0 | 1, me)}` })));
  const bonus: string[] = [];
  const bel = r.belote[0] ? 0 : r.belote[1] ? 1 : null;
  if (bel !== null) bonus.push(t('belote.belote_points', { name: teamName(bel, me) }));
  const dec = r.declarations[0] ? 0 : r.declarations[1] ? 1 : null;
  if (dec !== null) bonus.push(t('belote.declarations_points', { n: r.declarations[dec], team: teamName(dec, me) }));
  if (bonus.length) box.append(h('p', '', bonus.join(' · ')));
  box.append(h('p', '', t('belote.scored', { a: `${teamName(0, me)} +${r.scored[0]}`, b: `+${r.scored[1]} ${teamName(1, me)}` })));
  return box;
}

function renderRoundEnd(data: RoundEndPayload, box: HTMLElement, ctx: SalleContext<BeloteView>): string | void {
  const view = ctx.view();
  const g = view?.game;
  const me = ctx.mySeat();
  const names = (s: number): string => data.seats[s]?.name ?? '';
  if (g?.result) box.append(resultLines(g.result, names, me));
  let sub: string | undefined;
  if (data.matchOver && data.winners.length) {
    sub = t('table.match_winners', { names: data.winners.map((w) => names(w)).join(' & ') });
  } else if (g?.result) {
    const r = g.result;
    sub = r.litige ? t('belote.donne_litige') : r.made ? t('belote.donne_won', { name: names(r.taker) }) : t('belote.donne_lost', { name: names(r.taker) });
  }

  const table = h('table', 'tableau');
  const head = h('tr');
  head.append(h('th', '', ''), h('th', '', t('belote.role_col')), h('th', '', t('table.round_points')), h('th', '', t('table.total')));
  table.append(head);
  data.summary.perSeat.forEach((ps, i) => {
    const row = h('tr');
    const name = h('td');
    name.append(img(avatarSrc(data.seats[i]?.avatar ?? 0), '', 'avatar'), document.createTextNode(' ' + names(i)));
    const role = (ps.detail as { role?: string } | null)?.role ?? 'defense';
    row.append(name, h('td', '', t(`belote.role.${role}`)), h('td', ps.roundPoints > 0 ? 'gagne' : '', `+${ps.roundPoints}`), h('td', '', t('table.score', { n: ps.total })));
    if (data.winners.includes(i) || (!data.matchOver && g?.result && !g.result.litige && teamOf(i) === (g.result.capot ?? (g.result.made ? teamOf(g.result.taker) : 1 - teamOf(g.result.taker))))) row.classList.add('gagnant');
    table.append(row);
  });
  box.append(table);

  if (g && g.history.length > 1) {
    box.append(h('h3', '', t('belote.history')));
    const hist = h('table', 'tableau historique');
    const hh = h('tr');
    hh.append(h('th', '', '#'), h('th', '', t('belote.role.preneur')), h('th', '', t('belote.trump')), h('th', '', t('belote.result_col')), h('th', '', teamName(0, me)), h('th', '', teamName(1, me)));
    hist.append(hh);
    for (const e of g.history as readonly HistoryEntry[]) {
      const row = h('tr');
      const res = e.result.capot !== null ? t('belote.capot') : e.result.litige ? t('belote.litige_short') : t(e.result.made ? 'belote.won_short' : 'belote.lost_short');
      row.append(h('td', '', String(e.round)), h('td', '', names(e.result.taker)), h('td', '', e.result.trump),
        h('td', e.result.made ? 'gagne' : e.result.litige ? '' : 'perdu', res), h('td', '', String(e.scores[0])), h('td', '', String(e.scores[1])));
      hist.append(row);
    }
    box.append(hist);
  }
  return sub;
}

function zoneForSeat(seat: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.siege[data-seat="${seat}"]`);
}

demarrerSalle<BeloteView>({
  id: GAME,
  phrases: PHRASES,
  seatCounts: [4],
  zoneForSeat,
  renderTable,
  renderRoundEnd,
  forcedKey: 'belote.forced_play',
}).catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});

export type { Move };
