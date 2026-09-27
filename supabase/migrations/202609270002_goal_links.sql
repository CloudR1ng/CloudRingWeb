-- Schema extension for the calendar UI and weighted goal graph.
alter table public.tasks add column planned_at timestamptz;
alter table public.events add column category text not null default '개인생활'
  check (category in ('학업', '대회', '자기개발', '개인생활'));

create table public.goal_links (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  goal_id uuid not null,
  target_goal_id uuid,
  target_project_id uuid,
  target_task_id uuid,
  weight numeric(8,2) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id) on delete cascade,
  foreign key (owner_id, target_goal_id) references public.goals(owner_id, id) on delete cascade,
  foreign key (owner_id, target_project_id) references public.projects(owner_id, id) on delete cascade,
  foreign key (owner_id, target_task_id) references public.tasks(owner_id, id) on delete cascade,
  check (num_nonnulls(target_goal_id, target_project_id, target_task_id) = 1)
);

create unique index goal_links_goal_target_unique on public.goal_links(owner_id, goal_id, target_goal_id) where target_goal_id is not null;
create unique index goal_links_project_target_unique on public.goal_links(owner_id, goal_id, target_project_id) where target_project_id is not null;
create unique index goal_links_task_target_unique on public.goal_links(owner_id, goal_id, target_task_id) where target_task_id is not null;
alter table public.goal_links enable row level security;
revoke all on table public.goal_links from anon, authenticated;
grant select, insert, update, delete on table public.goal_links to authenticated;
create policy goal_links_owner_rows on public.goal_links for all to authenticated
  using (owner_id = (select auth.uid()) and exists (select 1 from public.owner_registry r where r.owner_id = (select auth.uid())))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.owner_registry r where r.owner_id = (select auth.uid())));
create policy goal_links_require_aal2 on public.goal_links as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create trigger goal_links_touch_version before update on public.goal_links
  for each row execute function public.touch_updated_at_version();

-- Serialize every mutation that can affect the graph for a given owner. The lock
-- lives until transaction end, so a concurrent edge or parent edit sees committed state.
create table public.goal_graph_locks (
  owner_id uuid primary key references public.owner_registry(owner_id) on delete cascade
);
revoke all on table public.goal_graph_locks from public, anon, authenticated;

create function public.lock_goal_graph_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if tg_op = 'DELETE' then v_owner := old.owner_id; else v_owner := new.owner_id; end if;
  if v_owner is null or v_owner is distinct from (select auth.uid())
    or not exists (select 1 from public.owner_registry r where r.owner_id=v_owner) then
    raise exception using errcode = '42501', message = 'owner mismatch';
  end if;
  insert into public.goal_graph_locks(owner_id) values (v_owner) on conflict (owner_id) do nothing;
  perform 1 from public.goal_graph_locks where owner_id = v_owner for update;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create function public.check_goal_graph(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null or p_owner is distinct from (select auth.uid())
    or (select auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (select 1 from public.owner_registry r where r.owner_id=p_owner) then
    raise exception using errcode = '42501', message = 'goal graph access denied';
  end if;

  -- Parent hierarchy and explicit aggregation links are independent graphs.
  -- Parent cycles are rejected without treating a valid parent->child link as a cycle.
  if exists (
    with recursive ancestry(start_id, node_id, path, cycle) as (
      select g.id, g.parent_goal_id, array[g.id, g.parent_goal_id]::uuid[], g.id = g.parent_goal_id
      from public.goals g where g.owner_id=p_owner and g.parent_goal_id is not null
      union all
      select a.start_id, g.parent_goal_id, a.path || g.parent_goal_id, g.parent_goal_id = any(a.path)
      from ancestry a join public.goals g on g.owner_id=p_owner and g.id=a.node_id
      where g.parent_goal_id is not null and not a.cycle
    ) select 1 from ancestry where cycle
  ) then
    raise exception using errcode = '23514', message = 'goal parent cycle';
  end if;

  if exists (
    with recursive links(start_id, node_id, path, cycle) as (
      select l.goal_id, l.target_goal_id, array[l.goal_id,l.target_goal_id]::uuid[], l.goal_id=l.target_goal_id
      from public.goal_links l where l.owner_id=p_owner and l.target_goal_id is not null
      union all
      select w.start_id, l.target_goal_id, w.path || l.target_goal_id, l.target_goal_id=any(w.path)
      from links w join public.goal_links l on l.owner_id=p_owner and l.goal_id=w.node_id
      where l.target_goal_id is not null and not w.cycle
    ) select 1 from links where cycle
  ) then
    raise exception using errcode = '23514', message = 'goal aggregation cycle';
  end if;

  -- A goal must fit entirely inside its parent's date period; this also validates
  -- descendants when an existing parent period is shortened.
  if exists (
    select 1 from public.goals child join public.goals parent
      on parent.owner_id = child.owner_id and parent.id = child.parent_goal_id
    where child.owner_id = p_owner and (child.starts_on < parent.starts_on or child.ends_on > parent.ends_on)
  ) then
    raise exception using errcode = '23514', message = 'child goal period outside parent';
  end if;

  -- Expand only explicit goal_links. Project targets include all structurally
  -- related tasks regardless of completion status; manual/target-value goals stop.
  if exists (
    with recursive contributions(root_goal, root_link, target_kind, target_id, path) as (
      select l.goal_id, l.id,
        case when l.target_goal_id is not null then 'goal' when l.target_project_id is not null then 'project' else 'task' end,
        coalesce(l.target_goal_id,l.target_project_id,l.target_task_id),
        array['goal:'||l.goal_id::text,
          (case when l.target_goal_id is not null then 'goal:'||l.target_goal_id::text when l.target_project_id is not null then 'project:'||l.target_project_id::text else 'task:'||l.target_task_id::text end)]::text[]
      from public.goal_links l join public.goals root_goal on root_goal.owner_id=l.owner_id and root_goal.id=l.goal_id
      where l.owner_id=p_owner and root_goal.progress_mode='task_weighted'
      union all
      select c.root_goal, c.root_link, expanded.target_kind, expanded.target_id, c.path || expanded.target_key
      from contributions c
      cross join lateral (
        select case when l.target_goal_id is not null then 'goal' when l.target_project_id is not null then 'project' else 'task' end as target_kind,
          coalesce(l.target_goal_id,l.target_project_id,l.target_task_id) as target_id,
          case when l.target_goal_id is not null then 'goal:'||l.target_goal_id::text when l.target_project_id is not null then 'project:'||l.target_project_id::text else 'task:'||l.target_task_id::text end as target_key
        from public.goal_links l join public.goals parent_goal on parent_goal.owner_id=l.owner_id and parent_goal.id=l.goal_id
        where l.owner_id=p_owner and c.target_kind='goal' and c.target_id=l.goal_id and parent_goal.progress_mode='task_weighted'
        union all
        select 'task', t.id, 'task:'||t.id::text from public.tasks t where c.target_kind='project' and t.owner_id=p_owner and t.project_id=c.target_id
      ) expanded
      where not expanded.target_key=any(c.path)
    )
    select 1 from contributions group by root_goal, target_kind, target_id having count(distinct root_link)>1
  ) then
    raise exception using errcode = '23514', message = 'goal contribution counted more than once';
  end if;
end;
$$;

create function public.validate_goal_graph_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  v_owner := coalesce(new.owner_id, old.owner_id);
  perform public.check_goal_graph(v_owner);
  return null;
end;
$$;

revoke all on function public.lock_goal_graph_owner() from public, anon, authenticated;
revoke all on function public.check_goal_graph(uuid) from public, anon, authenticated;
revoke all on function public.validate_goal_graph_trigger() from public, anon, authenticated;

create trigger goals_graph_lock before insert or update or delete on public.goals
  for each row execute function public.lock_goal_graph_owner();
create trigger tasks_graph_lock before insert or update or delete on public.tasks
  for each row execute function public.lock_goal_graph_owner();
create trigger projects_graph_lock before insert or update or delete on public.projects
  for each row execute function public.lock_goal_graph_owner();
create trigger goal_links_graph_lock before insert or update or delete on public.goal_links
  for each row execute function public.lock_goal_graph_owner();

create constraint trigger goals_graph_valid after insert or update or delete on public.goals
  deferrable initially immediate for each row execute function public.validate_goal_graph_trigger();
create constraint trigger tasks_graph_valid after insert or update or delete on public.tasks
  deferrable initially immediate for each row execute function public.validate_goal_graph_trigger();
create constraint trigger projects_graph_valid after insert or update or delete on public.projects
  deferrable initially immediate for each row execute function public.validate_goal_graph_trigger();
create constraint trigger goal_links_graph_valid after insert or update or delete on public.goal_links
  deferrable initially immediate for each row execute function public.validate_goal_graph_trigger();

grant execute on function public.lock_goal_graph_owner() to authenticated;
grant execute on function public.validate_goal_graph_trigger() to authenticated;
