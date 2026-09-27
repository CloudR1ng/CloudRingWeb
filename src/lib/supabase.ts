import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabaseConfiguration } from './supabase-config'

export { resolveSupabaseConfiguration } from './supabase-config'

export const supabaseConfiguration = resolveSupabaseConfiguration(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export const supabase: SupabaseClient | null = supabaseConfiguration.status === 'ready'
  ? createClient(supabaseConfiguration.url, supabaseConfiguration.key, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null
