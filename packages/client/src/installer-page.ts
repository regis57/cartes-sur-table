/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import './theme.ts';
import { $, h, show, hide, toast } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';
import { dejaInstallee, enregistrerAgent, installer, inviteDisponible, plateforme, surChangement, type Plateforme } from './installer.ts';

/** Ordre d'affichage des autres navigateurs, le plus courant d'abord. */
const TOUTES: Plateforme[] = [
  'bureau-chromium', 'bureau-safari', 'bureau-firefox',
  'android-chrome', 'android-samsung', 'android-firefox',
  'ios-safari', 'ios-autre',
];

/** Les étapes sont numérotées dans le dictionnaire : install.<plateforme>.1, .2, … */
function etapes(p: Plateforme): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const cle = `install.${p}.${i}`;
    if (!has(cle)) break;
    out.push(t(cle));
  }
  return out;
}

function remplirEtapes(p: Plateforme): void {
  $('pas-a-pas-titre').textContent = t(`install.${p}.titre`);
  $('pas-a-pas-intro').textContent = has(`install.${p}.intro`) ? t(`install.${p}.intro`) : '';
  const liste = $('etapes');
  liste.textContent = '';
  for (const etape of etapes(p)) liste.append(h('li', '', etape));
  const note = $('pas-a-pas-note');
  if (has(`install.${p}.note`)) {
    note.textContent = t(`install.${p}.note`);
    show(note);
  } else {
    hide(note);
  }
}

function remplirAutres(courante: Plateforme): void {
  const zone = $('autres');
  zone.textContent = '';
  for (const p of TOUTES) {
    if (p === courante) continue;
    const bloc = h('details', 'autre');
    const titre = h('summary', '', t(`install.${p}.titre`));
    bloc.append(titre);
    const liste = h('ol', 'etapes');
    for (const etape of etapes(p)) liste.append(h('li', '', etape));
    bloc.append(liste);
    if (has(`install.${p}.note`)) bloc.append(h('p', 'attention', t(`install.${p}.note`)));
    zone.append(bloc);
  }
}

async function main(): Promise<void> {
  await loadLocale();
  enregistrerAgent();

  const p = plateforme();
  remplirEtapes(p);
  remplirAutres(p);

  if (dejaInstallee()) {
    show($('deja'));
    hide($('pas-a-pas'));
    return;
  }

  const bouton = $<HTMLButtonElement>('btn-installer');
  const majBouton = (): void => {
    if (inviteDisponible()) {
      show($('bouton-zone'));
      $('pas-a-pas-titre').textContent = t('install.steps_fallback_title');
    } else {
      hide($('bouton-zone'));
    }
  };
  surChangement(majBouton);
  majBouton();

  bouton.addEventListener('click', () => {
    void (async () => {
      bouton.disabled = true;
      const res = await installer();
      bouton.disabled = false;
      if (res === true) toast(t('install.done'), 'succes');
      else if (res === null) toast(t('install.manual'), 'info');
      majBouton();
    })();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
