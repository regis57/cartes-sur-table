/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Installation du site comme application, sur le bureau comme sur le téléphone.
 *
 * Deux chemins, parce que les navigateurs ne se valent pas :
 *  - Chrome, Edge, Opera, Samsung Internet et Firefox pour Android proposent une
 *    invite native ; on la capte et on l'ouvre quand la personne clique ;
 *  - Safari (iPhone, iPad, macOS) et Firefox pour ordinateur n'ont pas d'interface
 *    programmable : Apple impose un geste manuel. On affiche alors la marche à suivre,
 *    pas à pas, pour le navigateur réellement utilisé.
 */

/** L'évènement de Chrome ; il n'est pas dans les types standards du DOM. */
interface InvitePromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Plateforme =
  | 'android-chrome'
  | 'android-firefox'
  | 'android-samsung'
  | 'ios-safari'
  | 'ios-autre'
  | 'bureau-chromium'
  | 'bureau-safari'
  | 'bureau-firefox'
  | 'inconnue';

let invite: InvitePromptEvent | null = null;
let onChange: (() => void) | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // sinon Chrome affiche sa propre barre, au moment qu'il choisit
  invite = e as InvitePromptEvent;
  onChange?.();
});

window.addEventListener('appinstalled', () => {
  invite = null;
  onChange?.();
});

/** Prévient quand l'invite native devient disponible (ou disparaît). */
export function surChangement(fn: () => void): void {
  onChange = fn;
}

/** L'application tourne-t-elle déjà en fenêtre installée ? */
export function dejaInstallee(): boolean {
  const iosAutonome = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosAutonome
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches;
}

/** Une invite native est-elle prête ? */
export function inviteDisponible(): boolean {
  return invite !== null;
}

/**
 * Reconnaît le navigateur. L'ordre compte : sur iPad, Safari se présente comme un Mac,
 * et Chrome, Edge et Opera se présentent tous comme Chrome.
 */
export function plateforme(): Plateforme {
  const ua = navigator.userAgent;
  const tactile = navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPod/.test(ua) || /iPad/.test(ua) || (/Macintosh/.test(ua) && tactile);

  if (ios) {
    // Sur iOS, tous les navigateurs utilisent le moteur de Safari ; seuls leurs noms changent.
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-autre' : 'ios-safari';
  }
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
    if (/Firefox/.test(ua)) return 'android-firefox';
    return 'android-chrome';
  }
  if (/Firefox/.test(ua)) return 'bureau-firefox';
  if (/Edg\//.test(ua) || /Chrome\//.test(ua) || /Chromium/.test(ua)) return 'bureau-chromium';
  if (/Safari/.test(ua)) return 'bureau-safari';
  return 'inconnue';
}

/**
 * Ouvre l'invite native. Renvoie `true` si la personne a accepté, `false` sinon,
 * et `null` s'il n'y avait pas d'invite à ouvrir (à ce moment-là, on explique à la main).
 */
export async function installer(): Promise<boolean | null> {
  if (!invite) return null;
  const courante = invite;
  invite = null; // une invite ne sert qu'une fois
  onChange?.();
  try {
    await courante.prompt();
    const { outcome } = await courante.userChoice;
    return outcome === 'accepted';
  } catch {
    return null;
  }
}

/**
 * Enregistre l'agent de service. Sans lui, pas d'installation possible sur Chrome,
 * et pas de démarrage sur réseau capricieux. L'échec n'est jamais bloquant : le site
 * fonctionne exactement pareil sans.
 */
/** Une nouvelle version du site vient de prendre la main : la page le signale, et se recharge si rien n'est en cours. */
export const EVENEMENT_NOUVELLE_VERSION = 'jdc-nouvelle-version';

export function enregistrerAgent(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // Quand la nouvelle version a pris la main, les scripts déjà chargés sont périmés : un
  // vieux client face à un serveur neuf affiche des étiquettes fausses (vu au tarot). Hors
  // table, on recharge sans attendre ; à table, la salle recharge au prochain écran.
  let dejaControle = Boolean(sw.controller);
  sw.addEventListener('controllerchange', () => {
    if (!dejaControle) {
      dejaControle = true; // première installation : rien à recharger
      return;
    }
    window.dispatchEvent(new Event(EVENEMENT_NOUVELLE_VERSION));
    const table = document.getElementById('table');
    if (!table || table.hidden) location.reload();
  });
  const poser = (): void => {
    sw.register('/sw.js', { scope: '/' }).then((reg) => {
      // Une version en attente s'applique tout de suite ; une version qui arrive aussi.
      const appliquer = (w: ServiceWorker | null): void => {
        if (w && sw.controller) w.postMessage('appliquer-maj');
      };
      appliquer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed') appliquer(w);
        });
      });
      // Et on vérifie à chaque retour sur la page : une mise à jour du serveur ne doit
      // pas attendre le lendemain.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    }).catch(() => {
      /* navigation privée, stockage refusé, ou site servi sans HTTPS : tant pis */
    });
  };
  // On attend la fin du chargement pour ne pas disputer la bande passante aux pages,
  // mais sans rater l'évènement : cette fonction peut être appelée après coup.
  if (document.readyState === 'complete') poser();
  else window.addEventListener('load', poser, { once: true });
}
