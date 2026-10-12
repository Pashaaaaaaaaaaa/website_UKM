import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type pg from 'pg';

export const AdminRoleSchema = z.enum(['NEWS_ADMIN', 'MANAGER', 'BRT_ADMIN']);
export type AdminRole = z.infer<typeof AdminRoleSchema>;
const LoginSchema = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) }).strict();
const COOKIE = 'ukm_admin_session';
const TAB_ID_HEADER = 'x-admin-tab-id';
const tabCookieName = (tabId: string | undefined) => tabId && /^[a-f0-9]{32}$/i.test(tabId) ? `${COOKIE}_${tabId}` : COOKIE;
const requestCookie = (req: Request, name: string) => req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const requestToken = (req: Request) => {
  const authorization = req.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  return requestCookie(req, tabCookieName(req.get(TAB_ID_HEADER)));
};
const SESSION_MS = 8 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const json = (res: Response, status: number, data: object) => res.status(status).json(data);

export interface AdminPrincipal { id: string; name: string; email: string; role: AdminRole }
export interface AuthStore {
  findUser(email: string): Promise<(AdminPrincipal & { passwordHash: string; active: boolean }) | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date, ip: string, userAgent: string): Promise<void>;
  findSession(tokenHash: string): Promise<(AdminPrincipal & { expiresAt: Date }) | null>;
  deleteSession(tokenHash: string): Promise<void>;
  audit(actor: AdminPrincipal | null, action: string, ip: string, entityId?: string): Promise<void>;
}
export interface AuthOptions { secureCookies?: boolean; now?: () => number; maxAttempts?: number; windowMs?: number }

export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(maxAttempts = 5, windowMs = 15 * 60_000, now = Date.now) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.now = now;
  }
  isLimited(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= this.now()) { this.attempts.delete(key); return false; }
    return entry.count >= this.maxAttempts;
  }
  fail(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= this.now()) this.attempts.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    else entry.count += 1;
  }
  clear(key: string): void { this.attempts.delete(key); }
}

// Express request augmentation is required for the server-side auth middleware.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { admin?: AdminPrincipal } } }

export function createAdminAuthMiddleware(pool: pg.Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = requestToken(req);
    if (!token) return json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    try {
      const found = await pool.query<{ id: string; name: string; email: string; role: string; expires_at: Date }>(
        `SELECT u.id,u.name,u.email,r.code AS role,s.expires_at FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_user_id JOIN roles r ON r.id=u.role_id
         WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true`, [hashToken(token)]);
      const row = found.rows[0];
      if (!row) return json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Session is invalid or expired.' } });
      req.admin = { id: row.id, name: row.name, email: row.email, role: AdminRoleSchema.parse(row.role) };
      void pool.query('UPDATE admin_sessions SET last_seen_at=now() WHERE token_hash=$1', [hashToken(token)]).catch(() => undefined);
      return next();
    } catch { return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unable to verify session.' } }); }
  };
}

export function createAdminAuthRouter(pool: pg.Pool, options: AuthOptions = {}): Router {
  const router = Router();
  const limiter = new LoginLimiter(options.maxAttempts, options.windowMs, options.now);
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const authenticate = createAdminAuthMiddleware(pool);
  const cookieOptions = `Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure ? '; Secure' : ''}`;

  router.post('/auth/login', async (req, res) => {
    const key = ip(req);
    if (limiter.isLimited(key)) return json(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } });
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      limiter.fail(key);
      try { await pool.query('INSERT INTO audit_logs(action,entity_type,ip_address) VALUES($1,$2,$3)', ['LOGIN_FAILED','admin_user', key]); }
      catch { return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unable to sign in.' } }); }
      return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid login input.' } });
    }
    try {
      const found = await pool.query<{ id: string; name: string; email: string; role: string; password_hash: string; is_active: boolean }>(
        'SELECT u.id,u.name,u.email,r.code AS role,u.password_hash,u.is_active FROM admin_users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1)', [parsed.data.email]);
      const user = found.rows[0];
      const validPassword = await bcrypt.compare(parsed.data.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!user || !user.is_active || !validPassword) {
        limiter.fail(key);
        await pool.query('INSERT INTO audit_logs(action,entity_type,ip_address) VALUES($1,$2,$3)', ['LOGIN_FAILED','admin_user', key]);
        return json(res, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
      }
      limiter.clear(key);
      const principal: AdminPrincipal = { id: user.id, name: user.name, email: user.email, role: AdminRoleSchema.parse(user.role) };
      const token = randomBytes(32).toString('base64url');
      const cookieName = tabCookieName(req.get(TAB_ID_HEADER));
      const expiresAt = new Date((options.now?.() ?? Date.now()) + SESSION_MS);
      await pool.query('INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5)',
        [principal.id, hashToken(token), expiresAt, key, req.get('user-agent') ?? '']);
      await pool.query('INSERT INTO audit_logs(actor_id,actor_role,action,entity_type,entity_id,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
        [principal.id, principal.role, 'LOGIN', 'admin_user', principal.id, key]);
      res.setHeader('Set-Cookie', `${cookieName}=${token}; ${cookieOptions}`);
      return res.json({ data: { user: principal, token, expiresAt: expiresAt.toISOString() } });
    } catch { return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unable to sign in.' } }); }
  });

  router.post('/auth/logout', authenticate, async (req, res) => {
    const cookieName = tabCookieName(req.get(TAB_ID_HEADER));
    const token = requestToken(req)!;
    const clearCookie = `${cookieName}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
    try {
      await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [hashToken(token)]);
      await pool.query('INSERT INTO audit_logs(actor_id,actor_role,action,entity_type,entity_id,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
        [req.admin!.id, req.admin!.role, 'LOGOUT', 'admin_user', req.admin!.id, ip(req)]);
      res.setHeader('Set-Cookie', clearCookie);
      return res.json({ data: { ok: true } });
    } catch { return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unable to sign out.' } }); }
  });
  router.get('/auth/me', authenticate, (req, res) => res.json({ data: { user: req.admin } }));
  router.get('/news', authenticate, requireRole('NEWS_ADMIN'), (_req, res) => res.json({ data: { area: 'news' } }));
  router.get('/rentals/dance', authenticate, requireRole('MANAGER'), (_req, res) => res.json({ data: { area: 'dance' } }));
  router.get('/rentals/brt', authenticate, requireRole('BRT_ADMIN'), (_req, res) => res.json({ data: { area: 'brt' } }));
  return router;
}

export function requireRole(...allowed: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) return json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    if (!allowed.includes(req.admin.role)) return json(res, 403, { error: { code: 'FORBIDDEN', message: 'You do not have permission for this resource.' } });
    return next();
  };
}

export async function recordAdminAudit(
  pool: pg.Pool,
  req: Request,
  event: { action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  if (!req.admin) throw new Error('An authenticated admin is required to write an audit event.');
  await pool.query(
    `INSERT INTO audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.admin.id, req.admin.role, event.action, event.entityType, event.entityId ?? null,
      event.before === undefined ? null : JSON.stringify(event.before), event.after === undefined ? null : JSON.stringify(event.after), req.ip],
  );
}
