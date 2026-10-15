/*
 * Cartes sur table — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Mode jour / nuit. Par défaut, celui du système ; un bouton le force, et le choix
 * reste dans ce navigateur (stockage local, jamais envoyé). Chargé par toutes les pages.
 */

const KEY = 'jdc.theme';
type Theme = 'light' | 'dark';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme(): Theme {
  return stored() ?? system();
}

export function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.dataset['theme'] = theme;
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* stockage indisponible : le choix vaut pour la page seulement */
    }
  }
  const btn = document.querySelector<HTMLButtonElement>('.theme-btn');
  if (btn) {
    const toLight = theme === 'dark';
    btn.setAttribute('aria-label', toLight ? 'Passer en mode jour' : 'Passer en mode nuit');
    btn.title = btn.getAttribute('aria-label') ?? '';
    btn.textContent = toLight ? '☀' : '☾';
  }
}

function install(): void {
  applyTheme(currentTheme(), false);
  if (!document.querySelector('.theme-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn';
    btn.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));
    document.body.append(btn);
  }
  applyTheme(currentTheme(), false);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!stored()) applyTheme(system(), false);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
else install();
