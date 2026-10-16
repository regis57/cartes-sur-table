/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * À propos : affiche la version en cours et pointe vers la page de cette version dans le dépôt.
 * Rien d'autre : le reste de la page est statique.
 */
import './theme.ts';
import { $ } from './ui.ts';

const DEPOT = 'https://github.com/regis57/cartes-sur-table';
const VERSION_RE = /^\d+\.\d+\.\d+$/;

async function afficherVersion(): Promise<void> {
  const numero = $('version-numero');
  const lien = $('version-lien') as HTMLAnchorElement;
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { version?: unknown; revision?: unknown };
    const version = typeof data.version === 'string' && VERSION_RE.test(data.version) ? data.version : null;
    const revision = typeof data.revision === 'string' && /^[0-9a-f]{7,40}$/.test(data.revision) ? data.revision.slice(0, 7) : null;
    if (!version) throw new Error('version inconnue');
    numero.textContent = revision ? `${version} (révision ${revision})` : version;
    // Chaque version a son entrée dans le journal du dépôt, sous une ancre stable « vX.Y.Z ».
    lien.href = `${DEPOT}/blob/main/docs/JOURNAL.md#v${version}`;
  } catch {
    numero.textContent = 'inconnue (hors ligne ?)';
  }
}

afficherVersion().catch(() => undefined);
