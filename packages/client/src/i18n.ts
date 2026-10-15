/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Dictionnaire du client. Le serveur n'envoie que des codes ; toute phrase lisible
 * vient d'ici. Ajouter une langue = ajouter `i18n/<code>.json` et les pages statiques
 * correspondantes ; aucune ligne de code à changer.
 */

type Catalog = Record<string, string>;
let catalog: Catalog = {};
let locale = 'fr';

export function currentLocale(): string {
  return locale;
}

export async function loadLocale(lang = document.documentElement.lang || 'fr'): Promise<void> {
  locale = lang;
  const res = await fetch(`/i18n/${encodeURIComponent(lang)}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`dictionnaire ${lang} introuvable`);
  const data: unknown = await res.json();
  catalog = flatten(data);
  applyToDocument();
}

function flatten(data: unknown, prefix = '', out: Catalog = {}): Catalog {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof data === 'string') out[prefix] = data;
  return out;
}

/** `t('cle', { n: 3 })` : les `{n}` sont remplacés ; une clé absente est renvoyée telle quelle (visible, donc corrigée). */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const raw = catalog[key];
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (_m, p: string) => String(params[p] ?? `{${p}}`));
}

export function has(key: string): boolean {
  return key in catalog;
}

/** Les éléments portant data-i18n="cle" reçoivent leur texte ; data-i18n-attr="placeholder:cle" pour un attribut. */
export function applyToDocument(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'];
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset['i18nAttr'] ?? '').split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}
