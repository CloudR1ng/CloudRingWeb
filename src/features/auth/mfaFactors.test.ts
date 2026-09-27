import { describe, expect, it } from 'vitest'
import { isDuplicateTotpNameError, resolveTotpFactors, type TotpFactorRecord } from './mfaFactors'

const pending = (id: string, name = 'Authenticator'): TotpFactorRecord => ({ id, factor_type: 'totp', status: 'unverified', friendly_name: name })
const verified = (id: string): TotpFactorRecord => ({ id, factor_type: 'totp', status: 'verified' })

describe('resolveTotpFactors', () => {
  it('resumes a single pending factor instead of creating a replacement', () => {
    expect(resolveTotpFactors([pending('pending-1')], 'owner-1')).toMatchObject({ kind: 'resume', factor: { id: 'pending-1' } })
  })

  it('prefers a verified factor when verified and pending factors coexist', () => {
    expect(resolveTotpFactors([pending('pending-1'), verified('verified-1')], 'owner-1'))
      .toMatchObject({ kind: 'verified', factor: { id: 'verified-1' } })
  })

  it('offers a choice when there are multiple pending factors', () => {
    expect(resolveTotpFactors([pending('pending-1'), pending('pending-2')], 'owner-1'))
      .toMatchObject({ kind: 'choose', factors: [{ id: 'pending-1' }, { id: 'pending-2' }] })
  })

  it('preserves a pending QR and secret only for the same owner and factor', () => {
    const draft = { ownerId: 'owner-1', factorId: 'pending-1', qr: 'local-qr', secret: 'local-secret' }
    expect(resolveTotpFactors([pending('pending-1')], 'owner-1', draft)).toMatchObject({ kind: 'resume', draft })
    const otherOwner = resolveTotpFactors([pending('pending-1')], 'owner-2', draft)
    expect(otherOwner.kind).toBe('resume')
    if (otherOwner.kind === 'resume') expect(otherOwner).not.toHaveProperty('draft')
  })

  it('requests a new enrollment only when there is no verified or pending TOTP', () => {
    expect(resolveTotpFactors([], 'owner-1')).toEqual({ kind: 'enroll' })
    expect(resolveTotpFactors([{ id: 'phone-1', factor_type: 'phone', status: 'unverified' }], 'owner-1'))
      .toEqual({ kind: 'enroll' })
  })
})

describe('MFA recovery guards', () => {
  it('detects a duplicate factor name so callers can reload and resume an existing factor', () => {
    expect(isDuplicateTotpNameError({ code: 'mfa_factor_name_conflict' })).toBe(true)
    expect(isDuplicateTotpNameError({ message: 'factor name already exists' })).toBe(true)
    expect(isDuplicateTotpNameError({ message: 'A factor with the friendly name "CloudRing 인증 앱" for this user already exists' })).toBe(true)
    expect(isDuplicateTotpNameError({ code: 'invalid_totp_code' })).toBe(false)
  })
})
