-- Owner onboarding is an operator action. Do not add client INSERT/UPDATE/DELETE policies here.
create table public.owner_registry (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.owner_registry enable row level security;
revoke all on table public.owner_registry from anon, authenticated;
grant select on table public.owner_registry to authenticated;
create policy owner_registry_read_self
  on public.owner_registry for select to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create table public.projects (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  overview text not null default '',
  category text not null check (category in ('학업', '대회', '자기개발', '개인생활')),
  tools text[] not null default '{}',
  devices text[] not null default '{}',
  collaborators text[] not null default '{}',
  status text not null default 'active' check (status in ('planned', 'active', 'paused', 'completed', 'archived')),
  progress_mode text not null default 'task_weighted' check (progress_mode in ('task_weighted', 'manual')),
  manual_progress smallint check (manual_progress between 0 and 100),
  starts_on date,
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  check (starts_on is null or due_on is null or starts_on <= due_on),
  check ((progress_mode = 'manual' and manual_progress is not null) or (progress_mode = 'task_weighted' and manual_progress is null))
);

create table public.goals (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  parent_goal_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  period_type text not null check (period_type in ('day', 'week', 'month', 'quarter', 'half_year', 'year', 'custom')),
  starts_on date not null,
  ends_on date not null,
  progress_mode text not null default 'task_weighted' check (progress_mode in ('task_weighted', 'manual', 'target_value')),
  manual_progress smallint check (manual_progress between 0 and 100),
  current_value numeric(14,3),
  target_value numeric(14,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  foreign key (owner_id, parent_goal_id) references public.goals(owner_id, id) on delete set null (parent_goal_id),
  check (starts_on <= ends_on),
  check (parent_goal_id is null or parent_goal_id <> id),
  check ((progress_mode = 'manual' and manual_progress is not null and current_value is null and target_value is null)
      or (progress_mode = 'target_value' and manual_progress is null and current_value is not null and current_value >= 0 and target_value is not null and target_value > 0)
      or (progress_mode = 'task_weighted' and manual_progress is null and current_value is null and target_value is null))
);

create table public.tasks (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  project_id uuid,
  title text not null check (length(btrim(title)) between 1 and 300),
  category text not null check (category in ('학업', '대회', '자기개발', '개인생활')),
  planned_on date,
  due_on date,
  due_at timestamptz,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'paused', 'completed', 'cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  weight numeric(8,2) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id) on delete set null (project_id),
  check (due_on is null or due_at is null),
  check ((status = 'completed' and progress = 100) or (status <> 'completed' and progress < 100))
);

create table public.events (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references public.owner_registry(owner_id) on delete cascade,
  project_id uuid,
  title text not null check (length(btrim(title)) between 1 and 300),
  all_day boolean not null default false,
  event_on date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Seoul',
  location text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (owner_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id) on delete set null (project_id),
  check (
    (all_day and event_on is not null and starts_at is null and ends_at is null)
    or (not all_day and event_on is null and starts_at is not null and ends_at is not null and starts_at < ends_at)
  )
);

-- Explicit grants are paired with RLS; public schema defaults must not grant anonymous access.
revoke all on table public.projects, public.goals, public.tasks, public.events from anon, authenticated;
grant select, insert, update, delete on table public.projects, public.goals, public.tasks, public.events to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['projects', 'goals', 'tasks', 'events'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy owner_rows on public.%I for all to authenticated using (owner_id = (select auth.uid()) and exists (select 1 from public.owner_registry r where r.owner_id = (select auth.uid()))) with check (owner_id = (select auth.uid()) and exists (select 1 from public.owner_registry r where r.owner_id = (select auth.uid())))',
      table_name
    );
    execute format(
      'create policy require_aal2 on public.%I as restrictive for all to authenticated using ((select auth.jwt() ->> ''aal'') = ''aal2'') with check ((select auth.jwt() ->> ''aal'') = ''aal2'')',
      table_name
    );
  end loop;
end $$;

-- Clients should include the previously read version in UPDATE filters. This trigger
-- advances both fields so clients can detect stale writes and show the latest row.
create function public.touch_updated_at_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  new.version := old.version + 1;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['projects', 'goals', 'tasks', 'events'] loop
    execute format('create trigger touch_updated_at_version before update on public.%I for each row execute function public.touch_updated_at_version()', table_name);
  end loop;
end $$;
