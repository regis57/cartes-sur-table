/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import { h, img } from './ui.ts';
import { t } from './i18n.ts';

export const AVATAR_COUNT = 12;

export function avatarSrc(n: number): string {
  const i = Number.isInteger(n) && n >= 0 && n < AVATAR_COUNT ? n : 0;
  return `/img/avatars/a${String(i + 1).padStart(2, '0')}.svg`;
}

/** Grille de choix d'avatar : des boutons radio, sans aucune mention de genre. */
export function renderAvatarPicker(container: HTMLElement, selected: number, onPick: (n: number) => void): void {
  container.textContent = '';
  for (let i = 0; i < AVATAR_COUNT; i++) {
    const b = h('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === selected));
    b.setAttribute('aria-pressed', String(i === selected));
    b.setAttribute('aria-label', t('site.avatar_n', { n: i + 1 }));
    b.append(img(avatarSrc(i), ''));
    b.addEventListener('click', () => {
      container.querySelectorAll('button').forEach((x) => {
        x.setAttribute('aria-pressed', 'false');
        x.setAttribute('aria-checked', 'false');
      });
      b.setAttribute('aria-pressed', 'true');
      b.setAttribute('aria-checked', 'true');
      onPick(i);
    });
    container.append(b);
  }
}
