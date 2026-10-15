/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import { $, h, img, show, hide, toast } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';
import { fetchProfile, getGuest, setGuest } from './profile.ts';
import { avatarSrc, renderAvatarPicker } from './avatars.ts';

interface GameMeta {
  id: string;
  nameKey: string;
  seatCounts: number[];
  status: 'available' | 'soon';
}

async function main(): Promise<void> {
  await loadLocale();

  const profile = await fetchProfile().catch(() => null);
  if (profile) {
    $('profil-pseudo').textContent = profile.profile.pseudo;
    $<HTMLImageElement>('profil-avatar').src = avatarSrc(profile.profile.avatar);
    show($('identite-profil'));
    hide($('identite-invite'));
  } else {
    const guest = getGuest();
    const input = $<HTMLInputElement>('pseudo');
    input.value = guest.name;
    input.addEventListener('input', () => setGuest({ name: input.value.trim(), avatar: getGuest().avatar }));
    renderAvatarPicker($('avatars'), guest.avatar, (n) => setGuest({ name: input.value.trim(), avatar: n }));
  }

  let games: GameMeta[] = [];
  try {
    const res = await fetch('/api/jeux', { cache: 'no-store' });
    games = ((await res.json()) as { games: GameMeta[] }).games;
  } catch {
    toast(t('site.offline'), 'erreur');
  }

  const tables = $('tables');
  tables.textContent = '';
  for (const g of games) {
    const row = h('article', `table-jeu${g.status === 'soon' ? ' bientot' : ''}`);
    const name = has(g.nameKey) ? t(g.nameKey) : g.id;
    const title = h('h2', '', name);
    const seats = g.seatCounts.length > 1
      ? t('site.players_range', { a: Math.min(...g.seatCounts), b: Math.max(...g.seatCounts) })
      : t('site.players', { n: g.seatCounts[0] ?? 4 });
    const left = h('div');
    left.append(title, h('div', 'joueurs', seats));
    row.append(left);
    if (g.status === 'available') {
      const a = h('a', 'btn btn-laiton', t('site.play'));
      a.href = `/jeu/${encodeURIComponent(g.id)}/`;
      a.setAttribute('aria-label', `${t('site.play')} — ${name}`);
      row.append(a);
    } else {
      row.append(h('span', 'bientot-etiquette', t('site.soon')));
    }
    const blurbKey = `games.${g.id}.blurb`;
    if (has(blurbKey)) row.append(h('p', '', t(blurbKey)));
    tables.append(row);
  }
  void img;
}

main().catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
