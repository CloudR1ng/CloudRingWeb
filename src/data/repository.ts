import type { NewRow, OwnerTable, RowByTable, RowPatch } from './models'

export type StoreErrorKind = 'configuration' | 'auth' | 'permission' | 'validation' | 'conflict' | 'network' | 'server'

export class StoreError extends Error {
  constructor(readonly kind: StoreErrorKind, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'StoreError'
  }
}

export interface RowTransport {
  currentOwner(): Promise<string>
  list<K extends OwnerTable>(table: K, ownerId: string, offset: number, limit: number): Promise<RowByTable[K][]>
  insert<K extends OwnerTable>(table: K, ownerId: string, row: NewRow<K>): Promise<RowByTable[K]>
  update<K extends OwnerTable>(table: K, ownerId: string, id: string, version: number, patch: RowPatch<K>): Promise<RowByTable[K] | null>
  delete<K extends OwnerTable>(table: K, ownerId: string, id: string, version: number): Promise<RowByTable[K] | null>
}

const editableFields: Record<OwnerTable, Set<string>> = {
  projects: new Set(['title','overview','description','representative_image_path','milestones','collaborator_roles','device_paths','related_links','category','tools','devices','collaborators','status','progress_mode','manual_progress','current_value','target_value','starts_on','due_on']),
  tasks: new Set(['project_id','title','category','planned_on','planned_at','due_on','due_at','status','progress','weight']),
  events: new Set(['project_id','title','category','all_day','event_on','starts_at','ends_at','timezone','location','notes']),
  goals: new Set(['parent_goal_id','title','period_type','starts_on','ends_on','progress_mode','manual_progress','current_value','target_value']),
  goal_links: new Set(['goal_id','target_goal_id','target_project_id','target_task_id','weight']),
}

function classify(error: unknown): StoreError {
  if (error instanceof StoreError) return error
  const value = error as { code?: string; status?: number; message?: string } | null
  const code = value?.code ?? ''
  const status = value?.status
  const message = value?.message ?? '저장소 요청을 완료하지 못했습니다.'
  if (code === '40001') return new StoreError('conflict', '자료가 먼저 변경되었습니다. 최신 내용을 확인하세요.', error)
  if (code === '42501' || status === 401 || status === 403) return new StoreError('permission', '저장 권한을 확인할 수 없습니다.', error)
  if (code.startsWith('23') || code.startsWith('22') || status === 400 || status === 422) return new StoreError('validation', '입력한 데이터가 저장 조건을 만족하지 않습니다.', error)
  if (code) return new StoreError('server', '저장소 요청을 완료하지 못했습니다.', error)
  if (status === undefined || status === 0) return new StoreError('network', '네트워크 오류로 저장하지 못했습니다. 입력 내용은 화면에 남아 있습니다.', error)
  return new StoreError('server', message, error)
}

export function createRepository(transport: RowTransport, options: { pageSize?: number } = {}) {
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 500))
  const withOwner = async <T>(operation: (ownerId: string) => Promise<T>): Promise<T> => {
    try {
      const ownerId = await transport.currentOwner()
      if (!ownerId) throw new StoreError('auth', '로그인이 필요합니다.')
      const result = await operation(ownerId)
      const verify = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(verify); return }
        if (value && typeof value === 'object' && 'owner_id' in value) {
          const row = value as { owner_id: unknown; version?: unknown }
          if (row.owner_id !== ownerId || typeof row.version !== 'number' || row.version < 1) throw new StoreError('permission', '다른 계정 또는 유효하지 않은 버전의 자료를 폐기했습니다.')
        }
      }
      verify(result)
      const currentOwner = await transport.currentOwner()
      if (currentOwner !== ownerId) throw new StoreError('auth', '요청 중 로그인 계정이 변경되어 응답을 폐기했습니다.')
      return result
    } catch (error) {
      throw classify(error)
    }
  }
  const assertFields = (table: OwnerTable, values: object) => {
    const invalid = Object.keys(values).find((key) => !editableFields[table].has(key))
    if (invalid) throw new StoreError('validation', `수정할 수 없는 필드입니다: ${invalid}`)
  }

  return {
    async list<K extends OwnerTable>(table: K): Promise<RowByTable[K][]> {
      return withOwner(async (ownerId) => {
        const rows: RowByTable[K][] = []
        for (let offset = 0; ; offset += pageSize) {
          const page = await transport.list(table, ownerId, offset, pageSize)
          rows.push(...page)
          if (page.length < pageSize) return rows
        }
      })
    },
    async create<K extends OwnerTable>(table: K, row: NewRow<K>): Promise<RowByTable[K]> {
      try { assertFields(table, row) } catch (error) { throw classify(error) }
      return withOwner((ownerId) => transport.insert(table, ownerId, row))
    },
    update<K extends OwnerTable>(table: K, id: string, version: number, patch: RowPatch<K>): Promise<RowByTable[K]> {
      try { assertFields(table, patch) } catch (error) { return Promise.reject(classify(error)) }
      return withOwner(async (ownerId) => {
        const updated = await transport.update(table, ownerId, id, version, patch)
        if (!updated) throw new StoreError('conflict', '항목이 바뀌었거나 삭제되었거나 접근할 수 없습니다. 새로고침 후 다시 확인하세요.')
        return updated
      })
    },
    delete<K extends OwnerTable>(table: K, id: string, version: number): Promise<RowByTable[K]> {
      return withOwner(async (ownerId) => {
        const deleted = await transport.delete(table, ownerId, id, version)
        if (!deleted) throw new StoreError('conflict', '항목이 바뀌었거나 삭제되었거나 접근할 수 없습니다. 새로고침 후 다시 확인하세요.')
        return deleted
      })
    },
  }
}

export type CloudRingRepository = ReturnType<typeof createRepository>
