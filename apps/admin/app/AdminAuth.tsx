'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Role = 'NEWS_ADMIN' | 'MANAGER' | 'BRT_ADMIN';
type User = { name: string; email: string; role: Role };
const destinations: Record<Role, string> = { NEWS_ADMIN: '/news', MANAGER: '/manager', BRT_ADMIN: '/brt' };
const areas: Record<Role, { endpoint: string; title: string }> = {
  NEWS_ADMIN: { endpoint: '/api/admin/news', title: 'Area administrasi berita' },
  MANAGER: { endpoint: '/api/admin/rentals/dance', title: 'Area manajemen penyewaan tari' },
  BRT_ADMIN: { endpoint: '/api/admin/rentals/brt', title: 'Area administrasi penyewaan BRT' },
};

export function AdminLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }) });
      const result = await response.json() as { data?: { user?: User }; error?: { message?: string } };
      if (!response.ok || !result.data?.user) { setError(result.error?.message ?? 'Tidak dapat masuk.'); return; }
      window.location.replace(destinations[result.data.user.role]);
    } catch { setError('Layanan autentikasi tidak dapat dihubungi.'); }
    finally { setBusy(false); }
  }
  return <main><h1>Masuk Admin</h1><form onSubmit={submit}>
    <label>Email <input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
    <label>Kata sandi <input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
    <button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
    {error && <p role="alert">{error}</p>}
  </form></main>;
}

export function AdminEntry() {
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/auth/me').then(async response => {
      if (!response.ok) { if (active) window.location.replace('/login'); return; }
      const result = await response.json() as { data: { user: User } };
      if (active) window.location.replace(destinations[result.data.user.role]);
    }).catch(() => { if (active) window.location.replace('/login'); });
    return () => { active = false; };
  }, []);
  return <main><p>Memeriksa sesi admin…</p></main>;
}

export function AdminArea({ role }: { role: Role }) {
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('Memeriksa sesi admin…');
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/auth/me').then(async response => {
      if (!response.ok) { if (active) window.location.replace('/login'); return; }
      const result = await response.json() as { data: { user: User } };
      if (!active) return;
      setUser(result.data.user);
      if (result.data.user.role !== role) { window.location.replace(destinations[result.data.user.role]); return; }
      const areaResponse = await fetch(areas[role].endpoint);
      if (active) setMessage(areaResponse.ok ? 'Akses area terverifikasi.' : 'Akses ditolak oleh server.');
    }).catch(() => { if (active) setMessage('API admin tidak dapat dihubungi.'); });
    return () => { active = false; };
  }, [role]);
  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  }
  return <main><header><h1>{areas[role].title}</h1>{user && <p>{user.name} · {user.role}</p>}<button type="button" onClick={logout}>Keluar</button></header><p>{message}</p></main>;
}
