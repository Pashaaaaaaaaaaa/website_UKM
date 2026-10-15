import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const errors = [];
const value = (name) => process.env[name]?.trim() ?? '';
const reject = (message) => errors.push(message);
const isLocalHost = (host) => ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());

if (value('NODE_ENV') !== 'production') reject('NODE_ENV must be production.');

let databaseUrl;
try {
  databaseUrl = new URL(value('DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) reject('DATABASE_URL must use PostgreSQL.');
  if (isLocalHost(databaseUrl.hostname)) reject('DATABASE_URL must point to the production database, not localhost.');
  if (databaseUrl.hostname.endsWith('.pooler.supabase.com') && databaseUrl.searchParams.get('sslmode') !== 'require') {
    reject('Supabase pooler DATABASE_URL must include sslmode=require.');
  }
} catch {
  reject('DATABASE_URL must be a valid PostgreSQL connection URL.');
}

let supabaseUrl;
try {
  supabaseUrl = new URL(value('SUPABASE_URL'));
  if (supabaseUrl.protocol !== 'https:') reject('SUPABASE_URL must use HTTPS.');
  if (supabaseUrl.hostname === 'your-project.supabase.co') reject('SUPABASE_URL still contains the example project URL.');
} catch {
  reject('SUPABASE_URL must be a valid HTTPS URL.');
}

const serviceKey = value('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey || /your-server-only|placeholder|example/i.test(serviceKey)) {
  reject('SUPABASE_SERVICE_ROLE_KEY must contain the server-only project secret.');
}
try {
  const apiUrl = new URL(value('API_BASE_URL'));
  if (apiUrl.protocol !== 'https:') reject('API_BASE_URL must use HTTPS.');
  if (isLocalHost(apiUrl.hostname)) reject('API_BASE_URL must point to the deployed API, not localhost.');
  if (apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) reject('API_BASE_URL must contain only the API origin, without a path or query.');
} catch {
  reject('API_BASE_URL must be a valid HTTPS API origin.');
}

const origins = value('CORS_ORIGIN').split(',').map((origin) => origin.trim()).filter(Boolean);
if (origins.length === 0) reject('CORS_ORIGIN must list the deployed website and admin origins.');
for (const origin of origins) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || isLocalHost(parsed.hostname)) {
      reject(`CORS_ORIGIN entry must be an exact deployed HTTPS origin: ${origin}`);
    }
  } catch {
    reject(`CORS_ORIGIN contains an invalid origin: ${origin}`);
  }
}

if (databaseUrl && supabaseUrl) {
  const storageProject = supabaseUrl.hostname.match(/^([^.]+)\.supabase\.co$/)?.[1];
  const databaseUsername = decodeURIComponent(databaseUrl.username).split(':', 1)[0];
  const databaseProject = databaseUrl.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1]
    ?? databaseUsername.match(/^postgres\.([^.]+)$/)?.[1];
  if (storageProject && databaseProject && storageProject !== databaseProject) {
    reject('DATABASE_URL and SUPABASE_URL point to different Supabase projects.');
  }
}

if (errors.length) {
  console.error('Production environment check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Production environment check passed. Secret values were not printed.');
}
