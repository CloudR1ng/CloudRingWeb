import { describe, expect, it } from 'vitest'
import { createRepository, StoreError, type RowTransport } from '../src/data/repository'
import type { OwnerTable, RowByTable } from '../src/data/models'

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const base = { id: '11111111-1111-4111-8111-111111111111', owner_id: user, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1 }
const project = { ...base, title: 'p', overview: '', description: '', representative_image_path: null, milestones: [], collaborator_roles: [], device_paths: [], related_links: [], category: '학업', tools: [], devices: [], collaborators: [], status: 'active', progress_mode: 'task_weighted', manual_progress: null, starts_on: null, due_on: null } as unknown as RowByTable['projects']

function transport(overrides: Partial<RowTransport> = {}): RowTransport {
  return {
    currentOwner: async () => user,
    list: async () => [],
    insert: async (_table, ownerId, row) => ({ ...project, ...row, owner_id: ownerId }) as RowByTable[OwnerTable],
    update: async () => project,
    delete: async () => project,
    ...overrides,
  } as RowTransport
}

describe('owner repository', () => {
  it('fetches every page and enforces owner and version filters at the transport boundary', async () => {
    const calls: unknown[][] = []
    const repo = createRepository(transport({
      list: async (_table, ownerId, offset, limit) => { calls.push([ownerId, offset, limit]); return offset === 0 ? Array.from({ length: 2 }, (_, i) => ({ ...project, id: `${i}` })) : [] },
      update: async (_table, ownerId, id, version, patch) => { calls.push([ownerId, id, version, patch]); return project },
    }), { pageSize: 2 })
    expect(await repo.list('projects')).toHaveLength(2)
    expect(calls.slice(0, 2)).toEqual([[user, 0, 2], [user, 2, 2]])
    await repo.update('projects', base.id, 7, { title: 'changed' })
    expect(calls[2]).toEqual([user, base.id, 7, { title: 'changed' }])
  })

  it('rejects protected or unknown values on both insert and update', async () => {
    const repo = createRepository(transport())
    await expect(repo.create('projects', { title: 'x', owner_id: user } as never)).rejects.toMatchObject({ kind: 'validation' })
    await expect(repo.update('projects', base.id, 1, { version: 9 } as never)).rejects.toMatchObject({ kind: 'validation' })
    await expect(repo.update('projects', base.id, 1, { arbitrary: true } as never)).rejects.toMatchObject({ kind: 'validation' })
  })

  it('preserves network errors and turns empty conditional writes into conflicts', async () => {
    const net = createRepository(transport({ update: async () => { throw new TypeError('offline') } }))
    await expect(net.update('projects', base.id, 1, { title: 'x' })).rejects.toMatchObject({ kind: 'network' })
    const conflict = createRepository(transport({ delete: async () => null }))
    await expect(conflict.delete('projects', base.id, 1)).rejects.toMatchObject({ kind: 'conflict' })
    expect(new StoreError('conflict', 'x')).toBeInstanceOf(Error)
  })

  it('discards a response when the authenticated owner changes while a request is in flight', async () => {
    let current = user
    const repo = createRepository(transport({ currentOwner: async () => current, list: async () => { current = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; return [project] } }))
    await expect(repo.list('projects')).rejects.toMatchObject({ kind: 'auth' })
  })
})
