/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

// @ts-check

/**
 * Agent de service (« service worker »). Écrit en JavaScript et servi depuis la racine :
 * un agent de service ne peut contrôler que les pages situées sous son propre chemin, et
 * il doit donc être à `/sw.js`, hors du dossier `js/` produit par TypeScript.
 *
 * Son rôle est volontairement étroit :
 *   - rendre le site installable et démarrable même sur un réseau capricieux ;
 *   - ne JAMAIS mettre en cache ce qui est personnel ou vivant (API, parties, profil).
 * Une partie se joue sur le serveur : hors ligne, on ne fait pas semblant, on l'explique.
 */

const VERSION = '0.4.0';
const CACHE = `jdc-${VERSION}`;
const HORS_LIGNE = '/hors-ligne/';

/** Le strict nécessaire pour afficher quelque chose d'utile au premier démarrage. */
const COQUILLE = [
  '/',
  HORS_LIGNE,
  '/css/site.css',
  '/js/accueil.js',
  '/js/theme.js',
  '/js/ui.js',
  '/js/i18n.js',
  '/js/profile.js',
  '/js/avatars.js',
  '/js/installer.js',
  '/js/hors-ligne.js',
  '/i18n/fr.json',
  '/img/favicon.svg',
  '/img/icon-192.png',
  '/manifest.webmanifest',
];

/** Jamais de cache : tout ce qui est personnel, vivant, ou propre à une partie. */
function jamaisEnCache(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/socket.io/')
    || url.pathname === '/healthz';
}

/** Mis en cache à l'usage : les ressources statiques du site, et elles seules. */
function ressourceStatique(url) {
  return /\.(css|js|json|svg|png|webmanifest|woff2?)$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  // `addAll` échoue en bloc : on prend fichier par fichier pour qu'un seul manquant
  // (une page renommée, par exemple) n'empêche pas l'installation.
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(COQUILLE.map((u) => cache.add(u).catch(() => undefined)));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) {
        if (nom.startsWith('jdc-') && nom !== CACHE) await caches.delete(nom);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * La page demande d'appliquer tout de suite une mise à jour en attente.
 * Un agent de service ne reçoit en principe que des messages de ses propres pages, mais
 * on vérifie l'origine explicitement : une règle qu'on applique, on ne la suppose pas.
 */
self.addEventListener('message', (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data === 'appliquer-maj') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || jamaisEnCache(url)) return;

  // Navigation : le réseau d'abord (le site doit être à jour), le cache en secours,
  // et à défaut une page qui dit honnêtement qu'il faut une connexion pour jouer.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const reseau = await fetch(req);
          if (reseau.ok) {
            const cache = await caches.open(CACHE);
            cache.put(req, reseau.clone());
          }
          return reseau;
        } catch {
          return (await caches.match(req))
            ?? (await caches.match(HORS_LIGNE))
            ?? new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })(),
    );
    return;
  }

  // Ressources statiques : le cache d'abord (démarrage instantané), rafraîchies en fond.
  if (ressourceStatique(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const connu = await cache.match(req);
        const frais = fetch(req)
          .then((rep) => {
            if (rep.ok) cache.put(req, rep.clone());
            return rep;
          })
          .catch(() => undefined);
        return connu ?? (await frais) ?? Response.error();
      })(),
    );
  }
});
