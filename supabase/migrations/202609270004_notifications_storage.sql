-- Project numeric target progress mode, notification preferences, private image bucket, and server-owned push queue.
alter table public.projects add column current_value numeric(14,3), add column target_value numeric(14,3);
alter table public.projects drop constraint projects_progress_mode_check;
alter table public.projects drop constraint projects_check1;
alter table public.projects add constraint projects_progress_mode_check check (progress_mode in ('task_weighted','manual','target_value'));
alter table public.projects add constraint projects_progress_values_check check (
  (progress_mode='task_weighted' and manual_progress is null and current_value is null and target_value is null)
  or (progress_mode='manual' and manual_progress is not null and current_value is null and target_value is null)
  or (progress_mode='target_value' and manual_progress is null and current_value is not null and current_value >= 0 and target_value is not null and target_value > 0)
);

create table public.notification_settings (
  owner_id uuid primary key references public.owner_registry(owner_id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'Asia/Seoul' check (timezone='Asia/Seoul'),
  daily_digest_enabled boolean not null default true,
  daily_digest_time time not null default '08:00',
  event_lead_minutes smallint not null default 30 check (event_lead_minutes between 0 and 10080),
  date_due_time time not null default '17:00',
  include_details boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0)
);
alter table public.notification_settings enable row level security;
revoke all on table public.notification_settings from anon, authenticated;
grant select on table public.notification_settings to authenticated;
create policy notification_settings_owner on public.notification_settings for all to authenticated
  using (owner_id=(select auth.uid()) and exists(select 1 from public.owner_registry r where r.owner_id=(select auth.uid())))
  with check (owner_id=(select auth.uid()) and exists(select 1 from public.owner_registry r where r.owner_id=(select auth.uid())));
create policy notification_settings_aal2 on public.notification_settings as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal')='aal2') with check ((select auth.jwt()->>'aal')='aal2');
create function public.touch_notification_settings()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at or new.version is distinct from old.version then raise exception using errcode='42501',message='immutable settings field'; end if;
  new.updated_at:=pg_catalog.now(); new.version:=old.version+1; return new;
end; $$;
create trigger notification_settings_touch before update on public.notification_settings for each row execute function public.touch_notification_settings();

create function public.save_notification_settings(p_expected_version integer,p_values jsonb)
returns public.notification_settings language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_result public.notification_settings;
begin
  if v_owner is null or (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists(select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501',message='notification settings access denied'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('enabled','daily_digest_enabled','daily_digest_time','event_lead_minutes','date_due_time','include_details')) then
    raise exception using errcode='22023',message='invalid settings fields'; end if;
  if not (p_values ?& array['enabled','daily_digest_enabled','daily_digest_time','event_lead_minutes','date_due_time','include_details'])
    or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'daily_digest_enabled') is distinct from 'boolean'
    or jsonb_typeof(p_values->'daily_digest_time') is distinct from 'string' or jsonb_typeof(p_values->'event_lead_minutes') is distinct from 'number'
    or jsonb_typeof(p_values->'date_due_time') is distinct from 'string' or jsonb_typeof(p_values->'include_details') is distinct from 'boolean' then
    raise exception using errcode='22023',message='invalid settings value'; end if;
  if p_expected_version=0 then
    insert into public.notification_settings(owner_id,enabled,daily_digest_enabled,daily_digest_time,event_lead_minutes,date_due_time,include_details)
    values(v_owner,(p_values->>'enabled')::boolean,(p_values->>'daily_digest_enabled')::boolean,(p_values->>'daily_digest_time')::time,
      (p_values->>'event_lead_minutes')::smallint,(p_values->>'date_due_time')::time,(p_values->>'include_details')::boolean)
    returning * into v_result;
  else
    update public.notification_settings set enabled=(p_values->>'enabled')::boolean,daily_digest_enabled=(p_values->>'daily_digest_enabled')::boolean,
      daily_digest_time=(p_values->>'daily_digest_time')::time,event_lead_minutes=(p_values->>'event_lead_minutes')::smallint,
      date_due_time=(p_values->>'date_due_time')::time,include_details=(p_values->>'include_details')::boolean
    where owner_id=v_owner and version=p_expected_version returning * into v_result;
    if not found then raise exception using errcode='40001',message='notification settings conflict'; end if;
  end if;
  return v_result;
exception when unique_violation then raise exception using errcode='40001',message='notification settings conflict';
end; $$;

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 32 and 4096 and endpoint ~ '^https://[^/:@?#[:space:]]+/[^?#[:space:]]+$'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{16,64}$'),
  device_name text not null default '이 기기' check (length(device_name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accepted_at timestamptz,
  last_error_code integer,
  unique(owner_id,id)
);
alter table public.push_devices enable row level security;
revoke all on table public.push_devices from anon, authenticated;
grant select on table public.push_devices to authenticated;
create policy push_devices_owner_read on public.push_devices for select to authenticated
  using (owner_id=(select auth.uid()) and exists(select 1 from public.owner_registry r where r.owner_id=(select auth.uid())));
create policy push_devices_aal2_read on public.push_devices as restrictive for select to authenticated
  using ((select auth.jwt()->>'aal')='aal2');

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  kind text not null check (kind in ('daily_digest','event_start','task_start','task_due','test')),
  source_table text check (source_table in ('tasks','events')),
  source_id uuid,
  source_version integer,
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  check (expires_at > scheduled_at),
  check ((source_table is null and source_id is null and source_version is null) or (source_table is not null and source_id is not null and source_version > 0)),
  unique(owner_id,dedupe_key),
  unique(owner_id,id)
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  job_id uuid not null references public.notification_jobs(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','leased','accepted','obsolete','expired','failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_status_code integer,
  last_error_kind text check (last_error_kind is null or last_error_kind in ('network','provider','expired','obsolete','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id,device_id),
  foreign key(owner_id,job_id) references public.notification_jobs(owner_id,id) on delete cascade,
  foreign key(owner_id,device_id) references public.push_devices(owner_id,id) on delete cascade
);
alter table public.notification_jobs enable row level security;
alter table public.notification_deliveries enable row level security;
revoke all on table public.notification_jobs,public.notification_deliveries from anon,authenticated;
grant select,insert,update,delete on table public.notification_jobs,public.notification_deliveries to service_role;
grant select,insert,update,delete on table public.push_devices to service_role;
grant select on table public.notification_settings,public.owner_registry,public.projects,public.tasks,public.events to service_role;
create index notification_deliveries_claim on public.notification_deliveries(state,next_attempt_at,lease_until,created_at);
create index notification_jobs_source on public.notification_jobs(owner_id,source_table,source_id,source_version);

create function public.register_push_device(p_endpoint text,p_p256dh text,p_auth text,p_device_name text default '이 기기')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_host text; v_id uuid;
begin
  if v_owner is null or (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists(select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501',message='push registration denied'; end if;
  if p_endpoint is null or length(p_endpoint)>4096 or p_endpoint !~ '^https://[^/:@?#[:space:]]+/[^?#[:space:]]+$'
    or p_p256dh !~ '^[A-Za-z0-9_-]{80,100}$' or p_auth !~ '^[A-Za-z0-9_-]{16,64}$'
    or length(coalesce(p_device_name,'')) not between 1 and 80 then raise exception using errcode='22023',message='invalid push subscription'; end if;
  v_host:=lower(substring(p_endpoint from '^https://([^/:?#]+)'));
  if not (v_host in ('web.push.apple.com','updates.push.services.mozilla.com','push.services.mozilla.com','fcm.googleapis.com')
    or v_host like '%.fcm.googleapis.com' or v_host like '%.push.services.mozilla.com' or v_host like 'wns2-%.notify.windows.com') then
    raise exception using errcode='22023',message='push provider is not allowed'; end if;
  insert into public.push_devices(owner_id,endpoint,p256dh,auth_secret,device_name,active,updated_at)
  values(v_owner,p_endpoint,p_p256dh,p_auth,left(btrim(p_device_name),80),true,now())
  on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,device_name=excluded.device_name,active=true,updated_at=now()
    where push_devices.owner_id=excluded.owner_id
  returning id into v_id;
  if v_id is null then raise exception using errcode='42501',message='subscription belongs to another account'; end if;
  return v_id;
end; $$;

create function public.deactivate_push_device(p_device_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_rows integer;
begin
  if v_owner is null or (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists(select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501',message='push device access denied'; end if;
  update public.push_devices set active=false,updated_at=now() where id=p_device_id and owner_id=v_owner and active;
  get diagnostics v_rows=row_count; return v_rows=1;
end; $$;

create function public.queue_test_notification()
returns integer language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=(select auth.uid()); v_job uuid; v_count integer;
begin
  if v_owner is null or (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists(select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501',message='push test denied'; end if;
  if not exists(select 1 from public.push_devices d where d.owner_id=v_owner and d.active) then return 0; end if;
  insert into public.notification_jobs(owner_id,kind,scheduled_at,expires_at,dedupe_key)
  values(v_owner,'test',now(),now()+interval '10 minutes','test:'||gen_random_uuid()::text) returning id into v_job;
  insert into public.notification_deliveries(owner_id,job_id,device_id)
  select v_owner,v_job,d.id from public.push_devices d where d.owner_id=v_owner and d.active;
  get diagnostics v_count=row_count; return v_count;
end; $$;

-- Called by the server planner once per minute. The date window permits recovery after a brief scheduler outage.
create function public.plan_notification_jobs()
returns integer language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=now(); v_added integer:=0; v_n integer;
begin
  if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception using errcode='42501',message='server role required'; end if;
  update public.notification_deliveries d set state='expired',last_error_kind='expired',updated_at=v_now
    from public.notification_jobs j where d.job_id=j.id and d.state in ('queued','leased') and j.expires_at<=v_now;
  delete from public.notification_jobs where created_at < v_now - interval '30 days';

  with candidate as (
    select s.owner_id,'daily_digest'::text as kind,null::text as source_table,null::uuid as source_id,null::integer as source_version,
      ((timezone('Asia/Seoul',v_now)::date+s.daily_digest_time) at time zone 'Asia/Seoul') as scheduled_at,
      ((timezone('Asia/Seoul',v_now)::date+s.daily_digest_time) at time zone 'Asia/Seoul')+interval '3 hours' as expires_at,
      'daily:'||(timezone('Asia/Seoul',v_now)::date)::text as dedupe_key
    from public.notification_settings s where s.enabled and s.daily_digest_enabled
      and timezone('Asia/Seoul',v_now)::time >= s.daily_digest_time
      and ((timezone('Asia/Seoul',v_now)::date+s.daily_digest_time) at time zone 'Asia/Seoul') between v_now-interval '3 hours' and v_now
      and exists(select 1 from public.push_devices d where d.owner_id=s.owner_id and d.active)
    union all
    select s.owner_id,'event_start','events',e.id,e.version,e.starts_at-make_interval(mins=>s.event_lead_minutes),
      e.starts_at-make_interval(mins=>s.event_lead_minutes)+interval '1 hour','event:'||e.id::text||':'||e.version::text
    from public.notification_settings s join public.events e on e.owner_id=s.owner_id and not e.all_day and e.starts_at is not null
      and e.starts_at-make_interval(mins=>s.event_lead_minutes) between v_now-interval '1 hour' and v_now
    where s.enabled and exists(select 1 from public.push_devices d where d.owner_id=s.owner_id and d.active)
    union all
    select s.owner_id,'task_start','tasks',t.id,t.version,t.planned_at-make_interval(mins=>s.event_lead_minutes),
      t.planned_at-make_interval(mins=>s.event_lead_minutes)+interval '1 hour','task-start:'||t.id::text||':'||t.version::text
    from public.notification_settings s join public.tasks t on t.owner_id=s.owner_id and t.planned_at is not null and t.status not in ('completed','cancelled')
      and t.planned_at-make_interval(mins=>s.event_lead_minutes) between v_now-interval '1 hour' and v_now
    where s.enabled and exists(select 1 from public.push_devices d where d.owner_id=s.owner_id and d.active)
    union all
    select s.owner_id,'task_due','tasks',t.id,t.version,
      coalesce(t.due_at-make_interval(mins=>s.event_lead_minutes),((t.due_on+s.date_due_time) at time zone 'Asia/Seoul')),
      coalesce(t.due_at-make_interval(mins=>s.event_lead_minutes),((t.due_on+s.date_due_time) at time zone 'Asia/Seoul'))+interval '1 hour',
      'task-due:'||t.id::text||':'||t.version::text
    from public.notification_settings s join public.tasks t on t.owner_id=s.owner_id
    where s.enabled and t.status not in ('completed','cancelled') and (
      (t.due_at is not null and t.due_at-make_interval(mins=>s.event_lead_minutes) between v_now-interval '1 hour' and v_now)
      or (t.due_at is null and ((t.due_on+s.date_due_time) at time zone 'Asia/Seoul') between v_now-interval '1 hour' and v_now)
    ) and exists(select 1 from public.push_devices d where d.owner_id=s.owner_id and d.active)
  ), inserted as (
    insert into public.notification_jobs(owner_id,kind,source_table,source_id,source_version,scheduled_at,expires_at,dedupe_key)
    select owner_id,kind,source_table,source_id,source_version,scheduled_at,expires_at,dedupe_key from candidate
    on conflict(owner_id,dedupe_key) do nothing returning id,owner_id
  ), available as (
    select j.id,j.owner_id from inserted j
    union
    select j.id,j.owner_id from public.notification_jobs j join candidate c on c.owner_id=j.owner_id and c.dedupe_key=j.dedupe_key
      where j.expires_at>v_now
  )
    insert into public.notification_deliveries(owner_id,job_id,device_id)
    select j.owner_id,j.id,d.id from available j join public.push_devices d on d.owner_id=j.owner_id and d.active
  on conflict(job_id,device_id) do nothing;
  get diagnostics v_n=row_count; v_added:=v_added+v_n;
  return v_added;
end; $$;

create function public.claim_push_deliveries(p_limit integer default 50)
returns table(delivery_id uuid,job_id uuid,owner_id uuid,device_id uuid,endpoint text,p256dh text,auth_secret text,kind text,source_table text,source_id uuid,source_version integer,scheduled_at timestamptz,expires_at timestamptz,attempt_count integer,include_details boolean,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception using errcode='42501',message='server role required'; end if;
  update public.notification_deliveries d set state='failed',last_error_kind='failed',lease_until=null,lease_token=null,updated_at=now()
    where d.state='leased' and d.lease_until<=now() and d.attempt_count>=5;
  return query with chosen as (
    select d.id from public.notification_deliveries d join public.notification_jobs j on j.id=d.job_id and j.owner_id=d.owner_id
    join public.push_devices p on p.id=d.device_id and p.owner_id=d.owner_id and p.active
    where d.attempt_count<5 and j.expires_at>now() and j.scheduled_at<=now() and d.next_attempt_at<=now()
      and (d.state='queued' or (d.state='leased' and d.lease_until<now()))
      and (j.kind='test' or exists(select 1 from public.notification_settings s where s.owner_id=d.owner_id and s.enabled))
    order by j.scheduled_at,d.created_at limit greatest(1,least(p_limit,100)) for update of d skip locked
  ), claimed as (
    update public.notification_deliveries d set state='leased',attempt_count=d.attempt_count+1,lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),updated_at=now()
    from chosen c where d.id=c.id returning d.id,d.owner_id,d.job_id,d.device_id,d.attempt_count,d.lease_token
  )
  select c.id,j.id,j.owner_id,p.id,p.endpoint,p.p256dh,p.auth_secret,j.kind,j.source_table,j.source_id,j.source_version,j.scheduled_at,j.expires_at,c.attempt_count::integer,coalesce(s.include_details,false),c.lease_token
  from claimed c join public.notification_jobs j on j.id=c.job_id and j.owner_id=c.owner_id join public.push_devices p on p.id=c.device_id and p.owner_id=c.owner_id
  left join public.notification_settings s on s.owner_id=j.owner_id;
end; $$;

create function public.finish_push_delivery(p_delivery_id uuid,p_lease_token uuid,p_outcome text,p_status_code integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v record;
begin
  if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception using errcode='42501',message='server role required'; end if;
  if p_outcome not in ('accepted','retry','expired','obsolete','failed') then raise exception using errcode='22023',message='invalid outcome'; end if;
  select d.id,d.job_id,d.device_id,d.attempt_count into v from public.notification_deliveries d where d.id=p_delivery_id and d.state='leased' and d.lease_token=p_lease_token and d.lease_until>now() for update;
  if not found then return false; end if;
  if p_outcome='retry' and v.attempt_count<5 then
    update public.notification_deliveries set state='queued',next_attempt_at=now()+make_interval(secs=>least(1800,30*(2^least(v.attempt_count,5))::integer)),lease_until=null,lease_token=null,last_status_code=p_status_code,last_error_kind='provider',updated_at=now() where id=p_delivery_id;
  else
    update public.notification_deliveries set state=case when p_outcome='retry' then 'failed' else p_outcome end,
      lease_until=null,lease_token=null,last_status_code=p_status_code,
      last_error_kind=case when p_outcome in ('expired','obsolete','failed') then p_outcome when p_outcome='retry' then 'failed' else null end,
      updated_at=now() where id=p_delivery_id;
  end if;
  if p_status_code in (404,410) then update public.push_devices set active=false,last_error_code=p_status_code,updated_at=now() where id=v.device_id; end if;
  if p_outcome='accepted' then update public.push_devices set last_accepted_at=now(),last_error_code=null,updated_at=now() where id=v.device_id; end if;
  return true;
end; $$;

revoke all on function public.save_notification_settings(integer,jsonb) from public,anon;
revoke all on function public.register_push_device(text,text,text,text) from public,anon;
revoke all on function public.deactivate_push_device(uuid) from public,anon;
revoke all on function public.queue_test_notification() from public,anon;
revoke all on function public.plan_notification_jobs() from public,anon,authenticated;
revoke all on function public.claim_push_deliveries(integer) from public,anon,authenticated;
revoke all on function public.finish_push_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.save_notification_settings(integer,jsonb),public.register_push_device(text,text,text,text),public.deactivate_push_device(uuid),public.queue_test_notification() to authenticated;
grant execute on function public.plan_notification_jobs(),public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,integer) to service_role;

-- Storage bucket is private. Policy names are stable so subsequent policy updates can target them.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cloudring-private','cloudring-private',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy cloudring_private_select on storage.objects for select to authenticated
  using(bucket_id='cloudring-private' and (select auth.jwt()->>'aal')='aal2' and owner_id=(select auth.uid())::text
    and name ~ ('^'||(select auth.uid())::text||'/projects/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'));
create policy cloudring_private_insert on storage.objects for insert to authenticated
  with check(bucket_id='cloudring-private' and (select auth.jwt()->>'aal')='aal2' and owner_id=(select auth.uid())::text
    and name ~ ('^'||(select auth.uid())::text||'/projects/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$')
    and exists(select 1 from public.projects p where p.owner_id=(select auth.uid()) and p.id::text=split_part(name,'/',3)));
create policy cloudring_private_delete on storage.objects for delete to authenticated
  using(bucket_id='cloudring-private' and (select auth.jwt()->>'aal')='aal2' and owner_id=(select auth.uid())::text
    and name ~ ('^'||(select auth.uid())::text||'/projects/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$')
    and not exists(select 1 from public.projects p where p.owner_id=(select auth.uid()) and p.representative_image_path=name));
