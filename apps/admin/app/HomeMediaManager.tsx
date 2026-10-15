'use client';

import { useCallback, useEffect, useState } from 'react';
import { readAdminResponse } from '../lib/api-response.ts';

type Slot = { slot_key: string; media_id: string | null; url: string | null; alt_text: string | null };
const slots = [
  { key: 'hero-1', label: 'Hero, gambar kiri' },
  { key: 'hero-2', label: 'Gambar hero utama' },
  { key: 'hero-3', label: 'Hero, gambar kanan' },
  { key: 'about', label: 'Profil organisasi' },
  { key: 'service', label: 'Pilihan layanan' },
  { key: 'footer', label: 'Bagian penutup beranda' },
];
const tokenKey = 'ukm.admin.session-token';
const contextKey = 'ukm.admin.tab-context';

async function request(path: string, init?: RequestInit) {
  const context = window.sessionStorage.getItem(contextKey);
  const token = window.sessionStorage.getItem(tokenKey);
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(context ? { 'X-Admin-Tab-ID': context } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  return readAdminResponse(response);
}

export function HomeMediaManager() {
  const [media, setMedia] = useState<Record<string, Slot>>({});
  const [message, setMessage] = useState('Memuat slot gambar…');
  const [busySlot, setBusySlot] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await request('/api/admin/home-media') as Slot[];
      setMedia(Object.fromEntries(result.map(slot => [slot.slot_key, slot])));
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Slot gambar tidak dapat dimuat.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upload(slotKey: string, label: string, file: File) {
    setBusySlot(slotKey); setMessage('');
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 8 MB.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan gambar JPG, PNG, atau WebP.');
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Gagal membaca file.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      const created = await request('/api/admin/media', { method: 'POST', body: JSON.stringify({ bucket: 'organization', filename: file.name, mime_type: file.type, data_base64: encoded, alt_text: label }) }) as { id: string };
      await request(`/api/admin/home-media/${slotKey}`, { method: 'PUT', body: JSON.stringify({ media_id: created.id }) });
      await load();
      setMessage(`${label} berhasil diperbarui.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gambar tidak dapat disimpan.'); }
    finally { setBusySlot(''); }
  }

  async function clear(slot: typeof slots[number]) {
    setBusySlot(slot.key); setMessage('');
    try {
      await request(`/api/admin/home-media/${slot.key}`, { method: 'PUT', body: JSON.stringify({ media_id: null }) });
      await load();
      setMessage(`${slot.label} dikosongkan.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Slot gambar tidak dapat dikosongkan.'); }
    finally { setBusySlot(''); }
  }

  return <section aria-labelledby="home-media-title">
    <h2 id="home-media-title">Gambar beranda</h2>
    <p>Unggah gambar untuk slot visual beranda. Format JPG, PNG, atau WebP, maksimal 8 MB per gambar.</p>
    {message && <p role="status">{message}</p>}
    <div className="home-media-admin-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 16 }}>
      {slots.map(slot => {
        const current = media[slot.key];
        const busy = busySlot === slot.key;
        return <article key={slot.key} style={{ minWidth: 0, padding: 16, border: '1px solid #d5d8d2', borderRadius: 12 }}>
          <h3>{slot.label}</h3>
          {current?.url ? <img src={current.url} alt={current.alt_text ?? slot.label} style={{ display: 'block', width: '100%', height: 150, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }} /> : <div aria-label="Slot belum memiliki gambar" style={{ height: 150, display: 'grid', placeItems: 'center', background: '#ecece8', color: '#555', borderRadius: 8, marginBottom: 12 }}>Belum ada gambar</div>}
          <label>Ganti gambar<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(slot.key, slot.label, file); event.currentTarget.value = ''; }} /></label>
          {current?.media_id && <button type="button" disabled={busy} onClick={() => void clear(slot)}>{busy ? 'Menyimpan…' : 'Hapus gambar'}</button>}
        </article>;
      })}
    </div>
  </section>;
}
