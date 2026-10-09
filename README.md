# UKM organization platform foundation

Foundation for a modular monolith supporting public news, organization information, dance performance bookings, and BRT inventory rentals. The first phase intentionally keeps both Next.js apps to small integration shells.

## Architecture

- `apps/web`: public Next.js application (port 3000).
- `apps/admin`: separate admin Next.js application (port 3001).
- `packages/api`: REST API in Express (port 4000); API payloads are validated before reaching the database.
- `packages/domain`: framework-independent Zod schemas and rental business rules.
- `packages/database`: PostgreSQL pool, transactional migration runner, and development seed. Migrations `003`–`005` add reservation guards, CMS fields, and ordered article media.
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
npm run bookings:expire
npm test                # domain tests and configured DB integration tests
npm run test:watch
npm run lint
npm run typecheck
npm run build           # API plus both Next.js production builds
```

PostgreSQL integration tests run when `DATABASE_URL` is set. Apply migrations and seed first (`npm run db:setup`) so tests can verify the migration ledger and exercise real database constraints, including concurrent booking attempts. Booking fixtures clean up their committed test rows after each suite.

## Database domains

The schema includes admin users and exactly three allowed roles; articles, categories, tags, divisions and their join tables; moderated public comments; organization profile and members; dance services; BRT inventory categories/items; bookings, booking items, status history and payment confirmations; media metadata; settings; and audit logs.

Bookings are date-only and inclusive (`end_date - start_date + 1`). Dance booking items have a service ID and snapshot a fixed per-performance/per-day price; BRT items have an inventory ID and snapshot a per-unit/per-day price. Subtotals and booking totals are captured at booking creation. Constraints and triggers reject mixed-domain items. Dance services are exclusive over overlapping dates; BRT availability is quantity-based. Pending bookings reserve resources immediately for 24 hours.

## REST API

- `GET /health`: API and PostgreSQL connectivity.
- `POST /api/public/bookings`: creates a guest booking with server-calculated totals, immutable price snapshots, and a 24-hour payment hold.
- `GET /api/public/availability/dance/:id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`: date-by-date dance availability.
- `GET /api/public/availability/items/:id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`: daily BRT total, reserved, and available quantities.
- `GET /api/admin/bookings` and `GET /api/admin/bookings/:code`: list/view bookings restricted to the signed-in rental role.
- `POST /api/admin/bookings/:code/confirm-payment`: MANAGER confirms DANCE; BRT_ADMIN confirms BRT.
- `GET /api/admin/availability/dance/:id` and `/api/admin/availability/items/:id`: role-restricted admin availability.
- `GET/POST /api/admin/news/articles`, `PUT/DELETE /api/admin/news/articles/:id`, and `PATCH /api/admin/news/articles/:id/status`: NEWS_ADMIN CMS with draft/publish/unpublish, search, category/tag/division filters, unique slugs, author, and publication metadata.
- `/api/admin/news/categories`, `/tags`, `/divisions`, `/comments`, `/organization`, and `/organization/members` provide protected taxonomy CRUD, comment moderation, and organization management.
- Public content is served by `GET /api/public/articles`, `GET /api/public/articles/:slug`, `POST /api/public/articles/:slug/comments`, taxonomy read endpoints, and `GET /api/public/organization`. Only approved comments are public; new comments are sanitized, pending moderation, and limited by IP.
- `GET/POST/PUT/DELETE /api/admin/rentals/dance/manage/services` is MANAGER-only. `/api/admin/rentals/brt/manage/categories` and `/items` are BRT_ADMIN-only. Current stock cannot be reduced below active daily reservations.
- `POST /api/admin/media` validates role-to-bucket access, image MIME signatures, and an 8 MB limit, then stores media through the server-only Supabase service client. Images are linked to articles, dance services, inventory items, organization details, or members through database media IDs.
- Rental dashboards use the existing role-scoped booking and availability APIs; `GET /api/admin/bookings/:code/payment-confirmations` exposes proof metadata only to the matching rental administrator. Payment confirmation continues through the booking service.

Booking states are `PENDING_PAYMENT → CONFIRMED` or `PENDING_PAYMENT → EXPIRED`. PostgreSQL enforces valid transitions and payment-state pairing. The API runs a scheduled expiry worker; `npm run bookings:expire` runs one batch on demand. The same idempotent `FOR UPDATE SKIP LOCKED` function powers both, while booking creation and availability reads lazily expire due holds.

Booking creation uses a PostgreSQL transaction and locks selected resources in sorted ID order before checking them. Dance availability rejects any overlapping active hold. BRT availability sums reservations separately for each requested date. A lock is followed by a separate availability query so competing requests see committed reservations; database triggers repeat domain, price, state, and inventory checks. Per-day counters create unique `BK-YYYYMMDD-NNNN` booking codes without exposing booking database IDs.

Set `BOOKING_ALLOW_PAST_DATES=true` only when a deployment explicitly allows past bookings; the default rejects them. `BOOKING_MAX_RENTAL_DAYS` defaults to 366. `BOOKING_EXPIRY_INTERVAL_MS` and `BOOKING_EXPIRY_BATCH_SIZE` control the scheduled and one-shot expiration worker.

### Admin authentication and access

- `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, and `GET /api/admin/auth/me` use an opaque, database-backed session cookie.
- Session tokens are random, stored only as SHA-256 hashes, expire after eight hours, and are invalidated on logout. Cookies are HttpOnly, SameSite=Strict, scoped to `/api/admin`, and Secure in production.
- Passwords use bcrypt. Login input is Zod-validated, failures are generic and audited, and an in-process per-IP limiter allows five failures per 15 minutes.
- The CMS and rental management endpoints enforce role checks on the server. NEWS_ADMIN has no rental CRUD access, MANAGER cannot administer BRT, and BRT_ADMIN cannot administer Dance.
- Login, logout, failed login, content CRUD, moderation, media uploads, organization changes, rental catalog changes, and payment confirmation create audit records with actor and role where applicable.
- Admin login is at `http://localhost:3001/login`. After sign-in, the server-provided role selects `/news`, `/manager`, or `/brt`; no role is accepted from the browser. The Next.js admin app proxies `/api/*` to `API_BASE_URL`.

Never put `SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_*` variable. Supabase Storage's `news`, `services`, `items`, and `organization` buckets are provisioned by `supabase/seed.sql`; uploads require `SUPABASE_URL` and the server-only service role key. File metadata and article image ordering are stored in PostgreSQL.

## Environment variables

Copy `.env.example` to `.env`. The service role key is consumed only by the server package. Do not commit `.env` or production secrets.
