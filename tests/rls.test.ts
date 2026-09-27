import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const unregistered = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const projectA = '11111111-1111-4111-8111-111111111111'
const projectB = '22222222-2222-4222-8222-222222222222'

let db: PGlite

async function setIdentity(userId: string, aal = 'aal2', role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claims', '{"sub":"${userId}","role":"${role}","aal":"${aal}"}', false); set role ${role};`)
}

async function projectInsert(id: string, owner: string, title: string) {
  return db.query(`insert into public.projects (id, owner_id, title, category) values ($1, $2, $3, '학업') returning id`, [id, owner, title])
}

describe('owner and MFA row security policies', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid(), auth.jwt() to public;
      insert into auth.users (id) values ('${ownerA}'), ('${ownerB}'), ('${unregistered}');
    `)
    const migration = await readFile(resolve(process.cwd(), 'supabase/migrations/202609270001_owner_mfa_data.sql'), 'utf8')
    await db.exec(migration)
    await db.exec(`
      insert into public.owner_registry (owner_id) values ('${ownerA}'), ('${ownerB}');
      insert into public.projects (id, owner_id, title, category) values
        ('${projectA}', '${ownerA}', 'A project', '학업'),
        ('${projectB}', '${ownerB}', 'B project', '대회');
      insert into public.tasks (owner_id, project_id, title, category, planned_on, status, progress)
      values ('${ownerA}', '${projectA}', 'A task', '학업', '2026-09-27', 'in_progress', 25);
    `)
  })

  afterAll(async () => { await db.close() })

  it('denies anonymous reads and writes at the table privilege boundary', async () => {
    await setIdentity(ownerA, 'aal2', 'anon')
    await expect(db.query('select * from public.projects')).rejects.toMatchObject({ code: '42501' })
    await expect(projectInsert('33333333-3333-4333-8333-333333333333', ownerA, 'anon insert')).rejects.toMatchObject({ code: '42501' })
  })

  it('restricts reads and writes to an allowlisted user at AAL2', async () => {
    await setIdentity(ownerA)
    const read = await db.query<{ owner_id: string; title: string }>('select owner_id, title from public.projects order by title')
    expect(read.rows).toEqual([{ owner_id: ownerA, title: 'A project' }])
    await projectInsert('33333333-3333-4333-8333-333333333333', ownerA, 'A inserted')
    await db.query("update public.projects set overview = 'updated' where owner_id = $1 and id = $2", [ownerA, projectA])
    await db.query('delete from public.projects where owner_id = $1 and id = $2', [ownerA, '33333333-3333-4333-8333-333333333333'])
    const result = await db.query('select overview from public.projects where owner_id = $1 and id = $2', [ownerA, projectA])
    expect(result.rows[0]?.overview).toBe('updated')
  })

  it('hides another owner rows and blocks forged owner IDs', async () => {
    await setIdentity(ownerA)
    expect((await db.query('select * from public.projects where id = $1', [projectB])).rows).toHaveLength(0)
    await expect(projectInsert('33333333-3333-4333-8333-333333333333', ownerB, 'forged owner')).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('update public.projects set owner_id = $1 where owner_id = $2 and id = $3 returning id', [ownerB, ownerA, projectA])).rejects.toMatchObject({ code: '42501' })
  })

  it('blocks authenticated but unregistered accounts and AAL1 sessions', async () => {
    await setIdentity(unregistered)
    expect((await db.query('select * from public.projects')).rows).toHaveLength(0)
    await expect(projectInsert('33333333-3333-4333-8333-333333333333', unregistered, 'unregistered')).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role')
    await setIdentity(ownerA, 'aal1')
    expect((await db.query('select * from public.projects')).rows).toHaveLength(0)
    await expect(projectInsert('33333333-3333-4333-8333-333333333333', ownerA, 'aal1')).rejects.toMatchObject({ code: '42501' })
    expect((await db.query('update public.projects set overview=$1 where owner_id=$2 and id=$3 returning id', ['aal1', ownerA, projectA])).rows).toHaveLength(0)
    expect((await db.query('delete from public.projects where owner_id=$1 and id=$2 returning id', [ownerA, projectA])).rows).toHaveLength(0)
  })

  it('enforces same-owner project references even when both rows exist', async () => {
    await setIdentity(ownerA)
    await expect(db.query(`insert into public.tasks (owner_id, project_id, title, category) values ($1, $2, 'foreign project', '학업')`, [ownerA, projectB])).rejects.toMatchObject({ code: '23503' })
  })

  it('applies AAL2 CRUD policies to goals, tasks, and events and advances versions', async () => {
    await setIdentity(ownerA)
    const goalId = '44444444-4444-4444-8444-444444444444'
    const eventId = '55555555-5555-4555-8555-555555555555'
    await db.query(`insert into public.goals (id, owner_id, title, period_type, starts_on, ends_on) values ($1,$2,'A goal','year','2026-01-01','2026-12-31')`, [goalId, ownerA])
    await db.query(`insert into public.events (id, owner_id, title, all_day, event_on) values ($1,$2,'A event',true,'2026-10-01')`, [eventId, ownerA])
    await db.query('update public.goals set title=$1 where owner_id=$2 and id=$3', ['A goal updated', ownerA, goalId])
    await db.query('update public.events set title=$1 where owner_id=$2 and id=$3', ['A event updated', ownerA, eventId])
    await db.query(`insert into public.tasks (owner_id,title,category) values ($1,'temporary task','개인생활')`, [ownerA])
    await db.query(`delete from public.tasks where owner_id=$1 and title='temporary task'`, [ownerA])
    const updated = await db.query<{ version: number }>(`update public.tasks set progress=40 where owner_id=$1 and project_id=$2 returning version`, [ownerA, projectA])
    expect(updated.rows[0]?.version).toBe(2)
    const stale = await db.query(`update public.tasks set progress=60 where owner_id=$1 and project_id=$2 and version=1 returning id`, [ownerA, projectA])
    expect(stale.rows).toHaveLength(0)
    await db.query('delete from public.goals where owner_id=$1 and id=$2', [ownerA, goalId])
    await db.query('delete from public.events where owner_id=$1 and id=$2', [ownerA, eventId])
    expect((await db.query('select id from public.goals where id=$1', [goalId])).rows).toHaveLength(0)
    expect((await db.query('select id from public.events where id=$1', [eventId])).rows).toHaveLength(0)
  })

  it('rejects missing or negative target values and inconsistent task completion', async () => {
    await setIdentity(ownerA)
    await expect(db.query(`insert into public.goals (owner_id,title,period_type,starts_on,ends_on,progress_mode,current_value,target_value) values ($1,'bad goal','year','2026-01-01','2026-12-31','target_value',1,null)`, [ownerA])).rejects.toMatchObject({ code: '23514' })
    await expect(db.query(`insert into public.goals (owner_id,title,period_type,starts_on,ends_on,progress_mode,current_value,target_value) values ($1,'bad goal','year','2026-01-01','2026-12-31','target_value',-1,3)`, [ownerA])).rejects.toMatchObject({ code: '23514' })
    await expect(db.query(`insert into public.tasks (owner_id,title,category,status,progress) values ($1,'bad task','학업','completed',40)`, [ownerA])).rejects.toMatchObject({ code: '23514' })
    await expect(db.query(`insert into public.tasks (owner_id,title,category,status,progress) values ($1,'bad task','학업','todo',100)`, [ownerA])).rejects.toMatchObject({ code: '23514' })
  })

  it('allows the second registered owner to manage only their own rows', async () => {
    await setIdentity(ownerB)
    await projectInsert('33333333-3333-4333-8333-333333333333', ownerB, 'B inserted')
    expect((await db.query('select title from public.projects order by title')).rows).toEqual([{ title: 'B inserted' }, { title: 'B project' }])
  })
})
