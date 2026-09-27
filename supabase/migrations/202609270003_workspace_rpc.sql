-- Structured project detail fields used by the authenticated workspace.
alter table public.projects
  add column description text not null default '',
  add column representative_image_path text,
  add column milestones jsonb not null default '[]'::jsonb,
  add column collaborator_roles jsonb not null default '[]'::jsonb,
  add column device_paths jsonb not null default '[]'::jsonb,
  add column related_links jsonb not null default '[]'::jsonb;

alter table public.projects add constraint projects_detail_arrays check (
  jsonb_typeof(milestones) = 'array' and jsonb_array_length(milestones) <= 100 and
  jsonb_typeof(collaborator_roles) = 'array' and jsonb_array_length(collaborator_roles) <= 100 and
  jsonb_typeof(device_paths) = 'array' and jsonb_array_length(device_paths) <= 100 and
  jsonb_typeof(related_links) = 'array' and jsonb_array_length(related_links) <= 100
);
alter table public.projects add constraint projects_image_owner_path check (
  representative_image_path is null or
  (length(representative_image_path) between 1 and 500 and representative_image_path like owner_id::text || '/%' and representative_image_path !~ '(^/|(^|/)\.\.?(/|$)|:|\\\\)')
);

create function public.valid_project_details(p_milestones jsonb, p_roles jsonb, p_paths jsonb, p_links jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(p_milestones) <> 'array' or jsonb_array_length(p_milestones) > 100
    or jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) > 100
    or jsonb_typeof(p_paths) <> 'array' or jsonb_array_length(p_paths) > 100
    or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 100 then return false; end if;
  for item in select value from jsonb_array_elements(p_milestones) loop
    if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['id','title','dueOn','progress'])
      or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title') not between 1 and 300
      or not (jsonb_typeof(item->'dueOn')='null' or (jsonb_typeof(item->'dueOn')='string' and item->>'dueOn' ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_catalog.to_char(pg_catalog.to_date(item->>'dueOn','YYYY-MM-DD'),'YYYY-MM-DD')=item->>'dueOn'))
      or jsonb_typeof(item->'progress') is distinct from 'number' or (item->>'progress') !~ '^\d{1,3}$'
      or (item->>'progress')::integer not between 0 and 100 then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_roles) loop
    if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['name','role'])
      or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name') not between 1 and 120
      or jsonb_typeof(item->'role') is distinct from 'string' or length(item->>'role') not between 1 and 200 then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_paths) loop
    if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['name','path'])
      or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name') not between 1 and 120
      or jsonb_typeof(item->'path') is distinct from 'string' or length(item->>'path') not between 1 and 500 then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['label','url'])
      or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label') not between 1 and 120
      or jsonb_typeof(item->'url') is distinct from 'string' or length(item->>'url') not between 9 and 2048
      or (item->>'url') !~ '^https://[^[:space:]]+$' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
alter table public.projects drop constraint projects_detail_arrays;
alter table public.projects add constraint projects_detail_arrays check (public.valid_project_details(milestones,collaborator_roles,device_paths,related_links));

-- Keep legacy table grants safe as well: ids and audit/version fields are always server-owned.
create or replace function public.touch_updated_at_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'immutable server field';
  end if;
  new.updated_at := pg_catalog.now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.guard_server_insert_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id is null or new.owner_id is distinct from (select auth.uid()) then
    raise exception using errcode = '42501', message = 'owner mismatch';
  end if;
  new.created_at := pg_catalog.now();
  new.updated_at := new.created_at;
  new.version := 1;
  return new;
end;
$$;
revoke all on function public.guard_server_insert_fields() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['projects','tasks','events','goals','goal_links'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.guard_server_insert_fields()', t || '_server_insert_guard', t);
  end loop;
end $$;

create function public.workspace_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid());
begin
  if v_owner is null or (select auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501', message='workspace access denied';
  end if;
  return jsonb_build_object(
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.projects x where x.owner_id=v_owner),'[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.tasks x where x.owner_id=v_owner),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.events x where x.owner_id=v_owner),'[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.goals x where x.owner_id=v_owner),'[]'::jsonb),
    'goal_links', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.goal_links x where x.owner_id=v_owner),'[]'::jsonb)
  );
end;
$$;

create function public.workspace_commit(p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_change jsonb; v_table text; v_op text; v_id uuid; v_version integer;
  v_values jsonb; v_allowed text[]; v_keys text[]; v_cols text; v_selects text; v_sets text;
  v_result jsonb; v_count integer;
  v_table_sql text;
begin
  if v_owner is null or (select auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode='42501', message='workspace access denied';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 200 then
    raise exception using errcode='22023', message='invalid change batch';
  end if;
  insert into public.goal_graph_locks(owner_id) values (v_owner) on conflict (owner_id) do nothing;
  perform 1 from public.goal_graph_locks where owner_id=v_owner for update;
  set constraints public.goals_graph_valid, public.tasks_graph_valid, public.projects_graph_valid, public.goal_links_graph_valid deferred;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_table := v_change->>'table'; v_op := v_change->>'op';
    if v_table is null or v_op is null or v_table not in ('projects','tasks','events','goals','goal_links') or v_op not in ('insert','update','delete') then
      raise exception using errcode='22023', message='unsupported table or operation';
    end if;
    if exists(select 1 from jsonb_object_keys(v_change) k where k not in ('table','op','id','version','values')) then
      raise exception using errcode='22023', message='unknown change envelope field';
    end if;
    v_table_sql := format('public.%I',v_table);
    v_id := (v_change->>'id')::uuid;
    if v_id is null or (v_op='insert' and v_change ? 'version') or (v_op='delete' and v_change ? 'values') then
      raise exception using errcode='22023', message='invalid change envelope';
    end if;
    v_version := case when v_op='insert' then null else (v_change->>'version')::integer end;
    if v_op <> 'insert' and (v_version is null or v_version < 1) then
      raise exception using errcode='22023', message='expected version required';
    end if;
    v_values := coalesce(v_change->'values','{}'::jsonb);
    if jsonb_typeof(v_values) <> 'object' then raise exception using errcode='22023', message='values must be object'; end if;
    v_allowed := case v_table
      when 'projects' then array['title','overview','description','representative_image_path','milestones','collaborator_roles','device_paths','related_links','category','tools','devices','collaborators','status','progress_mode','manual_progress','current_value','target_value','starts_on','due_on']
      when 'tasks' then array['project_id','title','category','planned_on','planned_at','due_on','due_at','status','progress','weight']
      when 'events' then array['project_id','title','category','all_day','event_on','starts_at','ends_at','timezone','location','notes']
      when 'goals' then array['parent_goal_id','title','period_type','starts_on','ends_on','progress_mode','manual_progress','current_value','target_value']
      else array['goal_id','target_goal_id','target_project_id','target_task_id','weight'] end;
    select array_agg(key order by key) into v_keys from jsonb_object_keys(v_values) key;
    if exists(select 1 from unnest(coalesce(v_keys,'{}')) k where not (k = any(v_allowed))) then
      raise exception using errcode='22023', message='protected or unknown field';
    end if;

    if v_op='insert' then
      v_cols := 'id,owner_id' || case when cardinality(coalesce(v_keys,'{}'))=0 then '' else ','||array_to_string(v_keys,',') end;
      v_selects := '$1::uuid,$2::uuid' || case when cardinality(coalesce(v_keys,'{}'))=0 then '' else ','||(
        select string_agg(format('(pg_catalog.jsonb_populate_record(null::%s,$3)).%I',v_table_sql,k),',' order by k) from unnest(v_keys) k) end;
      execute format('insert into %s (%s) values (%s) returning to_jsonb(%s.*)',v_table_sql,
        (select string_agg(format('%I',k),',') from unnest(string_to_array(v_cols,',')) k),v_selects,v_table_sql)
        into v_result using v_id,v_owner,v_values;
    elsif v_op='update' then
      if cardinality(coalesce(v_keys,'{}'))=0 then raise exception using errcode='22023', message='empty update'; end if;
      select string_agg(format('%I=(pg_catalog.jsonb_populate_record(null::%s,$1)).%I',k,v_table_sql,k),',') into v_sets from unnest(v_keys) k;
      execute format('update %s set %s where owner_id=$2 and id=$3 and version=$4 returning to_jsonb(%s.*)',v_table_sql,v_sets,v_table_sql)
        into v_result using v_values,v_owner,v_id,v_version;
      if v_result is null then raise exception using errcode='40001', message='workspace version conflict'; end if;
    else
      execute format('delete from %s where owner_id=$1 and id=$2 and version=$3 returning to_jsonb(%s.*)',v_table_sql,v_table_sql)
        into v_result using v_owner,v_id,v_version;
      if v_result is null then raise exception using errcode='40001', message='workspace version conflict'; end if;
    end if;
  end loop;
  set constraints public.goals_graph_valid, public.tasks_graph_valid, public.projects_graph_valid, public.goal_links_graph_valid immediate;
  perform public.check_goal_graph(v_owner);
  return public.workspace_snapshot();
end;
$$;
revoke all on function public.workspace_snapshot() from public, anon;
revoke all on function public.workspace_commit(jsonb) from public, anon;
grant execute on function public.workspace_snapshot() to authenticated;
grant execute on function public.workspace_commit(jsonb) to authenticated;
