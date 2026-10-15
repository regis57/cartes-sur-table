// Génère les émoticônes (SVG, dessin original) : un fichier par code du catalogue.
// Les codes sont ceux de EMOJI_CODES (packages/core/src/table.ts) ; un test le vérifie.
// Usage : node scripts/generer-emotes.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../packages/client/public/img/emotes/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const face = (inner, bg = '#F2C94C') => `<circle cx="32" cy="32" r="30" fill="${bg}" stroke="#8C6A1E" stroke-width="2"/>${inner}`;
const eyes = `<circle cx="23" cy="27" r="3.2" fill="#1B1B1B"/><circle cx="41" cy="27" r="3.2" fill="#1B1B1B"/>`;
const s = (d, color = '#1B1B1B') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;

const emotes = {
  'sourire': face(eyes + s('M20 40q12 10 24 0')),
  'rire': face(`<path d="M18 26l8 3-8 3zM46 26l-8 3 8 3z" fill="#1B1B1B"/><path d="M18 38q14 16 28 0z" fill="#8C2F2F"/><path d="M22 40q10 8 20 0" fill="#fff"/>`),
  'clin-oeil': face(`<circle cx="23" cy="27" r="3.2" fill="#1B1B1B"/>` + s('M36 27h10') + s('M20 40q12 10 24 0')),
  'etonne': face(`<circle cx="23" cy="26" r="4" fill="#1B1B1B"/><circle cx="41" cy="26" r="4" fill="#1B1B1B"/><ellipse cx="32" cy="43" rx="6" ry="8" fill="#1B1B1B"/>` + s('M16 18l6-3M48 18l-6-3')),
  'triste': face(eyes + s('M20 44q12-10 24 0') + `<path d="M44 34q-4 6 0 9q4-3 0-9z" fill="#2E86AB"/>`),
  'reflechit': face(`<circle cx="23" cy="27" r="3.2" fill="#1B1B1B"/><circle cx="41" cy="27" r="3.2" fill="#1B1B1B"/>` + s('M24 42h14') + s('M14 20l10 2M40 22l10-2') + `<circle cx="54" cy="12" r="4" fill="#fff" stroke="#8C6A1E" stroke-width="1.5"/><circle cx="48" cy="18" r="2" fill="#fff" stroke="#8C6A1E" stroke-width="1.5"/>`),
  'applaudit': `<path d="M20 50c-8-6-8-18-2-22l10-6 4 6-6 6 10-8c3-2 6 0 7 3l-4 10 6-8c2-3 6-2 7 1l-12 18c-6 8-14 6-20 0z" fill="#F1C9A5" stroke="#8C6A1E" stroke-width="2"/>` + s('M8 24l4-4M6 32h5M10 14l4 3', '#D9A441') + s('M56 24l-4-4M58 32h-5M54 14l-4 3', '#D9A441'),
  'pouce': `<path d="M14 30h8v22h-8zM24 30l8-16c4-2 8 1 7 6l-2 8h12c4 0 6 3 5 7l-4 14c-1 3-3 4-6 4H24z" fill="#F1C9A5" stroke="#8C6A1E" stroke-width="2"/>`,
  'coeur': `<path d="M32 54L12 34c-6-6-4-16 4-18 6-2 11 1 16 7 5-6 10-9 16-7 8 2 10 12 4 18z" fill="#B8302B" stroke="#7A1C18" stroke-width="2"/>`,
  'bravo': `<path d="M32 6l7 14 15 2-11 11 3 15-14-7-14 7 3-15L10 22l15-2z" fill="#D9A441" stroke="#8C6A1E" stroke-width="2"/>`,
  'dodo': face(s('M18 27h10M36 27h10') + s('M24 42h16')) + `<text x="40" y="18" font-family="Georgia,serif" font-size="14" font-weight="bold" fill="#1B1B1B">z</text><text x="48" y="12" font-family="Georgia,serif" font-size="10" font-weight="bold" fill="#1B1B1B">z</text>`,
  'grimace': face(eyes + s('M18 42q7-6 14 0t14 0')),
};

for (const [code, inner] of Object.entries(emotes)) {
  writeFileSync(new URL(`${code}.svg`, OUT), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${code}">${inner}</svg>\n`);
}
console.log(`${Object.keys(emotes).length} émoticônes écrites`);
