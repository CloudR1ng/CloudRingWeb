import type { SupabaseClient } from '@supabase/supabase-js'
import type { NewRow, OwnerTable, RowByTable, RowPatch } from './models'
import { createRepository, StoreError, type RowTransport } from './repository'
import { supabase } from '../lib/supabase'

function createSupabaseTransport(client: SupabaseClient | null): RowTransport {
  if (!client) throw new StoreError('configuration', 'Supabase 연결 설정이 없습니다.')
  const db = client as any
  return {
    async currentOwner() {
      const { data, error } = await client.auth.getUser()
      if (error) throw new StoreError('auth', '로그인 세션을 확인할 수 없습니다.', error)
      if (!data.user) throw new StoreError('auth', '로그인이 필요합니다.')
      return data.user.id
    },
    async list<K extends OwnerTable>(table: K, ownerId: string, offset: number, limit: number) {
      const { data, error } = await db.from(table).select('*').eq('owner_id', ownerId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1)
      if (error) throw error
      return (data ?? []) as RowByTable[K][]
    },
    async insert<K extends OwnerTable>(table: K, ownerId: string, row: NewRow<K>) {
      const { data, error } = await db.from(table).insert({ ...row, owner_id: ownerId }).select('*').single()
      if (error) throw error
      return data as RowByTable[K]
    },
    async update<K extends OwnerTable>(table: K, ownerId: string, id: string, version: number, patch: RowPatch<K>) {
      const { data, error } = await db.from(table).update(patch).eq('owner_id', ownerId).eq('id', id).eq('version', version).select('*').maybeSingle()
      if (error) throw error
      return (data ?? null) as RowByTable[K] | null
    },
    async delete<K extends OwnerTable>(table: K, ownerId: string, id: string, version: number) {
      const { data, error } = await db.from(table).delete().eq('owner_id', ownerId).eq('id', id).eq('version', version).select('*').maybeSingle()
      if (error) throw error
      return (data ?? null) as RowByTable[K] | null
    },
  }
}

export function createSupabaseRepository(client: SupabaseClient | null = supabase) {
  return createRepository(createSupabaseTransport(client))
}

