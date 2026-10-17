/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Monte la version partout d'un seul geste : package.json, package-lock.json, l'agent de
 * service, et l'empreinte « ?v= » que portent les scripts et les feuilles de style dans les
 * pages. Cette empreinte est ce qui permet à un navigateur resté sur une vieille version de
 * récupérer la nouvelle : les pages, elles, sont toujours relues sur le réseau, et une URL
 * neuve ne peut pas être servie depuis l'ancien cache.
 *
 *   node scripts/version.mjs 0.7.0      monte la version
 *   node scripts/version.mjs            réaligne tout sur package.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(RACINE, 'packages/client/public');
const lire = (p) => readFileSync(p, 'utf8');
const ecrire = (p, s) => writeFileSync(p, s);

const pkgPath = path.join(RACINE, 'package.json');
const pkg = JSON.parse(lire(pkgPath));
const version = process.argv[2] ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version invalide : « ${version} » (attendu x.y.z)`);
  process.exit(2);
}

/** Toutes les pages du site. */
export function pages(dir = PUBLIC) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (nom.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Pose (ou remplace) l'empreinte sur les /js/*.js et /css/*.css d'une page. */
export function empreinter(html, v) {
  return html.replace(/(["'])(\/(?:js|css)\/[\w./-]+\.(?:js|css))(\?v=[\d.]+)?\1/g, (_m, q, url) => `${q}${url}?v=${v}${q}`);
}

let touches = 0;
pkg.version = version;
ecrire(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const lockPath = path.join(RACINE, 'package-lock.json');
const lock = JSON.parse(lire(lockPath));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
ecrire(lockPath, JSON.stringify(lock, null, 2) + '\n');

const swPath = path.join(PUBLIC, 'sw.js');
ecrire(swPath, lire(swPath).replace(/const VERSION = '[\d.]+';/, `const VERSION = '${version}';`));

for (const p of pages()) {
  const avant = lire(p);
  const apres = empreinter(avant, version);
  if (avant !== apres) {
    ecrire(p, apres);
    touches++;
  }
}
console.log(`Version ${version} : package.json, package-lock.json, sw.js, ${touches} page(s).`);
