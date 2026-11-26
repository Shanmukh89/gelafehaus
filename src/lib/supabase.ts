import { createClient } from '@supabase/supabase-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  envUrl &&
    envAnonKey &&
    !envUrl.includes('localhost:54321') &&
    !envUrl.includes('127.0.0.1:54321') &&
    envAnonKey !== 'placeholder-anon-key' &&
    envAnonKey !== 'your-supabase-anon-key'
);

export const isProductionMissingConfig =
  import.meta.env.PROD && !isSupabaseConfigured;

const supabaseUrl = envUrl || 'http://localhost:54321';
const supabaseAnonKey = envAnonKey || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'gelafehaus-supabase-auth',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
