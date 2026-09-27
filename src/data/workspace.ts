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
  const owner = async () => {
    const { data, error } = await client.auth.getUser()
    if (error) throw new StoreError('auth', '로그인 세션을 확인할 수 없습니다.', error)
    if (!data.user) throw new StoreError('auth', '로그인이 필요합니다.')
    return data.user.id
  }
  const run = async (action: (ownerId: string) => Promise<WorkspaceSnapshot>): Promise<WorkspaceSnapshot> => {
    try {
      const before = await owner()
      const result = await action(before)
      const after = await owner()
      if (before !== after) throw new StoreError('auth', '요청 중 로그인 계정이 변경되어 응답을 폐기했습니다.')
      for (const table of ['projects','tasks','events','goals','goal_links'] as const) {
        if (!Array.isArray(result[table]) || result[table].some((row) => row.owner_id !== before)) {
          throw new StoreError('permission', '다른 계정 자료가 포함된 응답을 폐기했습니다.')
        }
      }
      return result
    } catch (error) { throw classify(error) }
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
