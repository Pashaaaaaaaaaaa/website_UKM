'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem('ukm-theme');
    const nextDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light';
  }, []);
  const toggleTheme = () => {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light';
    window.localStorage.setItem('ukm-theme', nextDark ? 'dark' : 'light');
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return <header className="site-header"><div className="container nav-inner">
    <Link className="brand" href="/" aria-label="Beranda"><span className="brand-mark">U</span><span>UKM<span className="brand-muted"> · Seni & Budaya</span></span></Link>
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={dark ? 'Aktifkan mode terang' : 'Aktifkan mode malam'} aria-pressed={dark}><span aria-hidden="true">{dark ? '☀' : '☾'}</span><span className="theme-toggle-label">{dark ? 'Mode terang' : 'Mode malam'}</span></button>
    <button ref={buttonRef} className="mobile-menu-button" type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(value => !value)}><span>{open ? 'Tutup' : 'Menu'}</span></button>
    <nav id="primary-navigation" aria-label="Navigasi utama" className={open ? 'is-open' : ''}>
      <Link href="/about" onClick={() => setOpen(false)}>Tentang Kami</Link>
      <Link href="/rentals" onClick={() => setOpen(false)}>Layanan Sewa</Link>
      <Link href="/news" onClick={() => setOpen(false)}>Berita</Link>
    </nav>
  </div></header>;
}
