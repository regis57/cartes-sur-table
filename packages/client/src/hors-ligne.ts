/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import './theme.ts';
import { onAction } from './ui.ts';
import { loadLocale } from './i18n.ts';

/** Page de secours affichée par l'agent de service quand le réseau manque. */
async function main(): Promise<void> {
  await loadLocale().catch(() => undefined); // le dictionnaire est en cache, mais sait-on jamais
  onAction({ 'reessayer': () => location.replace('/') });
  window.addEventListener('online', () => location.replace('/'));
}

void main();
