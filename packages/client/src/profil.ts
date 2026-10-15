/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import './theme.ts';
import { $, h, show, hide, toast, onAction, openDialog, closeDialog, fill } from './ui.ts';
import { loadLocale, t, has } from './i18n.ts';
import {
  fetchProfile, createProfile, restoreProfile, updateProfile, exportProfile, deleteProfile, getToken, setToken, getGuest, setGuest,
  formatRecoveryCode, type ProfileData,
} from './profile.ts';
import { passkeysSupported, registerPasskey, deletePasskey, signInWithPasskey, revokeSessions } from './passkeys.ts';
import { avatarSrc, renderAvatarPicker } from './avatars.ts';

const ALL_ACHIEVEMENTS = [
  'premiere-partie', 'premiere-victoire', 'dix-victoires', 'cinquante-parties', 'touche-a-tout',
  'huit-americain:huit-magique', 'huit-americain:sans-pioche', 'huit-americain:coup-du-sept', 'huit-americain:manche-parfaite',
];

let avatarNew = getGuest().avatar;
let avatarEdit = 0;

function copy(text: string): void {
  navigator.clipboard?.writeText(text).then(() => toast(t('site.copied'), 'succes'), () => undefined);
}

function render(data: ProfileData): void {
  hide($('sans-profil'));
  show($('avec-profil'));
  $('pseudo-actuel').textContent = data.profile.pseudo;
  $<HTMLImageElement>('avatar-actuel').src = avatarSrc(data.profile.avatar);
  $('depuis').textContent = t('profile.member_since', { date: new Date(data.profile.createdAt * 1000).toLocaleDateString(document.documentElement.lang) });
  $<HTMLInputElement>('pseudo-edit').value = data.profile.pseudo;
  avatarEdit = data.profile.avatar;
  renderAvatarPicker($('avatars-edit'), avatarEdit, (n) => { avatarEdit = n; });

  const stats = $('stats');
  stats.textContent = '';
  if (data.stats.length === 0) stats.append(h('p', '', t('profile.stats_none')));
  for (const s of data.stats) {
    const nameKey = `games.${s.game}.name`;
    const box = h('div', 'stat');
    box.append(h('div', '', has(nameKey) ? t(nameKey) : s.game));
    box.append(h('b', '', `${s.wins} / ${s.matches}`));
    box.append(h('small', '', `${t('profile.wins')} / ${t('profile.matches')} — ${s.rounds} ${t('profile.rounds')}`));
    stats.append(box);
  }

  const got = new Map(data.achievements.map((a) => [a.code, a.unlockedAt]));
  $('succes-compte').textContent = t('profile.achievements_count', { n: got.size, total: ALL_ACHIEVEMENTS.length });
  const list = $('succes');
  list.textContent = '';
  if (got.size === 0) list.append(h('p', '', t('profile.achievements_none')));
  for (const code of ALL_ACHIEVEMENTS) {
    const unlocked = got.has(code);
    const row = h('div', `succes${unlocked ? '' : ' verrou'}`);
    row.append(h('span', 'pastille', unlocked ? '★' : '·'));
    const txt = h('div');
    txt.append(h('b', '', t(`achievements.${code}.name`)));
    txt.append(h('small', '', t(`achievements.${code}.desc`)));
    row.append(txt);
    list.append(row);
  }
}

function renderPasskeys(data: ProfileData): void {
  const zone = $('passkeys');
  const list = $('passkeys-liste');
  list.textContent = '';
  if (!passkeysSupported()) {
    hide(zone);
    return;
  }
  show(zone);
  const keys = data.passkeys ?? [];
  if (keys.length === 0) list.append(h('p', '', t('passkeys.none')));
  for (const k of keys) {
    const row = h('div', 'passkey');
    const txt = h('div');
    txt.append(h('b', '', k.name));
    const since = new Date(k.createdAt * 1000).toLocaleDateString(document.documentElement.lang);
    const last = k.lastUsedAt ? new Date(k.lastUsedAt * 1000).toLocaleDateString(document.documentElement.lang) : null;
    txt.append(h('small', '', last ? t('passkeys.used', { date: since, last }) : t('passkeys.added', { date: since })));
    row.append(txt);
    const del = h('button', 'btn btn-craie petit', t('passkeys.remove'));
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(t('passkeys.remove_confirm', { name: k.name }))) return;
      const ok = await deletePasskey(k.id).catch(() => false);
      if (!ok) {
        toast(t('site.offline'), 'erreur');
        return;
      }
      data.passkeys = keys.filter((x) => x.id !== k.id);
      renderPasskeys(data);
      toast(t('passkeys.removed'), 'succes');
    });
    row.append(del);
    list.append(row);
  }
  const sessions = data.sessions ?? 0;
  $('sessions-info').textContent = sessions > 0 ? t('passkeys.sessions', { n: sessions }) : '';
  (sessions > 0 ? show : hide)($('btn-revoke'));
}

function renderNone(): void {
  show($('sans-profil'));
  hide($('avec-profil'));
  $<HTMLInputElement>('pseudo').value = getGuest().name;
  renderAvatarPicker($('avatars'), avatarNew, (n) => { avatarNew = n; });
}

async function main(): Promise<void> {
  await loadLocale();
  let current: ProfileData | null = await fetchProfile().catch(() => null);
  if (current) {
    render(current);
    renderPasskeys(current);
  } else {
    renderNone();
  }
  (passkeysSupported() ? show : hide)($('btn-passkey-signin'));

  onAction({
    'create': async () => {
      const pseudo = $<HTMLInputElement>('pseudo').value.trim() || t('site.guest');
      try {
        const { token, data } = await createProfile(pseudo, avatarNew);
        setGuest({ name: pseudo, avatar: avatarNew });
        $('code-nouveau').textContent = formatRecoveryCode(token);
        openDialog('dlg-code');
        current = data;
        render(data);
        renderPasskeys(data);
        toast(t('profile.created'), 'succes');
      } catch {
        toast(t('site.offline'), 'erreur');
      }
    },
    'copy-new-code': () => copy($('code-nouveau').textContent ?? ''),
    'code-done': () => closeDialog('dlg-code'),
    'show-restore': () => show($('restaurer')),
    'restore': async () => {
      const data = await restoreProfile($<HTMLInputElement>('code').value).catch(() => null);
      if (!data) {
        toast(t('profile.restore_failed'), 'erreur');
        return;
      }
      current = data;
      render(data);
      renderPasskeys(data);
    },
    'passkey-signin': async () => {
      let data: ProfileData | null = null;
      try {
        data = await signInWithPasskey();
      } catch {
        data = null;
      }
      if (!data) {
        toast(t('passkeys.signin_failed'), 'erreur');
        return;
      }
      current = data;
      render(data);
      renderPasskeys(data);
      toast(t('passkeys.signed_in'), 'succes');
    },
    'passkey-add': async () => {
      if (!current) return;
      const name = $<HTMLInputElement>('passkey-nom').value.trim() || t('passkeys.default_name');
      let added: Awaited<ReturnType<typeof registerPasskey>> = null;
      try {
        added = await registerPasskey(name);
      } catch {
        added = null;
      }
      if (!added) {
        toast(t('passkeys.add_failed'), 'erreur');
        return;
      }
      current.passkeys = [...(current.passkeys ?? []), added];
      $<HTMLInputElement>('passkey-nom').value = '';
      renderPasskeys(current);
      toast(t('passkeys.added_ok'), 'succes');
    },
    'revoke-sessions': async () => {
      if (!current) return;
      const n = await revokeSessions().catch(() => null);
      if (n === null) {
        toast(t('site.offline'), 'erreur');
        return;
      }
      current.sessions = 0;
      renderPasskeys(current);
      toast(t('passkeys.revoked', { n }), 'succes');
    },
    'save': async () => {
      const pseudo = $<HTMLInputElement>('pseudo-edit').value.trim();
      const p = await updateProfile({ pseudo, avatar: avatarEdit }).catch(() => null);
      if (!p) {
        toast(t('site.offline'), 'erreur');
        return;
      }
      $('pseudo-actuel').textContent = p.pseudo;
      $<HTMLImageElement>('avatar-actuel').src = avatarSrc(p.avatar);
      toast(t('profile.saved'), 'succes');
    },
    'show-code': () => {
      const token = getToken();
      if (!token) return;
      $('code-affiche').textContent = formatRecoveryCode(token);
      show($('code-zone'));
    },
    'hide-code': () => {
      $('code-affiche').textContent = '';
      hide($('code-zone'));
    },
    'copy-code': () => copy($('code-affiche').textContent ?? ''),
    'export': async () => {
      const blob = await exportProfile().catch(() => null);
      if (!blob) {
        toast(t('site.offline'), 'erreur');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = h('a');
      a.href = url;
      a.download = 'mon-profil-jeuxdecartes.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    'signout': () => {
      setToken(null);
      toast(t('profile.signed_out'), 'info');
      renderNone();
    },
    'delete': async () => {
      if (!confirm(t('profile.delete_confirm'))) return;
      const ok = await deleteProfile().catch(() => false);
      toast(ok ? t('profile.deleted') : t('site.offline'), ok ? 'succes' : 'erreur');
      renderNone();
    },
  });
  void fill;
}

main().catch((err: unknown) => {
  console.error(err);
  toast(t('site.offline'), 'erreur');
});
