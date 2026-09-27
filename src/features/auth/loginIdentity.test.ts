import { describe, expect, it } from 'vitest'
import { resolveLoginEmail } from './loginIdentity'

describe('resolveLoginEmail', () => {
  it('resolves a trimmed alias case-insensitively when both settings are present', () => {
    expect(resolveLoginEmail('  rLmCloudRing  ', ' rlMCloudRing ', ' owner@example.com '))
      .toBe('owner@example.com')
  })

  it('keeps a regular email as the Supabase identity', () => {
    expect(resolveLoginEmail('  owner@example.com  ', 'rlmCloudRing', 'owner@example.com'))
      .toBe('owner@example.com')
  })

  it('does not resolve an alias when either setting is absent or blank', () => {
    expect(resolveLoginEmail(' rlmCloudRing ', undefined, 'owner@example.com')).toBe('rlmCloudRing')
    expect(resolveLoginEmail(' rlmCloudRing ', 'rlmCloudRing', '  ')).toBe('rlmCloudRing')
  })

  it('returns an empty string for whitespace-only input', () => {
    expect(resolveLoginEmail('   ', 'rlmCloudRing', 'owner@example.com')).toBe('')
  })
})
