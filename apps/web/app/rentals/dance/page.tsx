import { RentalExperience } from '../../../components/booking.tsx';
import { ErrorState, PageIntro } from '../../../components/site.tsx';
import { apiData, type RentalItem, type SiteConfig } from '../../../lib/api.ts';

export default async function DanceRentalsPage() {
  let items: RentalItem[] = []; let config: SiteConfig | null = null; let error = false;
  try { [items, config] = await Promise.all([apiData<RentalItem[]>('/api/public/rentals/dance/services'), apiData<SiteConfig>('/api/public/site-config')]); } catch { error = true; }
  return <main className="container"><div className="breadcrumbs"><a href="/rentals">Layanan sewa</a> / Tari</div><PageIntro eyebrow="Domain MANAGER" title="Pertunjukan tari" description="Pilih pertunjukan dan tanggal. Ketersediaan diperiksa langsung dari sistem booking."/>{error ? <ErrorState/> : <RentalExperience domain="DANCE" items={items} managerNumber={config?.manager_whatsapp??null}/>}</main>;
}
