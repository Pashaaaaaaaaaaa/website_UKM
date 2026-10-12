import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool } from './client.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development seed is disabled in production');
const pool = getPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`INSERT INTO roles (code, name) VALUES
    ('NEWS_ADMIN','News Admin'),('MANAGER','Manager'),('BRT_ADMIN','BRT Admin') ON CONFLICT (code) DO NOTHING`);
  const seedPassword = await bcrypt.hash('ChangeMe-Dev-Only-123!', 12);
  const admins = [
    ['News Admin', 'news-admin@development.invalid', 'NEWS_ADMIN'],
    ['Manager', 'manager@development.invalid', 'MANAGER'],
    ['BRT Admin', 'brt-admin@development.invalid', 'BRT_ADMIN'],
  ] as const;
  for (const [name, email, role] of admins) {
    await client.query(`INSERT INTO admin_users(name,email,password_hash,role_id,is_development_seed)
      SELECT $1,$2,$3,id,true FROM roles WHERE code=$4 ON CONFLICT(email) DO NOTHING`, [name, email, seedPassword, role]);
  }
  await client.query(`INSERT INTO article_categories(name,slug) VALUES ('Berita','berita'),('Kegiatan','kegiatan') ON CONFLICT(slug) DO NOTHING`);
  const admin = await client.query<{ id: string }>("SELECT id FROM admin_users WHERE email='news-admin@development.invalid'");
  const articles = [
    ['Selamat Datang', 'selamat-datang', 'Berita pengembangan organisasi dan layanannya.', 'berita'],
    ['Kegiatan Seni Budaya', 'kegiatan-seni-budaya', 'Informasi kegiatan seni budaya komunitas.', 'kegiatan'],
  ];
  for (const [title, slug, body, categorySlug] of articles) await client.query(`INSERT INTO articles(title,slug,body,content,category_id,author_id,status,published_at)
    SELECT $1,$2,$3,$3,c.id,$4,'PUBLISHED',now() FROM article_categories c WHERE c.slug=$5
    ON CONFLICT(slug) DO UPDATE SET category_id=COALESCE(articles.category_id,EXCLUDED.category_id)`, [title, slug, body, admin.rows[0]!.id, categorySlug]);
  await client.query(`INSERT INTO organization_info(singleton_key,name,history)
    VALUES(true,'Organisasi UKM','Data contoh pengembangan; ganti dengan sejarah organisasi yang telah diverifikasi.') ON CONFLICT(singleton_key) DO NOTHING`);
  await client.query(`INSERT INTO organization_members(name,position,sort_order)
    SELECT v.name,v.position,v.sort_order FROM (VALUES
      ('Anggota Contoh Satu','Ketua',1),('Anggota Contoh Dua','Sekretaris',2)
    ) AS v(name,position,sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.name=v.name AND m.position=v.position)`);
  await client.query(`INSERT INTO organization_units(name,unit_type,sort_order)
    SELECT 'Bidang Seni Budaya','BIDANG',1 WHERE NOT EXISTS(SELECT 1 FROM organization_units WHERE unit_type='BIDANG' AND lower(name)=lower('Bidang Seni Budaya'))`);
  await client.query(`INSERT INTO organization_units(name,unit_type,parent_id,sort_order)
    SELECT 'Divisi Tari','DIVISI',u.id,1 FROM organization_units u WHERE u.unit_type='BIDANG' AND lower(u.name)=lower('Bidang Seni Budaya')
    AND NOT EXISTS(SELECT 1 FROM organization_units d WHERE d.unit_type='DIVISI' AND d.parent_id=u.id AND lower(d.name)=lower('Divisi Tari'))`);
  await client.query(`UPDATE organization_members SET is_chairman=true,position='Ketua'
    WHERE id=(SELECT id FROM organization_members WHERE name='Anggota Contoh Satu' ORDER BY created_at LIMIT 1)
    AND NOT EXISTS(SELECT 1 FROM organization_members WHERE is_chairman AND is_active)`);
  await client.query(`UPDATE organization_members SET organization_unit_id=(SELECT id FROM organization_units WHERE unit_type='DIVISI' AND lower(name)=lower('Divisi Tari') LIMIT 1),position='Anggota Divisi Tari'
    WHERE name='Anggota Contoh Dua' AND organization_unit_id IS NULL`);
  const dance = [
    ['Tari Tradisional A','tari-tradisional-a',1500000],['Tari Tradisional B','tari-tradisional-b',2000000],['Pentas Kolaborasi','pentas-kolaborasi',3500000],
  ];
  for (const [name, slug, price] of dance) await client.query(`INSERT INTO dance_services(name,slug,price_per_performance)
    VALUES($1,$2,$3) ON CONFLICT(slug) DO NOTHING`, [name, slug, price]);
  const categories = [['Alat Musik','alat-musik'],['Kostum','kostum'],['Perlengkapan Lain','perlengkapan-lain']] as const;
  for (const [name, slug] of categories) await client.query('INSERT INTO inventory_categories(name,slug) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING',[name,slug]);
  const goods = [
    ['Kendang','kendang','alat-musik',50000,4],['Gong','gong','alat-musik',75000,2],['Kostum Tari A','kostum-tari-a','kostum',100000,12],
    ['Kostum Tari B','kostum-tari-b','kostum',125000,8],['Selendang','selendang','perlengkapan-lain',15000,30],['Satu Set Gamelan','set-gamelan','alat-musik',300000,1],
  ] as const;
  for (const [name,slug,category,price,quantity] of goods) await client.query(`INSERT INTO inventory_items(name,slug,category_id,price_per_unit_per_day,total_quantity)
    SELECT $1,$2,id,$4,$5 FROM inventory_categories WHERE slug=$3 ON CONFLICT(slug) DO NOTHING`,[name,slug,category,price,quantity]);
  await client.query('COMMIT');
  console.log('Development seed complete. Credentials and content are development-only; see README.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
