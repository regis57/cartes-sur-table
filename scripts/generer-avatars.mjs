// Génère les 12 avatars (SVG, dessin original et paramétrique). Aucune donnée de genre :
// des coiffures, des teints, des accessoires ; chacun choisit celui qui lui plaît.
// Usage : node scripts/generer-avatars.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../packages/client/public/img/avatars/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const skins = ['#F1C9A5', '#D9A47E', '#B87A52', '#8D5A3C', '#6B3F2A', '#F6D8C0'];
const hairs = ['#2B1B12', '#6B3A1E', '#C9A24B', '#A33A2E', '#8C8C8C', '#1F1F1F', '#E0D7C8', '#4A2E1A'];
const bgs = ['#D9A441', '#2E86AB', '#B8302B', '#6B8E23', '#7B5EA7', '#E07A5F', '#3D5A80', '#C9A24B', '#8FB339', '#D95F8B', '#4F6D7A', '#F2A541'];

// Chaque avatar : [teint, cheveux, coiffure, accessoire]
const specs = [
  [0, 0, 'court', 'aucun'], [1, 2, 'long', 'boucles'], [2, 5, 'frise', 'lunettes'], [3, 1, 'chignon', 'aucun'],
  [4, 4, 'court', 'barbe'], [5, 3, 'carre', 'aucun'], [1, 6, 'court', 'lunettes'], [0, 7, 'long', 'bandeau'],
  [2, 0, 'ras', 'barbe'], [3, 2, 'carre', 'boucles'], [4, 5, 'tresses', 'aucun'], [5, 1, 'casquette', 'aucun'],
];

function hairShape(style, c, skinOf) {
  switch (style) {
    case 'court': return `<path d="M22 34c2-14 10-20 22-20s20 6 22 20c-4-4-10-6-22-6s-18 2-22 6z" fill="${c}"/>`;
    case 'ras': return `<path d="M24 32c3-10 10-15 20-15s17 5 20 15c-6-3-12-4-20-4s-14 1-20 4z" fill="${c}"/>`;
    case 'long': return `<path d="M20 36c2-16 10-22 24-22s22 6 24 22v24c0 4-3 6-6 6h-4V40H30v26h-4c-3 0-6-2-6-6z" fill="${c}"/>`;
    case 'frise': return `<circle cx="44" cy="24" r="20" fill="${c}"/><circle cx="27" cy="34" r="8" fill="${c}"/><circle cx="61" cy="34" r="8" fill="${c}"/><ellipse cx="44" cy="44" rx="18" ry="21" fill="${skinOf}"/>`;
    case 'chignon': return `<circle cx="44" cy="14" r="9" fill="${c}"/><path d="M22 36c2-14 10-20 22-20s20 6 22 20c-4-4-10-6-22-6s-18 2-22 6z" fill="${c}"/>`;
    case 'carre': return `<path d="M20 34c2-14 10-20 24-20s22 6 24 20v18H58V40c-4-2-8-3-14-3s-10 1-14 3v12H20z" fill="${c}"/>`;
    case 'tresses': return `<path d="M22 34c2-14 10-20 22-20s20 6 22 20c-4-4-10-6-22-6s-18 2-22 6z" fill="${c}"/><path d="M24 36v26M64 36v26" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="6 3"/>`;
    case 'casquette': return `<path d="M20 34c2-14 10-20 24-20s22 6 24 20H20z" fill="${c}"/><rect x="14" y="32" width="46" height="6" rx="3" fill="${c}"/>`;
    default: return '';
  }
}

function accessory(kind, hairC) {
  switch (kind) {
    case 'lunettes': return `<g fill="none" stroke="#1B1B1B" stroke-width="2.5"><circle cx="35" cy="44" r="7"/><circle cx="53" cy="44" r="7"/><path d="M42 44h4M28 42l-6-2M60 42l6-2"/></g>`;
    case 'barbe': return `<path d="M28 50c2 12 8 18 16 18s14-6 16-18c-4 4-9 6-16 6s-12-2-16-6z" fill="${hairC}"/>`;
    case 'boucles': return `<circle cx="24" cy="56" r="3" fill="#D9A441"/><circle cx="64" cy="56" r="3" fill="#D9A441"/>`;
    case 'bandeau': return `<rect x="22" y="26" width="44" height="6" rx="3" fill="#B8302B"/>`;
    default: return '';
  }
}

specs.forEach(([sk, hr, style, acc], i) => {
  const skin = skins[sk], hair = hairs[hr], bg = bgs[i];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" width="88" height="88" role="img" aria-label="Avatar ${i + 1}">
<circle cx="44" cy="44" r="44" fill="${bg}"/>
<path d="M14 88c0-16 12-26 30-26s30 10 30 26z" fill="#F5F1E6"/>
<rect x="36" y="56" width="16" height="12" fill="${skin}"/>
<ellipse cx="44" cy="44" rx="18" ry="21" fill="${skin}"/>
${hairShape(style, hair, skin)}
<circle cx="37" cy="45" r="2.2" fill="#1B1B1B"/><circle cx="51" cy="45" r="2.2" fill="#1B1B1B"/>
<path d="M38 55q6 4 12 0" fill="none" stroke="#8C3B2E" stroke-width="2" stroke-linecap="round"/>
${accessory(acc, hair)}
</svg>
`;
  writeFileSync(new URL(`a${String(i + 1).padStart(2, '0')}.svg`, OUT), svg);
});
console.log(`${specs.length} avatars écrits`);
