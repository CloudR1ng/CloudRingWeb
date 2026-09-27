import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const absent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let db: PGlite
async function identity(id: string, aal = 'aal2', role: 'authenticated'|'anon'|'service_role' = 'authenticated') {
  await db.exec('reset role')
  await db.exec(`select set_config('request.jwt.claim.sub','${id}',false); select set_config('request.jwt.claims','{"sub":"${id}","role":"${role}","aal":"${aal}"}',false); set role ${role}`)
}
async function sqlError(action: () => Promise<unknown>, code: string) {
  await db.exec('savepoint expected')
  let caught: any
  try { await action() } catch (error) { caught = error }
  await db.exec('rollback to savepoint expected; release savepoint expected')
  expect(caught).toMatchObject({ code })
}
async function saveSettings(enabled:boolean,daily:boolean) {
  const time=(await db.query<{time:string}>(`select to_char(timezone('Asia/Seoul',now())::time,'HH24:MI') as time`)).rows[0]!.time
  return db.query(`select public.save_notification_settings(0,$1::jsonb)`,[JSON.stringify({enabled,daily_digest_enabled:daily,daily_digest_time:time,event_lead_minutes:30,date_due_time:'17:00',include_details:false})])
}

describe('workspace snapshot and commit RPC', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
      alter table storage.objects enable row level security;
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role; grant execute on function auth.uid(),auth.jwt() to public;
      grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
      insert into auth.users values ('${owner}'),('${other}'),('${absent}');`)
    for (const file of ['202609270001_owner_mfa_data.sql','202609270002_goal_links.sql','202609270003_workspace_rpc.sql','202609270004_notifications_storage.sql']) {
      await db.exec(await readFile(resolve(process.cwd(), 'supabase/migrations', file), 'utf8'))
    }
    await db.exec(`insert into public.owner_registry(owner_id) values ('${owner}'),('${other}')`)
  })
  beforeEach(async () => { await db.exec('begin'); await identity(owner) })
  afterEach(async () => { await db.exec('rollback; reset role') })
  afterAll(async () => { await db.close() })

  it('returns only the session owner rows and successful commit returns the final versioned snapshot', async () => {
    await identity(other)
    await db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([{table:'projects',op:'insert',id:'11111111-1111-4111-8111-111111111111',values:{title:'private',category:'학업'}}])])
    await identity(owner)
    const empty = (await db.query('select public.workspace_snapshot() as s')).rows[0]!.s
    expect(empty.projects).toEqual([])
    const snapshot = (await db.query(`select public.workspace_commit($1::jsonb) as s`, [JSON.stringify([
      {table:'projects',op:'insert',id:'22222222-2222-4222-8222-222222222222',values:{title:'atomic',category:'학업',description:'details',progress_mode:'target_value',current_value:3,target_value:10,device_paths:[{name:'개발 PC',path:'D:\\CloudRing\\Dev\\CloudRingWeb'}]}},
      {table:'tasks',op:'insert',id:'33333333-3333-4333-8333-333333333333',values:{project_id:'22222222-2222-4222-8222-222222222222',title:'task',category:'학업',status:'todo',progress:0,weight:1}},
    ])])).rows[0]!.s
    expect(snapshot.projects[0]).toMatchObject({ title:'atomic', description:'details', owner_id:owner, version:1, progress_mode:'target_value',current_value:3,target_value:10,device_paths:[{name:'개발 PC',path:'D:\\CloudRing\\Dev\\CloudRingWeb'}] })
    expect(snapshot.tasks[0]).toMatchObject({ title:'task', owner_id:owner, version:1 })
  })

  it('rolls back prior changes on stale version, rejects protected fields, and checks project detail protocols', async () => {
    await db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([{table:'tasks',op:'insert',id:'44444444-4444-4444-8444-444444444444',values:{title:'original',category:'학업',status:'todo',progress:0,weight:1}}])])
    await sqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([
      {table:'projects',op:'insert',id:'55555555-5555-4555-8555-555555555555',values:{title:'must rollback',category:'학업'}},
      {table:'tasks',op:'update',id:'44444444-4444-4444-8444-444444444444',version:77,values:{title:'stale'}},
    ])]), '40001')
    expect((await db.query(`select 1 from public.projects where id='55555555-5555-4555-8555-555555555555' and owner_id=$1`,[owner])).rows).toHaveLength(0)
    await sqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([{table:'projects',op:'insert',id:'66666666-6666-4666-8666-666666666666',values:{title:'bad',category:'학업',owner_id:other}}])]), '22023')
    await sqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([{table:'projects',op:'insert',id:'77777777-7777-4777-8777-777777777777',values:{title:'bad URL',category:'학업',related_links:[{label:'x',url:'javascript:alert(1)'}]}}])]), '23514')
    await sqlError(() => db.query(`select public.workspace_commit($1::jsonb)`, [JSON.stringify([{table:'projects',op:'insert',id:'88888888-8888-4888-8888-888888888888',values:{title:'null field',category:'학업',collaborator_roles:[{name:null,role:null}]}}])]), '23514')
  })

  it('denies AAL1, anonymous, and unregistered snapshot access', async () => {
    await identity(owner,'aal1')
    await sqlError(() => db.query('select public.workspace_snapshot()'), '42501')
    await identity(absent)
    await sqlError(() => db.query('select public.workspace_snapshot()'), '42501')
    await identity(owner,'aal2','anon')
    await sqlError(() => db.query('select public.workspace_snapshot()'), '42501')
  })

  it('saves only the owner’s AAL2 push endpoint, settings, and explicit test-send queue', async () => {
    const endpoint='https://web.push.apple.com/device-token-a'
    const keys='A'.repeat(87), auth='B'.repeat(22)
    const id=(await db.query<{id:string}>(`select public.register_push_device($1,$2,$3,'iPhone') id`,[endpoint,keys,auth])).rows[0]!.id
    await saveSettings(true,false)
    expect((await db.query(`select count(*)::int as n from public.queue_test_notification()`)).rows[0]?.n).toBe(1)
    await identity(other)
    expect((await db.query('select * from public.push_devices')).rows).toHaveLength(0)
    await sqlError(() => db.query(`select public.register_push_device($1,$2,$3,'other')`,[endpoint,keys,auth]),'42501')
    await identity(owner)
    expect((await db.query(`select public.deactivate_push_device($1) as done`,[id])).rows[0]?.done).toBe(true)
    expect((await db.query('select public.queue_test_notification() as n')).rows[0]?.n).toBe(0)
    await identity(owner,'aal1')
    await sqlError(() => db.query(`select public.register_push_device('https://fcm.googleapis.com/token','${keys}','${auth}','x')`),'42501')
  })

  it('serializes server delivery claims, expires old subscriptions on 410, and limits storage to owner project paths', async () => {
    const endpoint='https://fcm.googleapis.com/fcm/send/device-token-b'
    const device=(await db.query<{id:string}>(`select public.register_push_device($1,$2,$3,'Chrome') id`,[endpoint,'C'.repeat(87),'D'.repeat(22)])).rows[0]!.id
    const device2=(await db.query<{id:string}>(`select public.register_push_device($1,$2,$3,'Safari') id`,['https://web.push.apple.com/device-token-c','E'.repeat(87),'F'.repeat(22)])).rows[0]!.id
    await saveSettings(true,true)
    const project='abababab-abab-4bab-8bab-abababababab'
    await db.query(`insert into public.projects(id,owner_id,title,category) values ($1,$2,'image project','학업')`,[project,owner])
    const path=`${owner}/projects/${project}/asset.png`
    await db.query(`update public.projects set representative_image_path=$1 where owner_id=$2 and id=$3`,[path,owner,project])
    await db.query(`insert into storage.objects(bucket_id,name,owner_id) values ('cloudring-private',$1,$2)`,[path,owner])
    await sqlError(() => db.query(`insert into storage.objects(bucket_id,name,owner_id) values ('cloudring-private',$1,$2)`,[`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/projects/${project}/other.png`,owner]),'42501')
    expect((await db.query(`select count(*)::int as n from storage.objects where name=$1`,[path])).rows[0]?.n).toBe(1)
    await identity(other)
    expect((await db.query(`select count(*)::int as n from storage.objects where name=$1`,[path])).rows[0]?.n).toBe(0)
    await identity(owner)
    expect((await db.query(`delete from storage.objects where name=$1 returning name`,[path])).rows).toHaveLength(0)
    expect((await db.query(`select count(*)::int as n from storage.objects where name=$1`,[path])).rows[0]?.n).toBe(1)
    const linkedProject=(await db.query<{version:number}>(`select version from public.projects where id=$1 and owner_id=$2`,[project,owner])).rows[0]!
    await db.query(`select public.workspace_commit($1::jsonb)`,[JSON.stringify([{table:'projects',op:'update',id:project,version:linkedProject.version,values:{representative_image_path:null}}])])
    expect((await db.query(`delete from storage.objects where name=$1 returning name`,[path])).rows).toEqual([{name:path}])
    expect((await db.query(`select count(*)::int as n from storage.objects where name=$1`,[path])).rows[0]?.n).toBe(0)

    await identity(owner,'aal2','service_role')
    await db.query('select public.plan_notification_jobs()')
    const claims=await db.query<any>('select * from public.claim_push_deliveries(10)')
    expect(claims.rows).toHaveLength(2)
    const oldClaim=claims.rows.find((r:any)=>r.device_id===device)!
    const expiredClaim=claims.rows.find((r:any)=>r.device_id===device2)!
    await db.query(`update public.notification_deliveries set lease_until=now()-interval '1 second' where id=$1`,[oldClaim.delivery_id])
    const reclaimed=await db.query<any>('select * from public.claim_push_deliveries(10)')
    const currentClaim=reclaimed.rows.find((r:any)=>r.delivery_id===oldClaim.delivery_id)!
    expect(currentClaim.lease_token).not.toBe(oldClaim.lease_token)
    expect((await db.query(`select public.finish_push_delivery($1,$2,'accepted',202) as ok`,[oldClaim.delivery_id,oldClaim.lease_token])).rows[0]?.ok).toBe(false)
    expect((await db.query(`select public.finish_push_delivery($1,$2,'expired',410) as ok`,[expiredClaim.delivery_id,expiredClaim.lease_token])).rows[0]?.ok).toBe(true)
    expect((await db.query(`select public.finish_push_delivery($1,$2,'accepted',202) as ok`,[currentClaim.delivery_id,currentClaim.lease_token])).rows[0]?.ok).toBe(true)
    await identity(owner)
    expect((await db.query(`select active,last_error_code from public.push_devices where id=$1`,[device2])).rows[0]).toMatchObject({active:false,last_error_code:410})
    expect((await db.query(`select active,last_error_code from public.push_devices where id=$1`,[device])).rows[0]).toMatchObject({active:true,last_error_code:null})
  })
})
