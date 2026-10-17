import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createApp, CLIENT_DIR } from '../src/app.ts';

/** Toutes les pages du site, pour les contrôles qui valent partout. */
function toutesLesPages(dir: string = CLIENT_DIR): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...toutesLesPages(p));
    else if (nom.endsWith('.html')) out.push(p);
  }
  return out;
}

const FAST = { port: 0, host: '127.0.0.1', timings: { botDelay: 5, forcedDelay: 5, afkTimeout: 60_000 }, botThinkMs: 5, matchmakingSeconds: 60 };

function req(port: number, p: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    r.end();
  });
}

test("PWA : manifeste complet, icônes présentes, agent de service servi depuis la racine", async () => {
  const server = createApp(FAST);
  const { port } = await server.start();
  try {
    const m = await req(port, '/manifest.webmanifest');
    assert.equal(m.status, 200);
    const manifest = JSON.parse(m.body) as Record<string, unknown>;

    // Ce que Chrome, Edge et Android exigent pour proposer l'installation.
    for (const champ of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
      assert.ok(manifest[champ], `manifeste : champ ${champ} manquant`);
    }
    assert.equal(manifest['display'], 'standalone');

    const icons = manifest['icons'] as { src: string; sizes: string; purpose?: string }[];
    const tailles = new Set(icons.map((i) => i.sizes));
    assert.ok(tailles.has('192x192'), 'icône 192 obligatoire');
    assert.ok(tailles.has('512x512'), 'icône 512 obligatoire');
    assert.ok(icons.some((i) => i.purpose === 'maskable'), 'icône maskable attendue (Android)');

    // Toutes les ressources citées par le manifeste doivent exister.
    const cites = [
      ...icons.map((i) => i.src),
      ...(manifest['screenshots'] as { src: string }[]).map((s) => s.src),
      ...(manifest['shortcuts'] as { url: string }[]).map((s) => s.url),
    ];
    for (const url of cites) {
      assert.equal((await req(port, url)).status, 200, `manifeste : ${url} introuvable`);
    }

    // L'agent de service : à la racine, jamais en cache, autorisé à piloter tout le site.
    const sw = await req(port, '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(String(sw.headers['content-type']), /javascript/);
    assert.equal(sw.headers['service-worker-allowed'], '/');
    assert.match(String(sw.headers['cache-control']), /no-cache/);

    // Sa version suit celle du projet : sinon un ancien cache survivrait à une mise à jour.
    const pkg = JSON.parse(readFileSync(path.join(CLIENT_DIR, '..', '..', '..', 'package.json'), 'utf8')) as { version: string };
    assert.ok(sw.body.includes(`const VERSION = '${pkg.version}'`), 'sw.js : VERSION à aligner sur package.json');
    // Chaque page demande ses scripts et ses styles avec l'empreinte de la version : c'est
    // ce qui sort un navigateur resté sur d'anciens fichiers (les pages, elles, sont
    // toujours relues sur le réseau). `node scripts/version.mjs` réaligne le tout.
    for (const page of toutesLesPages()) {
      const html = readFileSync(page, 'utf8');
      for (const m of html.matchAll(/["'](\/(?:js|css)\/[\w./-]+\.(?:js|css)(?:\?v=[\d.]*)?)["']/g)) {
        const url = m[1] ?? '';
        assert.ok(url.endsWith(`?v=${pkg.version}`), `${path.relative(CLIENT_DIR, page)} : ${url} sans l'empreinte ?v=${pkg.version}`);
      }
    }

    // La page de secours hors ligne et la page d'installation existent.
    assert.equal((await req(port, '/hors-ligne/')).status, 200);
    assert.equal((await req(port, '/installer/')).status, 200);

    // L'agent de service doit être autorisé par la politique de sécurité du contenu.
    const accueil = await req(port, '/');
    assert.match(String(accueil.headers['content-security-policy']), /worker-src 'self'/);
    assert.match(accueil.body, /apple-touch-icon/);
    assert.match(accueil.body, /manifest\.webmanifest/);
  } finally {
    await server.close();
  }
});

test("PWA : l'icône iOS est une vraie image, et chaque page la déclare", async () => {
  const server = createApp(FAST);
  const { port } = await server.start();
  try {
    const icone = await req(port, '/img/apple-touch-icon.png');
    assert.equal(icone.status, 200);
    assert.match(String(icone.headers['content-type']), /image\/png/);

    for (const page of ['/', '/profil/', '/installer/', '/jeu/huit-americain/', '/donnees/', '/hors-ligne/']) {
      const r = await req(port, page);
      assert.equal(r.status, 200, page);
      assert.match(r.body, /rel="apple-touch-icon"/, `${page} : icône iOS manquante`);
      assert.match(r.body, /name="theme-color"/, `${page} : couleur de thème manquante`);
    }
  } finally {
    await server.close();
  }
});
