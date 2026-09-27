import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWorkspaceStore, type WorkspaceSnapshot } from './workspace'
import { StoreError } from './repository'

type FakeSession = { access_token: string; user: { id: string } }
const emptySnapshot = (): WorkspaceSnapshot => ({ projects: [], tasks: [], events: [], goals: [], goal_links: [] })

function harness(initial: FakeSession | null = { access_token: 'token-a', user: { id: 'owner-a' } }) {
  let session = initial
  let listener: ((event: string, session: FakeSession | null) => void) | undefined
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: session?.user ?? null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn((callback: (event: string, session: FakeSession | null) => void) => {
        listener = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    },
    rpc: vi.fn(async () => ({ data: emptySnapshot(), error: null })),
  } as unknown as SupabaseClient
  return {
    client,
    setSession(value: FakeSession | null) { session = value },
    emit(event: string) { listener?.(event, session) },
    rpc: client.rpc as unknown as ReturnType<typeof vi.fn>,
    getUser: client.auth.getUser as unknown as ReturnType<typeof vi.fn>,
    getSession: client.auth.getSession as unknown as ReturnType<typeof vi.fn>,
  }
}

describe('workspace request identity fence', () => {
  it('keeps one remote user verification and uses local session snapshots around the RPC', async () => {
    const fake = harness()
    const result = await createWorkspaceStore(fake.client).loadWorkspace()
    expect(result).toEqual(emptySnapshot())
    expect(fake.getUser).toHaveBeenCalledTimes(1)
    expect(fake.getSession).toHaveBeenCalledTimes(2)
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })

  it('accepts a same-owner token refresh followed by duplicate SIGNED_IN while the RPC is pending', async () => {
    const fake = harness()
    let resolveRpc!: (value: { data: WorkspaceSnapshot; error: null }) => void
    fake.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveRpc = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    fake.setSession({ access_token: 'token-b', user: { id: 'owner-a' } })
    fake.emit('TOKEN_REFRESHED')
    fake.emit('SIGNED_IN')
    resolveRpc({ data: emptySnapshot(), error: null })
    await expect(pending).resolves.toEqual(emptySnapshot())
  })

  it('ignores a duplicate SIGNED_IN notification for the same owner and token', async () => {
    const fake = harness()
    let resolveRpc!: (value: { data: WorkspaceSnapshot; error: null }) => void
    fake.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveRpc = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    fake.emit('SIGNED_IN')
    resolveRpc({ data: emptySnapshot(), error: null })
    await expect(pending).resolves.toEqual(emptySnapshot())
  })

  it('rejects a new owner session while the RPC is pending', async () => {
    const fake = harness()
    let resolveRpc!: (value: { data: WorkspaceSnapshot; error: null }) => void
    fake.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveRpc = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    fake.setSession({ access_token: 'token-b', user: { id: 'owner-b' } })
    fake.emit('SIGNED_IN')
    resolveRpc({ data: emptySnapshot(), error: null })
    await expect(pending).rejects.toMatchObject({ kind: 'auth' })
  })

  it('does not call the workspace RPC if remote user verification fails', async () => {
    const fake = harness()
    fake.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } })
    await expect(createWorkspaceStore(fake.client).loadWorkspace()).rejects.toMatchObject({ kind: 'auth' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('rejects logout while remote user verification is pending', async () => {
    const fake = harness()
    let resolveUser!: (value: { data: { user: { id: string } }; error: null }) => void
    fake.getUser.mockImplementationOnce(() => new Promise((resolve) => { resolveUser = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.getUser).toHaveBeenCalledOnce())
    fake.setSession(null)
    fake.emit('SIGNED_OUT')
    resolveUser({ data: { user: { id: 'owner-a' } }, error: null })
    await expect(pending).rejects.toMatchObject({ kind: 'auth' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('rejects a late result across logout and same-owner re-login', async () => {
    const fake = harness()
    let resolveRpc!: (value: { data: WorkspaceSnapshot; error: null }) => void
    fake.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveRpc = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    fake.setSession(null)
    fake.emit('SIGNED_OUT')
    fake.setSession({ access_token: 'new-login-token', user: { id: 'owner-a' } })
    fake.emit('SIGNED_IN')
    resolveRpc({ data: emptySnapshot(), error: null })
    await expect(pending).rejects.toMatchObject({ kind: 'auth' })
  })

  it('rejects a late result after logout', async () => {
    const fake = harness()
    let resolveRpc!: (value: { data: WorkspaceSnapshot; error: null }) => void
    fake.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveRpc = resolve }))
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    fake.setSession(null)
    fake.emit('SIGNED_OUT')
    resolveRpc({ data: emptySnapshot(), error: null })
    await expect(pending).rejects.toMatchObject({ kind: 'auth' })
  })

  it('retains server permission and server errors', async () => {
    const permission = harness()
    permission.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(createWorkspaceStore(permission.client).loadWorkspace()).rejects.toMatchObject({ kind: 'permission' })

    const server = harness()
    server.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001' } })
    await expect(createWorkspaceStore(server.client).loadWorkspace()).rejects.toMatchObject({ kind: 'server' })

    const conflict = harness()
    conflict.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    await expect(createWorkspaceStore(conflict.client).loadWorkspace()).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('rejects a response containing another owner row', async () => {
    const fake = harness()
    fake.rpc.mockResolvedValueOnce({ data: { ...emptySnapshot(), tasks: [{ owner_id: 'owner-b' }] }, error: null })
    const pending = createWorkspaceStore(fake.client).loadWorkspace()
    await expect(pending).rejects.toBeInstanceOf(StoreError)
    await expect(pending).rejects.toMatchObject({ kind: 'permission' })
  })
})
