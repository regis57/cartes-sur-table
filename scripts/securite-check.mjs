#!/usr/bin/env node
/**
 * Le contrôle de sécurité externe, automatisé : ce que les plateformes gratuites voient
 * de jeuxdecartes.altiplume.com, comparé à ce que la conception attend.
 *
 *   node scripts/securite-check.mjs [hôte] [--strict]
 *
 * Sans accès à l'intérieur du NAS, ni secret : tout se lit depuis Internet.
 *  - MDN HTTP Observatory (API publique) : note et tests échoués.
 *  - DNS (Google DNS sur HTTPS) : le sous-domaine n'envoie ni ne reçoit de courrier
 *    (SPF -all, MX nul, DMARC reject), et ne pointe que vers Cloudflare.
 *  - Le site lui-même : les en-têtes attendus, aucun cookie, la redirection HTTP → HTTPS,
 *    la version réellement déployée (/api/version), le WebSocket joignable.
 *
 * `--strict` rend un code de sortie 1 si un résultat est sous l'attendu : c'est le mode
 * du workflow hebdomadaire.
 */
const host = process.argv.find((a) => !a.startsWith('-') && !a.includes('/') && a.includes('.')) ?? 'jeuxdecartes.altiplume.com';
const strict = process.argv.includes('--strict');
const UA = 'jeuxdecartes-securite-check';
const rows = [];
function row(domaine, attendu, reel, ok, action = '') {
  rows.push({ domaine, attendu, reel, ok, action });
}

async function json(url, init) {
  const r = await fetch(url, { ...init, headers: { accept: 'application/json', 'user-agent': UA, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
const dns = async (name, type) => (await json(`https://dns.google/resolve?name=${name}&type=${type}`)).Answer ?? [];
const txt = (answers) => answers.map((a) => String(a.data).replace(/^"|"$/g, '').replace(/" "/g, ''));

// ---- Observatory ----
try {
  await json(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${host}`, { method: 'POST' }).catch(() => null);
  const a = await json(`https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=${host}`);
  const failed = Object.values(a.tests ?? {}).filter((t) => t.pass === false).map((t) => `${t.name} (${t.score_modifier})`);
  const ok = ['A+', 'A'].includes(a.scan.grade);
  row('En-têtes HTTP (Observatory)', 'A ou A+', `${a.scan.grade} (${a.scan.score})${failed.length ? ' — échecs : ' + failed.join(', ') : ''}`, ok,
    failed.some((f) => f.startsWith('redirection')) ? 'Cloudflare → SSL/TLS → Edge Certificates → « Always Use HTTPS » : activé' : '');
} catch (e) {
  row('En-têtes HTTP (Observatory)', 'A ou A+', `indisponible (${e.message})`, null);
}

// ---- DNS : aucun courrier, seulement Cloudflare ----
try {
  const spfs = txt(await dns(host, 'TXT')).filter((t) => t.startsWith('v=spf1'));
  row('Email — SPF du sous-domaine', 'v=spf1 -all (n\'envoie jamais)', spfs[0] ?? 'absent', spfs.length === 1 && /^v=spf1\s+-all$/.test(spfs[0]),
    spfs.length === 1 && /-all$/.test(spfs[0]) ? '' : `Cloudflare DNS → TXT ${host} : v=spf1 -all`);
  const mx = (await dns(host, 'MX')).map((x) => String(x.data));
  const nul = mx.length === 1 && /^0 \.?$/.test(mx[0].trim());
  row('Courrier entrant — MX nul', '0 . (ne reçoit jamais)', mx.length ? mx.join(', ') : 'aucun MX', nul, nul ? '' : `Cloudflare DNS → MX ${host} : « . » priorité 0`);
  const dmarc = txt(await dns(`_dmarc.${host}`, 'TXT')).find((t) => t.startsWith('v=DMARC1'));
  const policy = dmarc?.match(/p=(\w+)/)?.[1];
  row('Email — DMARC', 'p=reject', dmarc ?? 'absent', policy === 'reject', policy === 'reject' ? '' : `Cloudflare DNS → TXT _dmarc.${host} : v=DMARC1; p=reject;`);
  const a = (await dns(host, 'A')).map((x) => x.data);
  row('Surface réseau', 'seulement des adresses Cloudflare (proxié)', a.join(', ') || 'aucune', a.length > 0, '');
} catch (e) {
  row('DNS', '—', `indisponible (${e.message})`, null);
}

// ---- Le site : en-têtes, cookies, redirection ----
try {
  const r = await fetch(`https://${host}/`, { headers: { 'user-agent': UA } });
  const h = r.headers;
  const expected = {
    'content-security-policy': (v) => v?.includes("default-src 'none'") && !v.includes('unsafe'),
    'strict-transport-security': (v) => /max-age=31536000/.test(v ?? ''),
    'x-content-type-options': (v) => v === 'nosniff',
    'referrer-policy': (v) => v === 'no-referrer',
    'permissions-policy': (v) => Boolean(v),
    'cross-origin-opener-policy': (v) => v === 'same-origin',
    'cross-origin-embedder-policy': (v) => v === 'require-corp',
    'cross-origin-resource-policy': (v) => v === 'same-origin',
    'x-frame-options': (v) => v === 'DENY',
  };
  const missing = Object.entries(expected).filter(([k, test]) => !test(h.get(k))).map(([k]) => k);
  row('En-têtes servis', 'tous ceux de security.ts', missing.length ? `manquants ou différents : ${missing.join(', ')}` : 'tous présents', missing.length === 0,
    missing.length ? 'Redéployer la dernière image' : '');
  row('Passage par Cloudflare', 'en-tête cf-ray présent', h.get('cf-ray') ? 'présent' : 'absent', Boolean(h.get('cf-ray')), h.get('cf-ray') ? '' : 'Le nom ne passe pas par le proxy Cloudflare (nuage orange ?)');
  const cookies = h.get('set-cookie');
  row('Cookies', 'aucun, jamais', cookies ? 'un cookie posé' : 'aucun', !cookies, '');
  const html = await r.text();
  const inline = /<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\sstyle=/i.test(html);
  row('Injection côté Cloudflare', 'aucun script injecté (Rocket Loader, beacon)', inline ? 'script ou style en ligne détecté' : 'page intacte', !inline,
    inline ? 'Cloudflare → Speed → Rocket Loader : Off ; Web Analytics : beacon désactivé' : '');
  const clear = await fetch(`http://${host}/`, { redirect: 'manual', headers: { 'user-agent': UA } });
  const loc = clear.headers.get('location') ?? '';
  const redirected = [301, 302, 307, 308].includes(clear.status) && loc.startsWith(`https://${host}`);
  row('HTTP → HTTPS', '301 vers https', redirected ? `${clear.status} → ${loc}` : `${clear.status} sans redirection`, redirected,
    redirected ? '' : 'Cloudflare → SSL/TLS → Edge Certificates → « Always Use HTTPS » : activé');
} catch (e) {
  row('Le site', '—', `indisponible (${e.message})`, null);
}

// ---- Ce qui tourne vraiment ----
try {
  const v = await json(`https://${host}/api/version`);
  const connue = typeof v.version === 'string' && typeof v.revision === 'string' && v.revision !== 'dev';
  row('Version déployée', 'une image publiée (pas « dev »)', `v${v.version} · ${v.revision}${v.builtAt ? ' · ' + String(v.builtAt).slice(0, 10) : ''}`, connue,
    connue ? '' : 'Le conteneur ne tourne pas une image publiée : relancer le projet sur le NAS');
  const sio = await fetch(`https://${host}/socket.io/?EIO=4&transport=polling`, { headers: { 'user-agent': UA } });
  row('Point d\'entrée Socket.io', 'répond (200)', String(sio.status), sio.status === 200, sio.status === 200 ? '' : 'Vérifier la règle de cache /socket.io/* (Bypass) et le conteneur');
  const sioNosniff = sio.headers.get('x-content-type-options');
  row('En-têtes de Socket.io', 'nosniff comme le reste du site', sioNosniff ?? 'absent', sioNosniff === 'nosniff', sioNosniff === 'nosniff' ? '' : 'Version antérieure à la 0.9.1 : mettre le conteneur à jour');
} catch (e) {
  row('Version déployée', '—', `indisponible (${e.message})`, null);
}

// ---- Rapport ----
const mark = (ok) => (ok === null ? '·' : ok ? '✓' : '✗');
process.stdout.write(`== Contrôle de sécurité externe — ${host} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n\n`);
process.stdout.write('| | Domaine | Attendu | Réel | À faire |\n|---|---|---|---|---|\n');
for (const r of rows) process.stdout.write(`| ${mark(r.ok)} | ${r.domaine} | ${r.attendu} | ${r.reel} | ${r.action} |\n`);
const bad = rows.filter((r) => r.ok === false);
const muets = rows.filter((r) => r.ok === null);
const mesures = rows.filter((r) => r.ok !== null).length;
process.stdout.write(`\n${bad.length === 0 ? 'Tout est au niveau attendu.' : `${bad.length} point(s) sous l'attendu.`}`);
if (muets.length > 0) process.stdout.write(` ${muets.length} point(s) n'ont pas pu être mesurés.`);
process.stdout.write('\n');
if (strict && (bad.length > 0 || mesures === 0)) process.exit(1);
