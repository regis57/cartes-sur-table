/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import './theme.ts';
import { $, h, toast } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';

/**
 * La page des règles. Elle ne récite rien : elle lit le dictionnaire, exactement comme
 * la boîte « Règles du jeu » ouverte depuis une table. Une règle corrigée l'est partout,
 * et un jeu ajouté apparaît ici sans que personne n'y pense.
 *
 * Chaque jeu a son ancre (`/regles/#tarot`), pour qu'on puisse y renvoyer directement.
 */

interface GameMeta {
  id: string;
  nameKey: string;
  seatCounts: number[];
  status: 'available' | 'soon';
}

/** Les paragraphes de règles d'un jeu : games.<id>.rules.1, .2, … tant qu'il y en a. */
function paragraphs(id: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const key = `games.${id}.rules.${i}`;
    if (!has(key)) break;
    out.push(t(key));
  }
  return out;
}

function seatsLabel(g: GameMeta): string {
  const min = Math.min(...g.seatCounts);
  const max = Math.max(...g.seatCounts);
  return min === max ? t('site.players', { n: min }) : t('site.players_range', { a: min, b: max });
}

async function main(): Promise<void> {
  await loadLocale();

  let games: GameMeta[] = [];
  try {
    const res = await fetch('/api/jeux', { cache: 'no-store' });
    games = ((await res.json()) as { games: GameMeta[] }).games;
  } catch {
    toast(t('site.offline'), 'erreur');
    return;
  }

  const toc = $('sommaire-liste');
  const box = $('regles');
  toc.textContent = '';
  box.textContent = '';

  for (const g of games) {
    const texts = paragraphs(g.id);
    if (texts.length === 0) continue; // un jeu annoncé dont les règles ne sont pas écrites

    const nom = has(g.nameKey) ? t(g.nameKey) : g.id;

    const li = h('li');
    const lien = h('a', '', nom);
    lien.href = `#${g.id}`;
    li.append(lien, document.createTextNode(` — ${seatsLabel(g)}`));
    if (g.status === 'soon') li.append(h('span', 'bientot-etiquette', t('site.soon')));
    toc.append(li);

    const section = h('section', 'regles-jeu');
    section.id = g.id;
    const titre = h('h2', '', nom);
    section.append(titre);
    const sous = h('p', 'joueurs', seatsLabel(g));
    section.append(sous);
    for (const texte of texts) section.append(h('p', '', texte));

    if (g.status === 'available') {
      const jouer = h('a', 'btn btn-laiton', t('site.play'));
      jouer.href = `/jeu/${encodeURIComponent(g.id)}/`;
      jouer.setAttribute('aria-label', `${t('site.play')} — ${nom}`);
      const action = h('p');
      action.append(jouer);
      section.append(action);
    } else {
      section.append(h('p', 'joueurs', t('site.soon')));
    }
    box.append(section);
  }

  // Si l'adresse portait une ancre, le contenu n'existait pas encore au chargement.
  if (location.hash.length > 1) {
    const cible = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    cible?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
