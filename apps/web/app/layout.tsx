import type { ReactNode } from 'react';
import './globals.css';
import { apiData, type SiteConfig } from '../lib/api.ts';
import { Footer, Navbar } from '../components/site.tsx';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: { default: 'UKM · Seni & Budaya', template: '%s · UKM' }, description: 'Berita organisasi dan layanan sewa pertunjukan tari serta perlengkapan BRT.' };
export default async function RootLayout({ children }: { children: ReactNode }) {
  let config:SiteConfig|null=null;try{config=await apiData<SiteConfig>('/api/public/site-config');}catch{/* Render content and page-level API error states when API is unavailable. */}
  return <html lang="id"><body><Navbar/>{children}<Footer config={config}/></body></html>;
}
