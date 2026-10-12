import { apiData } from '../../lib/api.ts';
import { ErrorState, PageIntro } from '../../components/site.tsx';

type Person = {
  id: string;
  name: string;
  position: string;
  bio: string | null;
  organization_unit_id: string | null;
  is_chairman: boolean;
  photo_url: string | null;
  photo_alt?: string | null;
};

type Unit = { id: string; name: string; unit_type: 'BIDANG' | 'DIVISI'; parent_id: string | null };
type Organization = {
  organization: { name: string; description: string; history: string; logo_url: string | null; address: string | null; phone: string | null; email: string | null } | null;
  members: Person[];
  units: Unit[];
};

function PersonCard({ person, label }: { person: Person; label: string }) {
  return <article className="person-card">
    {person.photo_url ? <img src={person.photo_url} alt={person.photo_alt ?? person.name} loading="lazy" /> : <div className="person-placeholder" aria-hidden="true">{person.name.slice(0, 1)}</div>}
    <div><p className="eyebrow">{label}</p><h3>{person.name}</h3>{person.bio && <p>{person.bio}</p>}</div>
  </article>;
}

export default async function AboutPage() {
  let organization: Organization | null = null;
  let error = false;
  try { organization = await apiData<Organization>('/api/public/organization'); } catch { error = true; }

  const members = organization?.members ?? [];
  const units = organization?.units ?? [];
  const chairman = members.find(person => person.is_chairman);
  const fields = units.filter(unit => unit.unit_type === 'BIDANG');

  return <main className="container">
    <div className="breadcrumbs"><a href="/">Beranda</a> / Tentang Kami</div>
    <PageIntro eyebrow="Tentang organisasi" title={organization?.organization?.name ?? 'Tentang Kami'} description={organization?.organization?.description ?? null} />
    {error ? <ErrorState /> : <>
      <section className="content-section">
        <h2>Perjalanan kami</h2>
        <p className="about-history">{organization?.organization?.history || 'Informasi sejarah organisasi belum tersedia.'}</p>
        {organization?.organization?.address && <p>Alamat: {organization.organization.address}</p>}
        {organization?.organization?.phone && <p>Telepon: <a href={`tel:${organization.organization.phone}`}>{organization.organization.phone}</a></p>}
        {organization?.organization?.email && <p>Email: <a href={`mailto:${organization.organization.email}`}>{organization.organization.email}</a></p>}
      </section>
      <section className="content-section">
        <div className="section-heading"><div><span className="eyebrow">Orang-orang di balik karya</span><h2>Badan Pengurus</h2></div></div>
        {!chairman && fields.length === 0 && members.length === 0 ? <p>Badan Pengurus belum dipublikasikan.</p> : <div className="organization-chart">
          {chairman && <div className="organization-chair"><PersonCard person={chairman} label="Ketua" /></div>}
          {fields.length > 0 && <div className="organization-fields">{fields.map(field => {
            const fieldHead = members.find(person => person.organization_unit_id === field.id);
            const divisions = units.filter(unit => unit.unit_type === 'DIVISI' && unit.parent_id === field.id);
            return <section className="organization-field" key={field.id}>
              <h3>{field.name}</h3>
              {fieldHead && <PersonCard person={fieldHead} label="Kepala Bidang" />}
              {divisions.length > 0 && <div className="organization-divisions">{divisions.map(division => {
                const head = members.find(person => person.organization_unit_id === division.id);
                return <section className="organization-division" key={division.id}>
                  <h4>{division.name}</h4>
                  {head && <PersonCard person={head} label="Kepala Divisi" />}
                </section>;
              })}</div>}
            </section>;
          })}</div>}
        </div>}
      </section>
    </>}
    <section className="section-soft choice-card"><h2>Ingin mengenal kegiatan kami lebih dekat?</h2><p>Ikuti kabar terbaru organisasi.</p><a className="button" href="/news">Baca berita</a></section>
  </main>;
}
