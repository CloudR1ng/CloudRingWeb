import type { SupabaseClient } from '@supabase/supabase-js'
import type { OwnerTable, RowByTable } from './models'
import { supabase } from '../lib/supabase'
import { StoreError } from './repository'

export interface WorkspaceSnapshot {
  projects: RowByTable['projects'][]
  tasks: RowByTable['tasks'][]
  events: RowByTable['events'][]
  goals: RowByTable['goals'][]
  goal_links: RowByTable['goal_links'][]
}

export type WorkspaceChange =
  | { [K in OwnerTable]: { table: K; op: 'insert'; id: string; values: Omit<RowByTable[K], 'id'|'owner_id'|'created_at'|'updated_at'|'version'> } }[OwnerTable]
  | { [K in OwnerTable]: { table: K; op: 'update'; id: string; version: number; values: Partial<Omit<RowByTable[K], 'id'|'owner_id'|'created_at'|'updated_at'|'version'>> } }[OwnerTable]
  | { table: OwnerTable; op: 'delete'; id: string; version: number }

function classify(error: any): StoreError {
  if (error instanceof StoreError) return error
  if (error?.code === '40001') return new StoreError('conflict', '자료가 먼저 변경되었습니다. 최신 내용을 확인하세요.', error)
  if (error?.code === '42501' || error?.status === 401 || error?.status === 403) return new StoreError('permission', '저장 권한을 확인할 수 없습니다.', error)
  if (typeof error?.code === 'string' && (error.code.startsWith('23') || error.code.startsWith('22') || error.code === '22023')) return new StoreError('validation', '입력한 데이터가 저장 조건을 만족하지 않습니다.', error)
  if (error?.code) return new StoreError('server', '저장소 요청을 완료하지 못했습니다.', error)
  if (error?.status === undefined || error?.status === 0) return new StoreError('network', '네트워크 오류로 저장하지 못했습니다. 입력 내용은 화면에 남아 있습니다.', error)
  return new StoreError('server', '저장소 요청을 완료하지 못했습니다.', error)
}

export function createWorkspaceStore(client: SupabaseClient | null = supabase) {
  if (!client) throw new StoreError('configuration', 'Supabase 연결 설정이 없습니다.')
  const run = async (action: (ownerId: string) => Promise<WorkspaceSnapshot>): Promise<WorkspaceSnapshot> => {
    let unsubscribe: (() => void) | undefined
    try {
      let identityGeneration = 0
      let refreshGeneration = 0
      let baseline: { ownerId: string; accessToken: string } | null = null
      const signInsBeforeBaseline: Array<{ ownerId: string; accessToken: string }> = []
      const { data: authSubscription } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED') {
          refreshGeneration += 1
          if (baseline && session?.user.id === baseline.ownerId && session.access_token) baseline.accessToken = session.access_token
          else if (baseline && session?.user.id !== baseline.ownerId) identityGeneration += 1
        }
        else if (event === 'SIGNED_IN') {
          const received = session?.user.id && session.access_token
            ? { ownerId: session.user.id, accessToken: session.access_token }
            : null
          if (!received) identityGeneration += 1
          else if (baseline) {
            if (received.ownerId !== baseline.ownerId || received.accessToken !== baseline.accessToken) identityGeneration += 1
          } else signInsBeforeBaseline.push(received)
        } else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY' || event === 'MFA_CHALLENGE_VERIFIED') identityGeneration += 1
      })
      unsubscribe = () => authSubscription.subscription.unsubscribe()
      const startGeneration = identityGeneration
      const { data: remoteUser, error: userError } = await client.auth.getUser()
      if (userError) throw new StoreError('auth', '로그인 세션을 확인할 수 없습니다.', userError)
      if (!remoteUser.user) throw new StoreError('auth', '로그인이 필요합니다.')
      const before = remoteUser.user.id
      const { data: localSession, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw new StoreError('auth', '로컬 세션 상태를 확인할 수 없습니다.', sessionError)
      const initialAccessToken = localSession.session?.access_token
      if (initialAccessToken) {
        baseline = { ownerId: before, accessToken: initialAccessToken }
        if (signInsBeforeBaseline.some((received) => received.ownerId !== before || received.accessToken !== initialAccessToken)) identityGeneration += 1
      }
      if (identityGeneration !== startGeneration || localSession.session?.user.id !== before || !localSession.session.access_token) {
        throw new StoreError('auth', '요청 시작 중 로그인 상태가 변경되어 작업을 중단했습니다.')
      }
      const accessToken = localSession.session.access_token
      const startRefreshGeneration = refreshGeneration
      const result = await action(before)
      const { data: afterSession, error: afterError } = await client.auth.getSession()
      if (afterError) throw new StoreError('auth', '요청 후 로그인 상태를 확인할 수 없습니다.', afterError)
      if (identityGeneration !== startGeneration || afterSession.session?.user.id !== before) {
        throw new StoreError('auth', '요청 중 로그인 계정이 변경되어 응답을 폐기했습니다.')
      }
      if (afterSession.session.access_token !== accessToken && refreshGeneration === startRefreshGeneration) {
        throw new StoreError('auth', '인증 토큰이 갱신되었지만 인증 상태 변경을 확인하지 못해 응답을 폐기했습니다.')
      }
      for (const table of ['projects','tasks','events','goals','goal_links'] as const) {
        if (!Array.isArray(result[table]) || result[table].some((row) => row.owner_id !== before)) {
          throw new StoreError('permission', '다른 계정 자료가 포함된 응답을 폐기했습니다.')
        }
      }
      return result
    } catch (error) { throw classify(error) }
    finally { unsubscribe?.() }
  }
  return {
    loadWorkspace: () => run(async () => {
      const { data, error } = await client.rpc('workspace_snapshot')
      if (error) throw error
      return data as WorkspaceSnapshot
    }),
    commitWorkspace: (changes: WorkspaceChange[]) => run(async () => {
      const { data, error } = await client.rpc('workspace_commit', { p_changes: changes })
      if (error) throw error
      return data as WorkspaceSnapshot
    }),
  }
}

export const loadWorkspace = () => createWorkspaceStore().loadWorkspace()
export const commitWorkspace = (changes: WorkspaceChange[]) => createWorkspaceStore().commitWorkspace(changes)
