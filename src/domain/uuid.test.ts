import { describe, expect, it } from 'vitest'
import { createUuid, isUuid } from './uuid'

describe('database UUID generation', () => {
  it('creates RFC 4122 version 4 identifiers accepted by the workspace RPC', () => {
    const goalId = createUuid()
    const linkId = createUuid()

    expect(isUuid(goalId)).toBe(true)
    expect(isUuid(linkId)).toBe(true)
    expect(linkId).not.toBe(goalId)
  })

  it('rejects demo labels and short random ids', () => {
    expect(isUuid('g-year')).toBe(false)
    expect(isUuid('abc123')).toBe(false)
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true)
  })
})
