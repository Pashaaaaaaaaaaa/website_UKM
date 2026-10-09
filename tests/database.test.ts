import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabase, getPool } from '../packages/database/src/client.ts';

const configured = Boolean(process.env.DATABASE_URL);
describe('PostgreSQL integration', { skip: !configured }, () => {
  after(async () => { await getPool().end(); });

  it('connects and confirms the initial migration was applied', async () => {
    await checkDatabase();
    const result = await getPool().query("SELECT name FROM schema_migrations WHERE name='001_initial_schema.sql'");
    assert.equal(result.rowCount, 1);
    const authMigration = await getPool().query("SELECT name FROM schema_migrations WHERE name='002_admin_auth.sql'");
    assert.equal(authMigration.rowCount, 1);
    const authTables = await getPool().query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name='admin_sessions'`);
    assert.equal(authTables.rowCount, 1);
    const roleAudit = await getPool().query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='audit_logs' AND column_name='actor_role'`);
    assert.equal(roleAudit.rowCount, 1);
  });

  it('has the documented development seed records after db:seed', async () => {
    const result = await getPool().query(`SELECT
      (SELECT count(*) FROM admin_users WHERE is_development_seed) AS admins,
      (SELECT count(*) FROM dance_services) AS dance_services,
      (SELECT count(*) FROM inventory_items) AS inventory_items,
      (SELECT count(*) FROM articles) AS articles,
      (SELECT count(*) FROM organization_members) AS members,
      (SELECT count(*) FROM organization_members WHERE name LIKE 'Anggota Contoh%') AS seeded_members`);
    assert.equal(result.rows[0].admins, '3');
    assert.ok(Number(result.rows[0].dance_services) >= 3);
    assert.ok(Number(result.rows[0].inventory_items) >= 6);
    assert.ok(Number(result.rows[0].articles) >= 2);
    assert.ok(Number(result.rows[0].members) >= 2);
    assert.equal(result.rows[0].seeded_members, '2');
  });

  it('enforces rental domain integrity and preserves historical price snapshots', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const role = await client.query("SELECT id FROM roles WHERE code='MANAGER'");
      const admin = await client.query("INSERT INTO admin_users(name,email,password_hash,role_id) VALUES('Integration','integration-'||gen_random_uuid()||'@test.invalid','x',$1) RETURNING id",[role.rows[0].id]);
      const service = await client.query("INSERT INTO dance_services(name,slug,price_per_performance) VALUES('Integration','integration-'||gen_random_uuid(),100) RETURNING id");
      const booking = await client.query("INSERT INTO bookings(booking_code,customer_name,customer_phone,rental_domain,start_date,end_date) VALUES('TEST-'||gen_random_uuid(),'Test','123','DANCE',current_date,current_date) RETURNING id");
      await client.query("INSERT INTO booking_items(booking_id,service_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,1,100,1,100)",[booking.rows[0].id,service.rows[0].id]);
      await client.query('UPDATE dance_services SET price_per_performance=250 WHERE id=$1',[service.rows[0].id]);
      const snapshot = await client.query('SELECT unit_price_snapshot FROM booking_items WHERE booking_id=$1',[booking.rows[0].id]);
      assert.equal(Number(snapshot.rows[0].unit_price_snapshot), 100);
      const item = await client.query("INSERT INTO inventory_categories(name,slug) VALUES('Integration','integration-'||gen_random_uuid()) RETURNING id");
      const stock = await client.query("INSERT INTO inventory_items(category_id,name,slug,price_per_unit_per_day,total_quantity) VALUES($1,'Test','integration-'||gen_random_uuid(),10,1) RETURNING id",[item.rows[0].id]);
      await client.query('SAVEPOINT invalid_domain');
      await assert.rejects(client.query("INSERT INTO booking_items(booking_id,item_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,1,10,1,10)",[booking.rows[0].id,stock.rows[0].id]), (error: { code?: string }) => error.code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT invalid_domain');
      await client.query('ROLLBACK');
      void admin;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  it('rejects invalid role codes at the database boundary', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SAVEPOINT invalid_role');
      await assert.rejects(client.query("INSERT INTO roles(code,name) VALUES('CUSTOMER','Customer')"), (error: { code?: string }) => error.code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT invalid_role');
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
