import { describe, expect, it } from 'vitest'
import { dedupeKey, deliveryOutcome, isAllowedPushEndpoint, isRetryablePushStatus, retryDelaySeconds, safeNotificationTarget, seoulParts, sourceIsCurrent, summarizeToday } from '../src/features/notifications/core'

describe('notification core', () => {
  it('uses Seoul day boundaries and de-duplicates items that match multiple reminders', () => {
    expect(seoulParts(new Date('2026-09-26T14:59:00Z'))).toMatchObject({ date:'2026-09-26',time:'23:59' })
    expect(seoulParts(new Date('2026-09-26T15:00:00Z'))).toMatchObject({ date:'2026-09-27',time:'00:00' })
    expect(summarizeToday([{id:'a'},{id:'a'},{id:'b'}]).count).toBe(2)
    expect(dedupeKey({owner:'o',kind:'daily',date:'2026-09-27'})).toBe('daily:2026-09-27')
    expect(dedupeKey({owner:'o',kind:'task',id:'x',version:3})).toBe('task:x:3')
  })
  it('discards stale, complete, cancelled, deleted, and expired source records', () => {
    const expected={id:'x',version:4},until=new Date('2026-09-27T01:00:00Z'),now=new Date('2026-09-27T00:00:00Z')
    expect(sourceIsCurrent(expected,{id:'x',version:4,status:'in_progress'},until,now)).toBe(true)
    expect(sourceIsCurrent(expected,{id:'x',version:5},until,now)).toBe(false)
    expect(sourceIsCurrent(expected,{id:'x',version:4,status:'completed'},until,now)).toBe(false)
    expect(sourceIsCurrent(expected,{id:'x',version:4,status:'cancelled'},until,now)).toBe(false)
    expect(sourceIsCurrent(expected,{id:'x',version:4,deleted:true},until,now)).toBe(false)
    expect(sourceIsCurrent(expected,{id:'x',version:4},now,now)).toBe(false)
  })
  it('limits retries and permits only known HTTPS push providers', () => {
    expect([1,2,5,9].map(retryDelaySeconds)).toEqual([60,120,960,960])
    expect(isRetryablePushStatus(null)).toBe(true);expect(isRetryablePushStatus(410)).toBe(false);expect(isRetryablePushStatus(503)).toBe(true)
    expect([201,202,404,410,429,503,400,null].map(deliveryOutcome)).toEqual(['accepted','accepted','expired','expired','retry','retry','failed','retry'])
    expect(isAllowedPushEndpoint('https://web.push.apple.com/token')).toBe(true)
    expect(isAllowedPushEndpoint('https://attacker.example/token')).toBe(false)
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/token')).toBe(false)
    expect(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/token')).toBe(false)
  })
  it('restricts notification clicks to same-origin paths inside app scope', () => {
    const scope='https://example.test/CloudRingWeb/'
    expect(safeNotificationTarget('#/app',scope)).toBe('https://example.test/CloudRingWeb/#/app')
    expect(safeNotificationTarget('https://attacker.example/',scope)).toBeNull()
    expect(safeNotificationTarget('/outside',scope)).toBeNull()
  })
})
