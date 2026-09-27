export type TotpFactorRecord = {
  id: string
  factor_type: string
  status: string
  friendly_name?: string
  created_at?: string
}

export type EnrollmentDraft = {
  ownerId: string
  factorId: string
  qr?: string
  secret?: string
}

export type TotpResolution =
  | { kind: 'verified'; factor: TotpFactorRecord }
  | { kind: 'resume'; factor: TotpFactorRecord; draft?: EnrollmentDraft }
  | { kind: 'choose'; factors: TotpFactorRecord[] }
  | { kind: 'enroll' }

export function resolveTotpFactors(
  factors: readonly TotpFactorRecord[],
  ownerId: string,
  draft?: EnrollmentDraft,
): TotpResolution {
  const totp = factors.filter((factor) => factor.factor_type === 'totp')
  const verified = totp.find((factor) => factor.status === 'verified')
  if (verified) return { kind: 'verified', factor: verified }

  const pending = totp.filter((factor) => factor.status === 'unverified')
  if (!pending.length) return { kind: 'enroll' }

  const resumableDraft = draft && draft.ownerId === ownerId
    ? pending.find((factor) => factor.id === draft.factorId)
    : undefined
  if (resumableDraft && draft) return { kind: 'resume', factor: resumableDraft, draft }
  if (pending.length === 1) return { kind: 'resume', factor: pending[0] }
  return { kind: 'choose', factors: pending }
}

export function isDuplicateTotpNameError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  return value.code === 'mfa_factor_name_conflict' ||
    (typeof value.message === 'string' && /factor.*friendly name.*already exists|factor name.*(already|exists)|already.*factor name/i.test(value.message))
}
