# Production deployment checklist

The repository contains three separately started applications: the public website, the admin website, and the API. A successful local build does not configure a hosting provider or transfer the local `.env` file to it.

## Runtime requirements

- Use Node.js 24 and npm 10.
- Build the repository with `npm run build`.
- Run the API service with `npm run start:api`.
- Run the public website with `npm run start:web`.
- Run the admin website with `npm run start:admin`.
- The API and both Next.js apps honor the hosting platform's `PORT` variable.
- Configure a health check to call the API's `/health` endpoint.

Each app needs a deployment target that can run a long-lived Node.js process. Configure the public and admin apps to reach the API through `API_BASE_URL`. Set that variable at build and runtime for both Next.js apps because the API rewrite is configured in `next.config.ts`.

## API environment

Set these as server-side environment variables in the API service:

- `NODE_ENV=production`
- `DATABASE_URL`: production PostgreSQL/Supabase connection string, with TLS enabled. Supabase pooler URLs must include `sslmode=require`.
- `SUPABASE_URL`: the root URL of the same Supabase project as the database.
- `SUPABASE_SERVICE_ROLE_KEY`: project secret available only to the API. Never use a `NEXT_PUBLIC_*` variable or expose it to either frontend.
- `API_BASE_URL`: HTTPS origin of the deployed API.
- `CORS_ORIGIN`: comma-separated exact HTTPS origins for the public and admin websites. Do not include `*`, paths, or localhost.
- `BOOKING_ALLOW_PAST_DATES`, `BOOKING_MAX_RENTAL_DAYS`, `BOOKING_EXPIRY_INTERVAL_MS`, and `BOOKING_EXPIRY_BATCH_SIZE` as required by the booking policy.

Set `API_BASE_URL` in both frontend services to the API HTTPS origin. Do not copy the local `.env` as a production configuration; its URLs and origins are development-only.

Before deploying, run `npm run check:production-env` in an environment that has the production variables configured. The check reports invalid or missing settings without printing secret values. It can compare Supabase project references when they can be inferred from the connection URL.

## Database and Storage

1. Back up the production database before schema changes.
2. Run `npm run db:migrate` once against the production `DATABASE_URL` before deploying code that requires new schema changes.
3. Do not run `npm run db:seed` in production; it is development-only.
4. Confirm the buckets `news`, `services`, `items`, and `organization` exist in the same Supabase project. The application API uploads with the server-only service role key; public image URLs require the buckets to be public.
5. Confirm Supabase Storage allows the application's accepted image types (JPEG, PNG, WebP) and the API's 8 MB upload limit.

## Before opening the site

- Confirm the production environment check passes on the actual hosting services.
- Confirm the deployed API `/health` reports a connected database.
- Verify admin login and role restrictions, image upload and display, public catalog reads, news reads, and a booking on the production site with safe test data.
- Verify the production migration ledger is current. Do not use the production database as `TEST_DATABASE_URL`; integration tests require a disposable database.
- Keep a rollback deployment and database backup available for the first release.
