import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { createApp } from '../packages/api/src/server.ts';
import type { AdminRole } from '../packages/api/src/auth.ts';

const USER_ID = '8b9a35c2-e0d4-4ce2-8d39-074f746bfc87';
const EMAIL = 'news@example.test';
const PASSWORD = 'Testing-password-123!';
const hash = await bcrypt.hash(PASSWORD, 4);

class FakePool {
  role: AdminRole;
  active = true;
  sessionExpired = false;
  sessions = new Set<string>();
  loginAttempts = new Map<string, { failed_attempts: number; window_started_at: Date }>();
  loginLimitsUnavailable = false;
  audits: string[] = [];
  constructor(role: AdminRole) { this.role = role; }
  async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith('INSERT INTO auth_login_attempts')) {
      if(this.loginLimitsUnavailable)throw Object.assign(new Error('relation does not exist'),{code:'42P01'});
      const key=String(values[0]),now=new Date(String(values[1])),window=Number(values[2]),max=Number(values[3]),entry=this.loginAttempts.get(key);
      if(!entry||entry.window_started_at.getTime()<=now.getTime()-window)this.loginAttempts.set(key,{failed_attempts:1,window_started_at:now});
      else if(entry.failed_attempts<=max)entry.failed_attempts+=1;
      const current=this.loginAttempts.get(key)!;
      return {rowCount:1,rows:[{failed_attempts:current.failed_attempts,window_active:current.window_started_at.getTime()>now.getTime()-window}]};
    }
    if (sql.startsWith('DELETE FROM auth_login_attempts')) { this.loginAttempts.delete(String(values[0])); return {rowCount:1,rows:[]}; }
    if (sql.includes('FROM admin_users u JOIN roles')) {
      const exists = this.active && values[0] === EMAIL;
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ id: USER_ID, name: 'Admin User', email: EMAIL, role: this.role, password_hash: hash, is_active: true }] : [] };
    }
    if (sql.startsWith('INSERT INTO admin_sessions')) { this.sessions.add(String(values[1])); return { rowCount: 1, rows: [] }; }
    if (sql.includes('FROM admin_sessions s JOIN admin_users')) {
      const tokenHash = String(values[0]);
      const valid = this.sessions.has(tokenHash) && !this.sessionExpired;
      return { rowCount: valid ? 1 : 0, rows: valid ? [{ id: USER_ID, name: 'Admin User', email: EMAIL, role: this.role, expires_at: new Date(Date.now() + 600_000) }] : [] };
    }
    if (sql.startsWith('DELETE FROM admin_sessions')) { this.sessions.delete(String(values[0])); return { rowCount: 1, rows: [] }; }
    if (sql.startsWith('INSERT INTO audit_logs')) { this.audits.push(String(values[2] ?? values[0])); return { rowCount: 1, rows: [] }; }
    if (sql.startsWith('UPDATE admin_sessions')) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL in auth test: ${sql}`);
  }
}

async function setup(role: AdminRole = 'NEWS_ADMIN', maxAttempts = 5, secureCookies = false) {
  const pool = new FakePool(role);
  const app = createApp(pool as unknown as pg.Pool, { maxAttempts, secureCookies });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { Origin: 'http://localhost:3001', ...(init.headers ?? {}) } });
  const login = async (body: unknown = { email: EMAIL, password: PASSWORD }) => {
    const response = await request('/api/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { response, cookie };
  };
  return { pool, request, login, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), maxAttempts };
}

describe('admin authentication and RBAC', () => {
  const closers: Array<() => Promise<void>> = [];
  before(() => { process.env.CORS_ORIGIN = 'http://localhost:3001'; });
  after(async () => { await Promise.all(closers.map(close => close())); });
  async function create(role?: AdminRole, attempts = 5) { const instance = await setup(role, attempts); closers.push(instance.close); return instance; }

  it('allows a valid seeded-style admin to sign in with an HTTP-only strict cookie', async () => {
    const api = await create();
    const { response, cookie } = await api.login();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Strict/);
    assert.ok(cookie);
    assert.equal((await response.json() as { data: { user: { role: string } } }).data.user.role, 'NEWS_ADMIN');
  });

  it('marks the session cookie Secure when configured for production', async () => {
    const instance = await setup('NEWS_ADMIN', 5, true); closers.push(instance.close);
    const { response } = await instance.login();
    assert.match(response.headers.get('set-cookie') ?? '', /; Secure/);
  });

  it('rejects an invalid password without revealing account existence', async () => {
    const api = await create();
    const { response } = await api.login({ email: EMAIL, password: 'wrong' });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_CREDENTIALS');
  });

  it('uses the same safe failure response for an unknown email', async () => {
    const api = await create();
    const { response } = await api.login({ email: 'missing@example.test', password: 'wrong' });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_CREDENTIALS');
  });

  it('accepts a valid persisted session on /me', async () => {
    const api = await create();
    const { cookie } = await api.login();
    const response = await api.request('/api/admin/auth/me', { headers: { cookie: cookie! } });
    assert.equal(response.status, 200);
  });

  it('rejects an expired session', async () => {
    const api = await create(); const { cookie } = await api.login();
    api.pool.sessionExpired = true;
    assert.equal((await api.request('/api/admin/auth/me', { headers: { cookie: cookie! } })).status, 401);
  });

  it('invalidates a session on logout', async () => {
    const api = await create();
    const { cookie } = await api.login();
    const logout = await api.request('/api/admin/auth/logout', { method: 'POST', headers: { cookie: cookie! } });
    assert.equal(logout.status, 200);
    assert.equal((await api.request('/api/admin/auth/me', { headers: { cookie: cookie! } })).status, 401);
  });

  it('rejects cross-origin unsafe requests authenticated only by a cookie', async () => {
    const api = await create();
    const { cookie } = await api.login();
    const response = await api.request('/api/admin/auth/logout', { method: 'POST', headers: { cookie: cookie!, Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'CSRF_REJECTED');
  });

  it('blocks unauthenticated users from admin management APIs', async () => {
    const api = await create();
    assert.equal((await api.request('/api/admin/news')).status, 401);
    assert.equal((await api.request('/api/admin/rentals/dance')).status, 401);
  });

  it('allows NEWS_ADMIN to access news management', async () => {
    const api = await create('NEWS_ADMIN'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/news', { headers: { cookie: cookie! } })).status, 200);
  });

  it('denies NEWS_ADMIN access to rental management', async () => {
    const api = await create('NEWS_ADMIN'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/rentals/dance', { headers: { cookie: cookie! } })).status, 403);
    assert.equal((await api.request('/api/admin/rentals/brt', { headers: { cookie: cookie! } })).status, 403);
  });

  it('allows MANAGER to access dance management', async () => {
    const api = await create('MANAGER'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/rentals/dance', { headers: { cookie: cookie! } })).status, 200);
  });

  it('denies MANAGER access to BRT management', async () => {
    const api = await create('MANAGER'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/rentals/brt', { headers: { cookie: cookie! } })).status, 403);
  });

  it('allows BRT_ADMIN to access BRT management', async () => {
    const api = await create('BRT_ADMIN'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/rentals/brt', { headers: { cookie: cookie! } })).status, 200);
  });

  it('denies BRT_ADMIN access to dance management', async () => {
    const api = await create('BRT_ADMIN'); const { cookie } = await api.login();
    assert.equal((await api.request('/api/admin/rentals/dance', { headers: { cookie: cookie! } })).status, 403);
  });

  it('does not accept a client-supplied role', async () => {
    const api = await create();
    const { response } = await api.login({ email: EMAIL, password: PASSWORD, role: 'BRT_ADMIN' });
    assert.equal(response.status, 400);
  });

  it('limits repeated failed logins by client address', async () => {
    const api = await create('NEWS_ADMIN', 2);
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 401);
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 401);
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 429);
  });

  it('keeps a process-local login limit until the persistent limiter migration is applied', async () => {
    const api = await create('NEWS_ADMIN', 2);
    api.pool.loginLimitsUnavailable = true;
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 401);
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 401);
    assert.equal((await api.login({ email: EMAIL, password: 'bad' })).response.status, 429);
  });

  it('never returns a password or password hash in auth responses', async () => {
    const api = await create(); const { response } = await api.login();
    const payload = await response.text();
    assert.equal(payload.includes(hash), false);
    assert.doesNotMatch(payload, /password_hash|passwordHash|"password"/i);
  });

  it('rejects malformed login input and audits failed sign-in attempts', async () => {
    const api = await create();
    assert.equal((await api.login({ email: 'not-an-email', password: '' })).response.status, 400);
    assert.equal((await api.login({ email: EMAIL, password: 'incorrect' })).response.status, 401);
    assert.ok(api.pool.audits.length > 0);
  });
});
