#!/usr/bin/env node
// Contrôle d'hygiène « sûr par conception » : aucun secret, aucune adresse personnelle,
// aucune identité privée dans les fichiers suivis NI dans l'historique ; aucun script ni
// style en ligne dans les pages ; aucune ressource chargée depuis un tiers.
// Lancé par `npm run verify`, le hook pre-push et la CI.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'jeton GitHub'],
  [/AKIA[0-9A-Z]{16}/, 'clé AWS'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'jeton Slack'],
  [/AIza[0-9A-Za-z_-]{35}/, 'clé Google'],
  [/eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/, 'jeton JWT (jeton de tunnel ?)'],
  [/(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{8,}["']/i, 'secret en clair'],
];
const PERSONAL_MAIL = /[A-Za-z0-9._%+-]+@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|orange|free|sfr|laposte|wanadoo|proton|protonmail)\.[a-z]{2,}/i;
const OK_COMMIT_EMAIL = /@users\.noreply\.github\.com$|^noreply@github\.com$|^support@github\.com$/i;
const THIRD_PARTY_LOAD = /(src|href)=["']https?:\/\/(?!github\.com|www\.cnil\.fr|liberapay\.com)[^"']+\.(js|css|woff2?|png|svg)["']/i;

const problems = [];
const warnings = [];

let files = [];
try {
  files = git('ls-files', '-z').split('\0').filter(Boolean);
} catch {
  // Pas encore de dépôt git : on contrôle l'arborescence telle quelle.
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const p = `${d}/${e.name}`.replace(/^\.\//, '');
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk('.');
}

const SKIP = /(^|\/)(package-lock\.json|.*\.(png|jpg|jpeg|gif|ico|woff2?))$/i;
for (const f of files) {
  if (SKIP.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
  if (/(^|\/)\.env($|\.)/.test(f) && !/\.env\.example$/.test(f)) {
    problems.push(`${f} : fichier de secrets suivi`);
    continue;
  }
  if (/\.(pem|p12|pfx|key|kdbx)$|id_(rsa|ed25519|ecdsa)$/i.test(f)) {
    problems.push(`${f} : fichier sensible suivi`);
    continue;
  }
  const text = fs.readFileSync(f, 'utf8');
  if (f !== 'scripts/hygiene.mjs' && f !== '.githooks/pre-commit') {
    for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${f} : ${label} probable`);
    const m = text.match(PERSONAL_MAIL);
    if (m) problems.push(`${f} : adresse personnelle (${m[0].replace(/^.{2}/, '**')})`);
  }
  if (/\.html$/.test(f)) {
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) problems.push(`${f} : script en ligne (interdit par la CSP)`);
    if (/<style[\s>]/i.test(text) || /\sstyle=/i.test(text)) problems.push(`${f} : style en ligne (interdit par la CSP)`);
    if (/\son[a-z]+=/i.test(text)) problems.push(`${f} : gestionnaire d'événement en ligne`);
    if (THIRD_PARTY_LOAD.test(text)) problems.push(`${f} : ressource chargée depuis un tiers`);
    if (/data-a-completer/.test(text)) warnings.push(`${f} : champ « à compléter » avant l'ouverture publique`);
  }
  if (/\.(ts|js|mjs)$/.test(f) && f !== 'scripts/hygiene.mjs' && !/\/public\/js\//.test(f) && /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write\(/.test(text)) {
    problems.push(`${f} : écriture de HTML brut (innerHTML ou équivalent)`);
  }
}

// Historique : auteurs et committers.
let log = '';
try {
  log = git('log', 'HEAD', '--format=%an <%ae>%n%cn <%ce>');
} catch {
  /* dépôt vide */
}
const idents = new Set(log.split('\n').filter(Boolean));
for (const id of idents) {
  const email = (id.match(/<(.*)>/) || [])[1] || '';
  if (!OK_COMMIT_EMAIL.test(email)) problems.push(`historique : identité non anonyme → ${id.replace(/<.*>/, `<${email.replace(/^.{2}/, '**')}>`)}`);
}

for (const w of warnings) console.warn(`Avertissement : ${w}`);
if (problems.length) {
  console.error(`Hygiène : ${problems.length} problème(s)\n - ${problems.join('\n - ')}`);
  console.error('\nAstuce : git config user.email "<ID>+<compte>@users.noreply.github.com" avant de commiter.');
  process.exit(1);
}
console.log(`Hygiène OK : ${files.length} fichiers, ${idents.size} identité(s) de commit, aucun secret, aucun inline.`);
