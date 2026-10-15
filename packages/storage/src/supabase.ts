import { createClient } from '@supabase/supabase-js';

/** Server-only client: never import this module from a browser-facing Next component. */
export function getSupabaseProjectUrl() {
  return process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export function createStorageAdmin() {
  const url = getSupabaseProjectUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (typeof window !== 'undefined') throw new Error('Supabase service role client cannot run in a browser');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
