/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Règle de sécurité du client : aucune donnée reçue du réseau n'est jamais interprétée
 * comme du HTML. Ici, seulement textContent et createElement.
 */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément manquant : #${id}`);
  return el as T;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function img(src: string, alt: string, className?: string): HTMLImageElement {
  const el = h('img', className);
  el.src = src;
  el.alt = alt;
  el.decoding = 'async';
  return el;
}

export function show(el: HTMLElement): void {
  el.hidden = false;
}

export function hide(el: HTMLElement): void {
  el.hidden = true;
}

export function fill(container: HTMLElement, ...nodes: (Node | string)[]): void {
  container.textContent = '';
  container.append(...nodes);
}

/** Message bref, non bloquant, lu par les lecteurs d'écran. */
export function toast(text: string, kind: 'info' | 'succes' | 'erreur' = 'info'): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = h('div', `toast toast-${kind}`, text);
  host.append(el);
  setTimeout(() => el.classList.add('toast-sortie'), 3200);
  setTimeout(() => el.remove(), 3800);
}

/** Délégation : plus aucun onclick="" dans le HTML (CSP stricte). */
export function onAction(actions: Record<string, (el: HTMLElement) => void>): void {
  const activate = (target: EventTarget | null): void => {
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset['action'] ?? ''];
    if (fn) fn(el);
  };
  document.addEventListener('click', (e) => activate(e.target));
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLElement && e.target.matches('[role="button"]')) {
      e.preventDefault();
      activate(e.target);
    }
  });
}

export function openDialog(id: string): void {
  const d = $<HTMLDialogElement>(id);
  if (!d.open) d.showModal();
}

export function closeDialog(id: string): void {
  const d = $<HTMLDialogElement>(id);
  if (d.open) d.close();
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Le temps de lire un pli posé au centre : plus court pour qui a demandé moins de mouvement. */
export const dernierPliMs = (): number => (prefersReducedMotion() ? 600 : 1600);
