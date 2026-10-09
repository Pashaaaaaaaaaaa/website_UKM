# UKM organization platform foundation

Foundation for a modular monolith supporting public news, organization information, dance performance bookings, and BRT inventory rentals. The first phase intentionally keeps both Next.js apps to small integration shells.

## Architecture

- `apps/web`: public Next.js application (port 3000).
- `apps/admin`: separate admin Next.js application (port 3001).
- `packages/api`: REST API in Express (port 4000); API payloads are validated before reaching the database.
- `packages/domain`: framework-independent Zod schemas and rental business rules.
- `packages/database`: PostgreSQL pool, transactional migration runner, and development seed.
- `packages/storage`: server-only Supabase Storage admin client.
- `packages/database/migrations`: versioned PostgreSQL schema migrations.
- `supabase`: local Supabase configuration and logical Storage bucket provisioning.
- `tests`: domain unit tests and PostgreSQL integration tests.

All business behavior belongs in domain/API modules, not React components, so the frontends can be redesigned independently. This is one deployable codebase, not a microservice system. The admin portal has server-backed sessions and role checks; customers have no accounts or login.

## Requirements

- Node.js 24 (for the built-in TypeScript test runner)
- npm 10
- Docker (for local Supabase), or a reachable PostgreSQL 15+ database

## Local setup

```sh
cp .env.example .env
npm install
npx supabase start
npx supabase db reset
npm run db:setup
npm run dev
```

The migration runner applies files in lexical order and records applied files in `schema_migrations`. Supabase local startup provisions PostgreSQL and Storage; the local `db reset` runs `supabase/seed.sql` to create the four logical public content buckets. For a non-Supabase local PostgreSQL database, run `npm run db:migrate` and `npm run db:seed`; Storage provisioning requires Supabase.

### Development seed accounts

The development seed creates exactly these three roles and users:

| Role | Email | Development password |
| --- | --- | --- |
| NEWS_ADMIN | `news-admin@development.invalid` | `ChangeMe-Dev-Only-123!` |
| MANAGER | `manager@development.invalid` | `ChangeMe-Dev-Only-123!` |
| BRT_ADMIN | `brt-admin@development.invalid` | `ChangeMe-Dev-Only-123!` |

These credentials and all seeded news, organization members, dance services, and inventory are explicitly development-only. The seed refuses to run with `NODE_ENV=production`. Replace or remove the credentials before any shared environment is exposed.

### Commands

```sh
npm run dev             # API, public site, admin portal
npm run dev:api
npm run dev:web
npm run dev:admin
npm run db:migrate
npm run db:seed
npm run db:setup
npm test                # domain tests and configured DB integration tests
npm run test:watch
npm run lint
npm run typecheck
npm run build           # API plus both Next.js production builds
```

PostgreSQL integration tests run when `DATABASE_URL` is set. Apply migrations and seed first (`npm run db:setup`) so tests can verify the migration ledger and exercise real database constraints. Test mutations are wrapped in rolled-back transactions.

## Database domains

The schema includes admin users and exactly three allowed roles; articles, categories, tags, divisions and their join tables; moderated public comments; organization profile and members; dance services; BRT inventory categories/items; bookings, booking items, status history and payment confirmations; media metadata; settings; and audit logs.

Bookings are date-only and inclusive (`end_date - start_date + 1`). Dance booking items have a service ID and snapshot a fixed per-performance/per-day price; BRT items have an inventory ID and snapshot a per-unit/per-day price. Subtotals and booking totals are captured at booking creation. Constraints and triggers reject mixed-domain items. Dance services are exclusive over overlapping dates; BRT availability is quantity-based. Pending bookings reserve inventory until their expiration. The API uses serializable transactions and locks the service/item rows while checking availability.

## REST API (initial)

- `GET /health`: API and PostgreSQL connectivity.
- `POST /api/bookings`: creates a date-based DANCE or BRT booking with server-calculated price snapshots and availability checks.

### Admin authentication and access

- `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, and `GET /api/admin/auth/me` use an opaque, database-backed session cookie.
- Session tokens are random, stored only as SHA-256 hashes, expire after eight hours, and are invalidated on logout. Cookies are HttpOnly, SameSite=Strict, scoped to `/api/admin`, and Secure in production.
- Passwords use bcrypt. Login input is Zod-validated, failures are generic and audited, and an in-process per-IP limiter allows five failures per 15 minutes.
- `GET /api/admin/news` requires `NEWS_ADMIN`; `/api/admin/rentals/dance` requires `MANAGER`; `/api/admin/rentals/brt` requires `BRT_ADMIN`. These endpoints demonstrate the protected role boundaries for the next feature phase.
- Audit records include actor and role for successful login/logout. Failed logins are recorded without an actor. Route handlers can use `recordAdminAudit` for CRUD, payment confirmation, and settings changes.
- Admin login is at `http://localhost:3001/login`. After sign-in, the server-provided role selects `/news`, `/manager`, or `/brt`; no role is accepted from the browser. The Next.js admin app proxies `/api/*` to `API_BASE_URL`.

Never put `SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_*` variable. Supabase Storage's `news`, `services`, `items`, and `organization` buckets are intended for public content images; storage metadata remains in PostgreSQL.

## Environment variables

Copy `.env.example` to `.env`. The service role key is consumed only by the server package. Do not commit `.env` or production secrets.
