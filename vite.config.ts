import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { findPrivilegedBrowserEnvironment, resolveSupabaseConfiguration } from './src/lib/supabase-config.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const setting = resolveSupabaseConfiguration(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_ANON_KEY)
  const unsafeVariable = findPrivilegedBrowserEnvironment(env)
  if (unsafeVariable) throw new Error(`Refusing to include a privileged Supabase value in the browser build (${unsafeVariable}).`)
  if (setting.status === 'invalid') throw new Error(`Invalid browser Supabase configuration: ${setting.message}`)
  return {
    base: env.VITE_BASE_PATH || '/CloudRingWeb/',
    plugins: [react()],
  }
})
