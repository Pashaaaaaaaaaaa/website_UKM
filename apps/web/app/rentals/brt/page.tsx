import { RentalExperience } from '../../../components/booking.tsx';
import { ErrorState, PageIntro } from '../../../components/site.tsx';
import { apiData, type RentalItem, type SiteConfig } from '../../../lib/api.ts';

type Category = {id:string;name:string};
export default async function BrtRentalsPage() {
  let items: RentalItem[] = []; let categories: Category[] = []; let config: SiteConfig | null = null; let error = false;
  try { [items, categories, config] = await Promise.all([apiData<RentalItem[]>('/api/public/rentals/brt/items'), apiData<Category[]>('/api/public/rentals/brt/categories'), apiData<SiteConfig>('/api/public/site-config')]); } catch { error = true; }
  return <main className="container"><div className="breadcrumbs"><a href="/rentals">Layanan sewa</a> / Alat musik, kostum, dan barang</div><PageIntro eyebrow="Domain BRT_ADMIN" title="Perlengkapan BRT" description="Pilih barang, jumlah unit, dan tanggal sewa. Stok tersedia dihitung backend untuk setiap hari."/>{error ? <ErrorState/> : <RentalExperience domain="BRT" items={items} categories={categories} managerNumber={config?.manager_whatsapp??null}/>}</main>;
}
