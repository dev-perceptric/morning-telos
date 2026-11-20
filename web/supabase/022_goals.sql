-- Morning Telos migration 022: goals the team works toward, the steps of their plans, and the Monday check-in.
-- Run once in Supabase → SQL Editor, after 021_brand.sql. Safe to run again.
--
-- A teammate proposes a goal with a goal card (set_goal, src/lib/cardTools.ts). The person changes the number or the
-- date and taps Start: the browser saves the goal as them. A plan card (set_plan) works the same way with Go and
-- saves its steps. Teammates move the steps (update_step) and record the number (log_progress) through the server.
-- The number comes from real data where a product gives it (followers, reach, AI visibility), else the teammate
-- logs it (src/lib/goals.ts).
--
-- Who can do what:
--   goals       members read. Editors and up start, change (the words, number, date and status) and delete goals.
--               The number, its starting point, its history and when it was checked come from the server only.
--   goal_steps  members read. Editors and up add steps (Go on a plan card) and delete them. Only the server moves
--               a step to running or done.
--
-- Every Monday from 9:00 in the workspace's time zone the worker (POST /api/worker) calls queue_goal_checkins(): one
-- goal_checkin job per active goal and week. The job (src/lib/goalsServer.ts) has the goal's owner post a check-in
-- in the goal's chat: the number, what was done, the one change. Metered like every other AI call.
--
-- The agent lists below match src/lib/team.ts (ORDER). tests/team.test.ts fails when they drift.

-- ─────────────── goals ───────────────
-- metric: followers or reach (read from the social results), ai_visibility (from the SEO data), other (logged).
-- title: the words before the number ("Grow LinkedIn by"). card_id: the goal card it was started from, once.
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  card_id text not null check (card_id ~ '^c_[a-z0-9]{8,32}$'),
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  metric text not null default 'other' check (metric in ('followers', 'reach', 'ai_visibility', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  target double precision not null check (target > 0 and target <= 1000000000),
  unit text not null check (char_length(btrim(unit)) between 1 and 30),
  due_date date not null,
  status text not null default 'active' check (status in ('active', 'done', 'stopped')),
  current double precision not null default 0 check (current between -1000000000 and 1000000000),
  baseline double precision,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 200),
  checked_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete cascade,
  unique (workspace_id, card_id),
  -- So a step can point at (goal, workspace) and never at another workspace's goal.
  unique (id, workspace_id)
);
create index if not exists goals_ws_idx on public.goals (workspace_id, status, created_at desc);
create index if not exists goals_thread_idx on public.goals (thread_id);
alter table public.goals enable row level security;
revoke all on public.goals from anon, authenticated;
grant select, delete on public.goals to authenticated;
grant insert (workspace_id, thread_id, card_id, agent, metric, title, target, unit, due_date) on public.goals to authenticated;
grant update (title, target, unit, due_date, status) on public.goals to authenticated;
grant select, insert, update, delete on public.goals to service_role;

drop policy if exists "goals read" on public.goals;
drop policy if exists "goals start" on public.goals;
drop policy if exists "goals change" on public.goals;
drop policy if exists "goals delete" on public.goals;
create policy "goals read" on public.goals for select using (public.has_role(workspace_id, 'viewer'));
create policy "goals start" on public.goals for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
create policy "goals change" on public.goals for update
  using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "goals delete" on public.goals for delete using (public.has_role(workspace_id, 'editor'));

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals for each row execute function public.knowledge_touch();

-- At most 100 goals per workspace.
create or replace function public.goals_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.goals g where g.workspace_id = new.workspace_id) >= 100 then
    raise exception 'You can have up to 100 goals. Delete one to add another.';
  end if;
  return new;
end;
$$;
revoke execute on function public.goals_limit() from public, anon, authenticated;
drop trigger if exists goals_limit on public.goals;
create trigger goals_limit before insert on public.goals for each row execute function public.goals_limit();

-- ─────────────── goal_steps ───────────────
-- plan_id: the plan card the steps were started from. position: the step's number in the plan the person kept.
create table if not exists public.goal_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  goal_id uuid,
  plan_id text not null check (plan_id ~ '^c_[a-z0-9]{8,32}$'),
  position int not null check (position between 1 and 8),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  status text not null default 'todo' check (status in ('todo', 'running', 'done')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete cascade,
  foreign key (goal_id, workspace_id) references public.goals (id, workspace_id) on delete cascade,
  unique (workspace_id, plan_id, position)
);
create index if not exists goal_steps_thread_idx on public.goal_steps (thread_id, created_at desc);
create index if not exists goal_steps_goal_idx on public.goal_steps (goal_id);
alter table public.goal_steps enable row level security;
revoke all on public.goal_steps from anon, authenticated;
grant select, delete on public.goal_steps to authenticated;
grant insert (workspace_id, thread_id, goal_id, plan_id, position, title, agent) on public.goal_steps to authenticated;
grant select, insert, update, delete on public.goal_steps to service_role;

drop policy if exists "goal steps read" on public.goal_steps;
drop policy if exists "goal steps add" on public.goal_steps;
drop policy if exists "goal steps delete" on public.goal_steps;
create policy "goal steps read" on public.goal_steps for select using (public.has_role(workspace_id, 'viewer'));
create policy "goal steps add" on public.goal_steps for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
create policy "goal steps delete" on public.goal_steps for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── the Monday check-in (server only) ───────────────
-- Active goals whose workspace it is Monday, 9:00 or later, made at least a day ago, and not more than a week past
-- their due date. week: that Monday's date, so each goal gets one check-in a week. An unknown time zone counts as
-- America/Chicago (the default), like due_routines().
create or replace function public.due_goal_checkins(p_now timestamptz default now())
returns table (goal_id uuid, workspace_id uuid, week text)
language sql stable set search_path = '' as $$
  select g.id, g.workspace_id, to_char(l.local, 'YYYY-MM-DD')
    from public.goals g
    join public.workspaces w on w.id = g.workspace_id
    cross join lateral (
      select coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = w.timezone limit 1), 'America/Chicago') as tz
    ) zone
    cross join lateral (select (p_now at time zone zone.tz) as local) l
   where g.status = 'active'
     and extract(isodow from l.local) = 1
     and l.local::time >= time '09:00'
     and g.created_at <= p_now - interval '1 day'
     and g.due_date >= l.local::date - 7
   order by g.created_at, g.id
$$;
revoke execute on function public.due_goal_checkins(timestamptz) from public, anon, authenticated;
grant execute on function public.due_goal_checkins(timestamptz) to service_role;

-- One goal_checkin job per goal and week, ever.
create unique index if not exists jobs_goal_checkin_idx on public.jobs ((payload ->> 'goal'), (payload ->> 'week')) where kind = 'goal_checkin';

-- Queues the check-ins that are due. Returns how many it queued; a second call the same Monday queues nothing.
-- max_attempts 1: a turn is never run twice on its own, since it may already have saved work for approval.
create or replace function public.queue_goal_checkins(p_now timestamptz default now()) returns int
language sql set search_path = '' as $$
  with added as (
    insert into public.jobs (kind, workspace_id, payload, max_attempts)
    select 'goal_checkin', d.workspace_id, jsonb_build_object('goal', d.goal_id, 'week', d.week), 1
      from public.due_goal_checkins(p_now) d
    on conflict do nothing
    returning 1
  )
  select count(*)::int from added;
$$;
revoke execute on function public.queue_goal_checkins(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_goal_checkins(timestamptz) to service_role;
