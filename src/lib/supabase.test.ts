import { describe, expect, it } from 'vitest'
import { findPrivilegedBrowserEnvironment, isPrivilegedSupabaseKey, resolveSupabaseConfiguration } from './supabase-config'

const validUrl = 'https://example-project.supabase.co'
const publishable = 'sb_publishable_public-example-key'
const payload = (role: string) => btoa(JSON.stringify({ role })).replace(/=+$/, '')
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${payload(role)}.signature`

describe('Supabase browser configuration', () => {
  it('reports missing settings without creating a client', () => {
    expect(resolveSupabaseConfiguration()).toMatchObject({ status: 'missing' })
  })

  it('accepts a publishable key and the legacy anon key', () => {
    expect(resolveSupabaseConfiguration(validUrl, publishable).status).toBe('ready')
    expect(resolveSupabaseConfiguration(validUrl, undefined, jwt('anon')).status).toBe('ready')
  })

  it.each(['sb_secret_private-key', 'service_role', jwt('service_role')])('rejects privileged key %s', (key) => {
    expect(resolveSupabaseConfiguration(validUrl, key).status).toBe('invalid')
  })

  it('rejects partial settings and malformed URLs', () => {
    expect(resolveSupabaseConfiguration(validUrl).status).toBe('invalid')
    expect(resolveSupabaseConfiguration('not a URL', publishable).status).toBe('invalid')
  })

  it('rejects non-local HTTP endpoints and URLs containing credentials', () => {
    expect(resolveSupabaseConfiguration('http://remote.example.com', publishable).status).toBe('invalid')
    expect(resolveSupabaseConfiguration('https://user:password@example-project.supabase.co', publishable).status).toBe('invalid')
    expect(resolveSupabaseConfiguration('http://127.0.0.1:54321', publishable).status).toBe('ready')
  })

  it('recognizes privileged keys before Vite creates a browser build', () => {
    expect(isPrivilegedSupabaseKey('sb_secret_private-key')).toBe(true)
    expect(isPrivilegedSupabaseKey(jwt('service_role'))).toBe(true)
    expect(isPrivilegedSupabaseKey(jwt('anon'))).toBe(false)
  })

  it('blocks privileged browser environment names and values', () => {
    expect(findPrivilegedBrowserEnvironment({ VITE_SUPABASE_URL: validUrl, VITE_SUPABASE_SERVICE_ROLE_KEY: 'placeholder' })).toBe('VITE_SUPABASE_SERVICE_ROLE_KEY')
    expect(findPrivilegedBrowserEnvironment({ VITE_OTHER_VALUE: jwt('service_role') })).toBe('VITE_OTHER_VALUE')
    expect(findPrivilegedBrowserEnvironment({ VITE_SUPABASE_URL: validUrl, VITE_SUPABASE_PUBLISHABLE_KEY: publishable })).toBeUndefined()
    expect(isPrivilegedSupabaseKey('SB_SECRET_test')).toBe(true)
  })
})
