/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

// Assemble le wiki du dépôt à partir de `wiki/` (pages propres au wiki) et de `docs/`
// (journal, manifeste), en réécrivant les liens relatifs vers le dépôt. Sortie : le
// dossier passé en argument (par défaut `.wiki-out`). Lancé par le workflow wiki.yml.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? '.wiki-out';
const BLOB = 'https://github.com/regis57/cartes-sur-table/blob/main/';
mkdirSync(out, { recursive: true });

for (const f of readdirSync('wiki')) if (f.endsWith('.md')) copyFileSync(path.join('wiki', f), path.join(out, f));

/** Liens relatifs du dossier docs/ : vers la page wiki si elle existe, sinon vers le dépôt. */
const WIKI_PAGES = { 'JOURNAL.md': 'Journal', 'MANIFESTE-SECURITE.md': 'Manifeste-securite', 'BILAN-SECURITE.md': 'Bilan-securite' };
function rewrite(md) {
  return md.replace(/\]\((?!https?:|#)([^)]+)\)/g, (_, target) => {
    const [file, anchor] = target.split('#');
    const page = WIKI_PAGES[file];
    if (page) return `](${page}${anchor ? '#' + anchor : ''})`;
    const repoPath = file.startsWith('../') ? file.slice(3) : 'docs/' + file;
    return `](${BLOB}${repoPath}${anchor ? '#' + anchor : ''})`;
  });
}

for (const [src, page] of Object.entries(WIKI_PAGES)) {
  writeFileSync(path.join(out, page + '.md'), rewrite(readFileSync(path.join('docs', src), 'utf8')));
}
console.log(`wiki : ${readdirSync(out).length} page(s) dans ${out}/`);
