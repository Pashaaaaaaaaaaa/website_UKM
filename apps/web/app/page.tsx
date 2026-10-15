import Link from 'next/link';
import { apiData, type Article, type RentalItem, type SiteConfig } from '../lib/api.ts';
import { ArticleCard, EmptyState, ErrorState } from '../components/site.tsx';
import { ReferenceMotion } from '../components/reference-motion.tsx';
import { NewsControls } from '../components/news-controls.tsx';
import type { CSSProperties } from 'react';

type Person = { id: string; name: string; position: string; is_chairman: boolean; unit_type?: 'BIDANG' | 'DIVISI' | null; unit_name?: string | null; photo_url?: string | null; photo_alt?: string | null };
type Unit = { id: string; name: string; unit_type: 'BIDANG' | 'DIVISI'; parent_id: string | null };
type Organization = {
  organization: { name: string; description: string; history: string } | null;
  members: Person[];
  units: Unit[];
};
type ArticlesResult = { items: Article[] };

async function read<T>(path: string): Promise<T | null> {
  try { return await apiData<T>(path); } catch { return null; }
}

const price = (value: number | string | undefined) =>
  `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`;

type HomepageMedia = { slot_key: string; url: string | null; alt_text: string | null };
function MediaSlot({ className = '', media }: { className?: string; media?: { url?: string | null | undefined; alt_text?: string | null | undefined } | null | undefined }) {
  return <div className={`home-media ${className}`} aria-hidden={!media?.url || undefined}>{media?.url && <img className="home-media-image" src={media.url} alt={media.alt_text ?? ''} loading="lazy" />}</div>;
}

function Arrow() { return <span aria-hidden="true">↗</span>; }

export default async function HomePage() {
  const [news, danceResult, brtResult, config, organization, homeMediaResult] = await Promise.all([
    read<ArticlesResult>('/api/public/articles?page=1&page_size=4'),
    read<RentalItem[]>('/api/public/rentals/dance/services'),
    read<RentalItem[]>('/api/public/rentals/brt/items'),
    read<SiteConfig>('/api/public/site-config'),
    read<Organization>('/api/public/organization'),
    read<HomepageMedia[]>('/api/public/home-media'),
  ]);
  const articles = news?.items ?? [];
  const homeMedia = Object.fromEntries((homeMediaResult ?? []).map(media => [media.slot_key, media]));
  const dance = danceResult?.slice(0, 3) ?? [];
  const brt = brtResult?.slice(0, 4) ?? [];
  const org = organization?.organization ?? config?.organization ?? null;
  const chair = organization?.members?.find(member => member.is_chairman);
  const structureLeaders = (organization?.members ?? []).filter(member => member.is_chairman || member.unit_type === 'BIDANG');
  const contactHref = config?.manager_whatsapp
    ? `https://wa.me/${config.manager_whatsapp.replace(/\D/g, '')}`
    : config?.organization?.email ? `mailto:${config.organization.email}`
      : config?.organization?.phone ? `tel:${config.organization.phone}` : null;
  const contactLabel = config?.manager_whatsapp ? 'Hubungi lewat WhatsApp'
    : config?.organization?.email ? 'Kirim email kepada pengelola' : 'Telepon pengelola';

  return <main className="home-page">
    <ReferenceMotion />
    <section className="home-hero" id="beranda" aria-labelledby="home-title">
      <div className="home-hero-copy">
        <span className="home-kicker hero-enter" style={{ '--step': '0ms' } as CSSProperties}>UKM Seni dan Budaya</span>
        <h1 id="home-title" className="hero-enter" style={{ '--step': '70ms' } as CSSProperties}>Seni dan budaya,<br />hadir untuk acara Anda</h1>
        <p className="hero-enter" style={{ '--step': '140ms' } as CSSProperties}>Kenali kegiatan UKM, pertunjukan tari, dan perlengkapan acara yang tersedia untuk disewa.</p>
        <div className="home-hero-actions hero-enter" style={{ '--step': '210ms' } as CSSProperties}>
          <Link className="home-button" href="#layanan">Jelajahi layanan sewa <Arrow /></Link>
          <Link className="home-button home-button-outline" href="#tentang">Tentang UKM <Arrow /></Link>
        </div>
      </div>
      <div className="hero-ribbon hero-enter" aria-label="Galeri tiga foto kegiatan UKM" style={{ '--step': '280ms' } as CSSProperties}>
        <MediaSlot className="hero-ribbon-side" media={homeMedia['hero-1']} />
        <MediaSlot className="hero-main-image" media={homeMedia['hero-2']} />
        <MediaSlot className="hero-ribbon-side" media={homeMedia['hero-3']} />
      </div>
    </section>

    <section className="home-about home-section" id="tentang" aria-labelledby="about-title">
      <div className="home-about-top">
        <div className="home-about-copy" data-reveal="slide">
          <span className="home-kicker">Tentang kami</span>
          <h2 id="about-title">Ruang berkegiatan seni dan budaya di kampus</h2>
          <p>{org?.description || 'UKM Seni dan Budaya menjadi ruang bagi mahasiswa untuk berkegiatan dan mengenal seni serta budaya.'}</p>
        </div>
        <MediaSlot className="about-media" media={homeMedia.about} />
      </div>
      <div className="about-facts" data-reveal="rise">
        <article><span className="home-kicker">Perjalanan</span><h3>{org?.name ?? 'UKM Seni dan Budaya'}</h3><p>{organization?.organization?.history || 'Kenali cerita dan informasi organisasi melalui profil UKM.'}</p></article>
        <article><span className="home-kicker">Ruang berkegiatan</span><h3>{org?.name ?? 'UKM Seni dan Budaya'}</h3><p>{org?.description || 'Kegiatan organisasi, layanan tari, dan inventaris perlengkapan acara.'}</p></article>
      </div>
    </section>

    <section className="home-structure home-section" id="struktur-organisasi" aria-labelledby="structure-title">
      <div className="structure-heading" data-reveal="rise"><div><span className="home-kicker">Struktur organisasi</span><h2 id="structure-title">Kenali susunan pengurus</h2></div><div className="structure-actions"><Link className="home-text-link" href="/about#struktur">Lihat struktur organisasi <Arrow /></Link></div></div>
      <p className="structure-description">{chair ? `${chair.position} dan susunan pengurus UKM Seni dan Budaya.` : 'Lihat susunan pengurus dan informasi organisasi pada halaman profil UKM.'}</p>
      {structureLeaders.length > 0 && <div className="structure-ribbon" data-reveal="media" aria-label="Foto ketua dan kepala bidang">{structureLeaders.map(member=><div className="home-media structure-person" key={member.id}>{member.photo_url ? <img className="home-media-image" src={member.photo_url} alt={member.photo_alt ?? `${member.position}: ${member.name}`} loading="lazy" /> : <span className="structure-person-empty">Foto belum ditambahkan</span>}<span className="structure-person-label"><strong>{member.name}</strong><small>{member.is_chairman ? 'Ketua' : `Kepala Bidang ${member.unit_name ?? ''}`}</small></span></div>)}</div>}
    </section>

    <section className="home-services home-section" id="layanan" aria-labelledby="services-title">
      <span className="home-kicker">Pilihan layanan</span>
      <div className="service-intro">
        <h2 id="services-title">Pilih kebutuhan<br className="desktop-break" /> acara Anda</h2>
        <div><MediaSlot className="service-media" media={homeMedia.service} /><p>Pilih pertunjukan tari atau perlengkapan BRT untuk kebutuhan acara.</p></div>
      </div>
      <div className="service-links">
        <Link href="/rentals/dance"><span>01</span><strong>Pertunjukan tari</strong><Arrow /></Link>
        <Link href="/rentals/brt"><span>02</span><strong>Alat musik & perlengkapan BRT</strong><Arrow /></Link>
      </div>
    </section>

    <section className="home-dance home-section" id="layanan-tari" aria-labelledby="dance-title">
      <div className="home-section-heading" data-reveal="rise"><div><span className="home-kicker">Pertunjukan</span><h2 id="dance-title">Layanan tari</h2></div><p>Lihat pilihan pertunjukan dan tarif dari katalog, lalu periksa jadwal.</p></div>
      {danceResult === null ? <ErrorState /> : dance.length ? <div className="dance-showcase" data-reveal="media">
        {dance.map((item, index) => <article className={`dance-item dance-item-${index + 1}`} key={item.id}>
          <MediaSlot className="dance-media" media={{ url: item.image_url, alt_text: item.image_alt ?? item.name }} />
          <div className="dance-item-copy"><span className="home-kicker">Pertunjukan tari</span><h3>{item.name}</h3><p>{item.description}</p><strong>{price(item.price_per_performance)} <small>/ pertunjukan</small></strong></div>
        </article>)}
      </div> : <EmptyState title="Belum ada layanan tari" body="Pilihan pertunjukan akan tampil di katalog setelah dipublikasikan." />}
      <Link className="home-button" href="/rentals/dance">Lihat layanan tari <Arrow /></Link>
    </section>

    <section className="home-brt home-section" id="inventaris-brt" aria-labelledby="brt-title">
      <div className="home-section-heading" data-reveal="rise"><div><span className="home-kicker">Inventaris BRT</span><h2 id="brt-title">Perlengkapan<br />untuk kebutuhan acara</h2></div><p>Lihat kategori barang, jumlah unit, dan tarif katalog. Jadwal dapat diperiksa pada detail sewa.</p></div>
      {brtResult === null ? <ErrorState /> : brt.length ? <div className="brt-showcase">
        {brt.map((item, index) => <article className={`brt-item brt-item-${index + 1}`} data-reveal="rise" key={item.id}>
          <MediaSlot className="brt-media" media={{ url: item.image_url, alt_text: item.image_alt ?? item.name }} />
          <div className="brt-item-copy"><span className="home-kicker">{item.category || 'Perlengkapan'}</span><h3>{item.name}</h3><p>{item.total_quantity ?? '—'} unit</p><strong>{price(item.price_per_unit_per_day)} <small>/ unit / hari</small></strong></div>
        </article>)}
      </div> : <EmptyState title="Belum ada inventaris BRT" body="Barang yang dipublikasikan akan tampil di katalog." />}
      <Link className="home-button" href="/rentals/brt">Jelajahi katalog BRT <Arrow /></Link>
    </section>

    <section className="home-news home-section" id="berita" aria-labelledby="news-title">
      <div className="home-news-heading" data-reveal="slide"><div><span className="home-kicker">Kabar terbaru</span><h2 id="news-title">Berita dari UKM</h2></div><NewsControls /></div>
      {news === null ? <ErrorState /> : articles.length ? <div className="news-track" id="news-track" data-reveal="media">{articles.map(article => <div className="news-slide" key={article.id}><ArticleCard article={article} /></div>)}</div> : <EmptyState title="Belum ada berita" body="Berita yang dipublikasikan akan muncul di sini." />}
    </section>

    <section className="home-contact home-section" id="kontak" aria-labelledby="contact-title">
      <div className="contact-details" data-reveal="rise"><span className="home-kicker">Kontak pengelola</span><h2>Tanyakan layanan, jadwal, dan pembayaran.</h2>
        {config?.organization?.phone && <p><span>Telepon</span><span>{config.organization.phone}</span></p>}
        {config?.organization?.email && <p><span>Email</span><span>{config.organization.email}</span></p>}
        {config?.organization?.address && <p><span>Alamat</span><span>{config.organization.address}</span></p>}
        {contactHref && <a className="home-button" href={contactHref} target={contactHref.startsWith('https://') ? '_blank' : undefined} rel={contactHref.startsWith('https://') ? 'noreferrer' : undefined}>{contactLabel} <Arrow /></a>}
      </div>
      <div className="contact-copy" data-reveal="slide"><span className="home-kicker">UKM Seni dan Budaya</span><h2 id="contact-title">Mari berbincang.</h2><p>Tanyakan kebutuhan pertunjukan tari, perlengkapan acara, jadwal, atau pembayaran kepada pengelola.</p><div className="contact-promises"><p><strong>Informasi layanan</strong><span>Pilihan tari dan inventaris BRT.</span></p><p><strong>Langkah berikutnya</strong><span>Periksa jadwal dan mulai pemesanan.</span></p></div><div className="contact-identity"><span className="brand-mark">U</span><span><small>UKM Seni dan Budaya</small><strong>Kontak pengelola</strong></span></div></div>
    </section>

    <section className="home-footer-feature" aria-label="Informasi UKM"><MediaSlot className="footer-media" media={homeMedia.footer} /><div className="footer-feature-copy"><span className="home-kicker">UKM Seni dan Budaya</span><h2>Seni dan budaya,<br />hadir untuk acara Anda.</h2><Link className="home-button" href="#kontak">Hubungi pengelola <Arrow /></Link></div></section>
  </main>;
}
