import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const absent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const projectA = '11111111-1111-4111-8111-111111111111'
const projectB = '22222222-2222-4222-8222-222222222222'
const projectC = '23232323-2323-4323-8323-232323232323'
const parentGoal = '33333333-3333-4333-8333-333333333333'
const childGoal = '44444444-4444-4444-8444-444444444444'
const taskA = '55555555-5555-4555-8555-555555555555'
const linkId = '66666666-6666-4666-8666-666666666666'
let db: PGlite

async function setIdentity(userId: string, aal = 'aal2', role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec('reset role')
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claims', '{"sub":"${userId}","role":"${role}","aal":"${aal}"}', false); set role ${role};`)
}

async function expectSqlError(operation: () => Promise<unknown>, code: string) {
  await db.exec('savepoint expected_error')
  let caught: unknown
  try { await operation() } catch (error) { caught = error }
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error')
  expect(caught).toMatchObject({ code })
}

async function goal(id: string, title: string, parent: string | null = null, start = '2026-01-01', end = '2026-12-31', mode = 'task_weighted') {
  return db.query(`insert into public.goals (id,owner_id,parent_goal_id,title,period_type,starts_on,ends_on,progress_mode) values ($1,$2,$3,$4,'year',$5,$6,$7) returning id`, [id, ownerA, parent, title, start, end, mode])
}

async function link(id: string, source: string, target: { goal?: string; project?: string; task?: string }) {
  return db.query(`insert into public.goal_links (id,owner_id,goal_id,target_goal_id,target_project_id,target_task_id) values ($1,$2,$3,$4,$5,$6) returning id`, [id, ownerA, source, target.goal ?? null, target.project ?? null, target.task ?? null])
}

describe('goal graph RLS, links, and cross-table invariants in PGlite', () => {
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
      insert into auth.users (id) values ('${ownerA}'), ('${ownerB}'), ('${absent}');
    `)
    const migration1 = await readFile(resolve(process.cwd(), 'supabase/migrations/202609270001_owner_mfa_data.sql'), 'utf8')
    const migration2 = await readFile(resolve(process.cwd(), 'supabase/migrations/202609270002_goal_links.sql'), 'utf8')
    const migration3 = await readFile(resolve(process.cwd(), 'supabase/migrations/202609270003_workspace_rpc.sql'), 'utf8')
    await db.exec(migration1)
    await db.exec(migration2)
    await db.exec(migration3)
    await db.exec(`insert into public.owner_registry (owner_id) values ('${ownerA}'), ('${ownerB}');`)
    await setIdentity(ownerA)
    await db.exec(`
      insert into public.projects (id,owner_id,title,category) values ('${projectA}','${ownerA}','A project','학업');
      insert into public.tasks (id,owner_id,project_id,title,category,status,progress) values ('${taskA}','${ownerA}','${projectA}','A task','학업','in_progress',20);
      insert into public.goals (id,owner_id,title,period_type,starts_on,ends_on) values ('${parentGoal}','${ownerA}','Annual goal','year','2026-01-01','2026-12-31');
    `)
    await setIdentity(ownerB)
    await db.query(`insert into public.projects (id,owner_id,title,category) values ($1,$2,'B project','대회')`, [projectA, ownerB])
  })
  beforeEach(async () => { await db.exec('begin'); await setIdentity(ownerA) })
  afterEach(async () => { await db.exec('rollback; reset role') })
  afterAll(async () => { await db.close() })

  it('executes both migrations and adds planned time plus event category defaults', async () => {
    const result = await db.query<{ planned_at: string | null }>(`insert into public.tasks (owner_id,title,category) values ($1,'timed task','개인생활') returning planned_at`, [ownerA])
    expect(result.rows[0]?.planned_at).toBeNull()
    const event = await db.query<{ category: string }>(`insert into public.events (owner_id,title,all_day,event_on) values ($1,'event',true,'2026-10-02') returning category`, [ownerA])
    expect(event.rows[0]?.category).toBe('개인생활')
  })

  it('allows only allowlisted AAL2 CRUD and rejects anonymous, AAL1, unregistered, and cross-owner access', async () => {
    expect((await db.query('select owner_id from public.goal_links')).rows).toEqual([])
    await db.exec(`insert into public.goals (owner_id,title,period_type,starts_on,ends_on) values ('${ownerA}','visible','year','2026-01-01','2026-12-31')`)
    expect((await db.query(`select title from public.goals where owner_id=$1`, [ownerA])).rows.some((r) => r.title === 'visible')).toBe(true)
    expect((await db.query(`select title from public.projects where owner_id=$1`, [ownerB])).rows).toHaveLength(0)
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id) values ($1,$2,$3)`, [ownerA, parentGoal, projectB]), '23503')

    await setIdentity(absent)
    await expectSqlError(() => db.query('insert into public.goals(owner_id,title,period_type,starts_on,ends_on) values ($1,\'x\',\'year\',\'2026-01-01\',\'2026-12-31\')', [absent]), '42501')
    await setIdentity(ownerA, 'aal1')
    expect((await db.query('select * from public.goal_links')).rows).toHaveLength(0)
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id) values ($1,$2,$3)`, [ownerA, parentGoal, projectA]), '42501')
    await setIdentity(ownerA, 'aal2', 'anon')
    await expectSqlError(() => db.query('select * from public.goal_links'), '42501')
  })

  it('enforces one target, positive weight, per-target uniqueness, and same-owner composite keys', async () => {
    await setIdentity(ownerA)
    await goal(childGoal, 'Child goal', parentGoal, '2026-02-01', '2026-02-28')
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id,target_task_id) values ($1,$2,$3,$4)`, [ownerA, parentGoal, projectA, taskA]), '23514')
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id,weight) values ($1,$2,$3,0)`, [ownerA, parentGoal, projectA]), '23514')
    await link(linkId, parentGoal, { project: projectA })
    await expectSqlError(() => link('77777777-7777-4777-8777-777777777777', parentGoal, { project: projectA }), '23505')
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id) values ($1,$2,$3)`, [ownerA, parentGoal, projectA]), '23505')
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id) values ($1,$2,$3)`, [ownerA, parentGoal, '33333333-3333-4333-8333-333333333333']), '23503')
  })

  it('allows a year parent, month child, and explicit parent-to-child aggregation', async () => {
    await goal(childGoal, 'February goal', parentGoal, '2026-02-01', '2026-02-28')
    await link(linkId, parentGoal, { goal: childGoal })
    await link('77777777-7777-4777-8777-777777777777', childGoal, { task: taskA })
    expect((await db.query('select target_goal_id from public.goal_links where id=$1', [linkId])).rows).toEqual([{ target_goal_id: childGoal }])
  })

  it('rejects parent period escape, parent cycles, link cycles, and explicit duplicate contribution', async () => {
    await goal(childGoal, 'Child goal', parentGoal, '2026-02-01', '2026-02-28')
    await expectSqlError(() => db.query(`update public.goals set ends_on='2026-01-31' where owner_id=$1 and id=$2`, [ownerA, parentGoal]), '23514')
    await expectSqlError(() => db.query(`update public.goals set parent_goal_id=$1 where owner_id=$2 and id=$3`, [childGoal, ownerA, parentGoal]), '23514')
    await link(linkId, parentGoal, { goal: childGoal })
    await expectSqlError(() => link('77777777-7777-4777-8777-777777777777', childGoal, { goal: parentGoal }), '23514')
    await link('88888888-8888-4888-8888-888888888888', childGoal, { task: taskA })
    await expectSqlError(() => link('99999999-9999-4999-8999-999999999999', parentGoal, { task: taskA }), '23514')
    await expectSqlError(() => link('aaaaaaaa-1111-4111-8111-111111111111', parentGoal, { project: projectA }), '23514')
  })

  it('keeps parent classification independent unless an explicit aggregation link exists', async () => {
    await goal(childGoal, 'Child goal', parentGoal, '2026-02-01', '2026-02-28')
    await link(linkId, parentGoal, { task: taskA })
    await link('77777777-7777-4777-8777-777777777777', childGoal, { task: taskA })
    expect((await db.query('select count(*)::int as n from public.goal_links')).rows[0]?.n).toBe(2)
  })

  it('uses kind-aware contribution keys and ignores another owner’s same-UUID goal links', async () => {
    await setIdentity(ownerA)
    await goal(childGoal, 'A child', parentGoal)
    await setIdentity(ownerB)
    await db.query(`insert into public.tasks (id,owner_id,project_id,title,category,status,progress) values ($1,$2,$3,'B task','학업','in_progress',10)`, [taskA, ownerB, projectA])
    await db.query(`insert into public.goals (id,owner_id,title,period_type,starts_on,ends_on) values ($1,$2,'B child','year','2026-01-01','2026-12-31')`, [childGoal, ownerB])
    await db.query(`insert into public.goal_links (owner_id,goal_id,target_task_id) values ($1,$2,$3)`, [ownerB, childGoal, taskA])
    await setIdentity(ownerA)
    await link(linkId, parentGoal, { goal: childGoal })
    await link('77777777-7777-4777-8777-777777777777', parentGoal, { task: taskA })
    expect((await db.query('select count(*)::int as n from public.goal_links where owner_id=$1', [ownerA])).rows[0]?.n).toBe(2)
  })

  it('does not treat equal goal and task UUIDs as a contribution cycle', async () => {
    await setIdentity(ownerA)
    await goal(taskA, 'Goal sharing task UUID')
    await link(linkId, parentGoal, { goal: taskA })
    await link('77777777-7777-4777-8777-777777777777', taskA, { task: taskA })
    await expectSqlError(() => link('88888888-8888-4888-8888-888888888888', parentGoal, { task: taskA }), '23514')
  })

  it('does not enforce contribution de-duplication for a manual-progress root', async () => {
    const manualId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await db.query(`insert into public.goals (id,owner_id,title,period_type,starts_on,ends_on,progress_mode,manual_progress) values ($1,$2,'Manual root','year','2026-01-01','2026-12-31','manual',40)`, [manualId, ownerA])
    await link(linkId, manualId, { project: projectA })
    await link('77777777-7777-4777-8777-777777777777', manualId, { task: taskA })
  })

  it('rechecks links when a task changes project and ignores cancellation state for structural overlap', async () => {
    await db.query(`insert into public.projects (id,owner_id,title,category) values ($1,$2,'Other project','대회')`, [projectC, ownerA])
    await db.query('update public.tasks set project_id=$1 where owner_id=$2 and id=$3', [projectC, ownerA, taskA])
    await link(linkId, parentGoal, { project: projectA })
    await link('77777777-7777-4777-8777-777777777777', parentGoal, { task: taskA })
    await expectSqlError(() => db.query(`update public.tasks set project_id=$1,status='cancelled',progress=0 where owner_id=$2 and id=$3`, [projectA, ownerA, taskA]), '23514')
    expect((await db.query('select project_id,status from public.tasks where id=$1 and owner_id=$2', [taskA, ownerA])).rows).toEqual([{ project_id: projectC, status: 'in_progress' }])
  })

  it('separates owners even when project and goal UUIDs are equal', async () => {
    await setIdentity(ownerB)
    const result = await db.query<{ title: string }>('select title from public.projects where owner_id=$1 and id=$2', [ownerB, projectA])
    expect(result.rows).toEqual([{ title: 'B project' }])
    await expectSqlError(() => db.query(`insert into public.goal_links(owner_id,goal_id,target_project_id) values ($1,$2,$3)`, [ownerB, parentGoal, projectA]), '23503')
  })

  it('returns a consistent owner snapshot and atomically commits an editable batch', async () => {
    await setIdentity(ownerA)
    const newProject = 'abababab-abab-4bab-8bab-abababababab'
    const result = await db.query<{ workspace_commit: any }>(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([
      { table: 'projects', op: 'insert', id: newProject, values: { title: 'RPC project', category: '학업', description: '상세' } },
      { table: 'tasks', op: 'insert', id: 'acacacac-acac-4cac-8cac-acacacacacac', values: { project_id: newProject, title: 'RPC task', category: '학업', status: 'todo', progress: 0, weight: 1 } },
    ])])
    const snapshot = result.rows[0]?.workspace_commit
    expect(snapshot.projects.some((row: any) => row.id === newProject && row.description === '상세' && row.version === 1)).toBe(true)
    expect(snapshot.tasks.some((row: any) => row.project_id === newProject)).toBe(true)
    expect((await db.query(`select * from public.workspace_snapshot()`)).rows).toHaveLength(1)
  })

  it('rejects stale versions and protected insert fields, rolling back the full batch', async () => {
    await setIdentity(ownerA)
    const newProject = 'adadadad-adad-4dad-8dad-adadadadadad'
    const changes = [
      { table: 'projects', op: 'insert', id: newProject, values: { title: 'Must roll back', category: '학업' } },
      { table: 'tasks', op: 'update', id: taskA, version: 999, values: { title: 'stale edit' } },
    ]
    await expectSqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify(changes)]), '40001')
    expect((await db.query('select id from public.projects where owner_id=$1 and id=$2', [ownerA, newProject])).rows).toHaveLength(0)
    await expectSqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([
      { table: 'projects', op: 'insert', id: newProject, values: { title: 'bad', category: '학업', owner_id: ownerB } },
    ])]), '22023')
  })

  it('blocks snapshot and commit for AAL1, anonymous, and unregistered identities', async () => {
    await setIdentity(ownerA, 'aal1')
    await expectSqlError(() => db.query('select public.workspace_snapshot()'), '42501')
    await expectSqlError(() => db.query(`select public.workspace_commit('[]'::jsonb)`), '42501')
    await setIdentity(absent)
    await expectSqlError(() => db.query('select public.workspace_snapshot()'), '42501')
    await setIdentity(ownerA, 'aal2', 'anon')
    await expectSqlError(() => db.query('select public.workspace_snapshot()'), '42501')
  })
})
