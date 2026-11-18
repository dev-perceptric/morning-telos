-- Morning Telos migration 014: routines, skills and memory for the AI team.
-- Run once in Supabase → SQL Editor, after 012_knowledge.sql (and 013 when it is there). Safe to run again.
-- Routines are ported from the old app (app/lib/db.js routines, the tick() scheduler in app/server.js). Skills are
-- copied from Omniscient's 123_skills.sql, with only the Workspace scope (System skills ship as files in
-- web/src/skills). Memory is new: neither product has it.
--
-- Who can do what:
--   routines   members read. Editors and up add, change, pause and delete. Up to 25 per workspace. The server
--              writes last_run_at, last_note and last_thread_id when one runs.
--   skills     members read. Admins and the owner add, change and delete. Up to 100 per workspace.
--   memories   members read and delete. Only the server writes them (the remember tool). Up to 200 per workspace.
--
-- The worker (POST /api/worker) calls queue_routine_runs() every minute. It reads due_routines(now()) and queues one
-- run_routine job per routine and scheduled minute. A unique index on those jobs means a routine runs once for each
-- scheduled minute, even when two worker ticks run at the same moment.
--
-- The agent lists below match src/lib/team.ts (ORDER). tests/team.test.ts fails when they drift.

-- ─────────────── routines ───────────────
-- days: 0 Sunday to 6 Saturday, in the workspace's time zone. at_time: 'HH:MM' on a 24 hour clock, also local.
-- last_note: why the last scheduled run was skipped (a paused teammate, the AI allowance), or null.
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 4000),
  days int[] not null default '{1,2,3,4,5}' check (cardinality(days) between 1 and 7 and days <@ array[0, 1, 2, 3, 4, 5, 6]),
  at_time text not null default '08:00' check (at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_note text check (last_note is null or char_length(last_note) <= 300),
  last_thread_id uuid references public.threads (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routines_ws_idx on public.routines (workspace_id, created_at);
create index if not exists routines_enabled_idx on public.routines (workspace_id) where enabled;
alter table public.routines enable row level security;
revoke all on public.routines from anon, authenticated;
grant select, delete on public.routines to authenticated;
grant insert (workspace_id, agent, title, instruction, days, at_time, enabled) on public.routines to authenticated;
grant update (agent, title, instruction, days, at_time, enabled) on public.routines to authenticated;

drop policy if exists "routines read" on public.routines;
drop policy if exists "routines add" on public.routines;
drop policy if exists "routines change" on public.routines;
drop policy if exists "routines delete" on public.routines;
create policy "routines read" on public.routines for select using (public.has_role(workspace_id, 'viewer'));
create policy "routines add" on public.routines for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
create policy "routines change" on public.routines for update
  using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "routines delete" on public.routines for delete using (public.has_role(workspace_id, 'editor'));

-- updated_at follows a change to the schedule, the words or the switch (not the server's run marks). A routine
-- only runs for a scheduled minute after its last change, so turning one on at 8:05 doesn't run the 8:00 slot.
create or replace function public.routines_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.routines_touch() from public, anon, authenticated;
drop trigger if exists routines_touch on public.routines;
create trigger routines_touch before update of agent, title, instruction, days, at_time, enabled on public.routines
  for each row execute function public.routines_touch();

-- At most 25 routines per workspace (the old app's limit).
create or replace function public.routines_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.routines r where r.workspace_id = new.workspace_id) >= 25 then
    raise exception 'You can have up to 25 routines. Delete one to add another.';
  end if;
  return new;
end;
$$;
revoke execute on function public.routines_limit() from public, anon, authenticated;
drop trigger if exists routines_limit on public.routines;
create trigger routines_limit before insert on public.routines for each row execute function public.routines_limit();

-- ─────────────── which routines are due (server only) ───────────────
-- Each routine's scheduled minute today and yesterday in its workspace's time zone, kept when it is in the last
-- 10 minutes, on one of its days, after its last change, and it hasn't run since. The 10 minutes let a late worker
-- tick still run it. A time a clock change skips (2:30 on the spring morning) runs at the same instant Postgres
-- gives that local time; a time that happens twice (1:30 on the fall morning) runs once. A workspace with an
-- unknown time zone counts as America/Chicago (the default), so one bad row never stops the others.
create or replace function public.due_routines(p_now timestamptz default now())
returns table (routine_id uuid, workspace_id uuid, slot timestamptz)
language sql stable set search_path = '' as $$
  select r.id, r.workspace_id, s.slot
    from public.routines r
    join public.workspaces w on w.id = r.workspace_id
    cross join lateral (
      select coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = w.timezone limit 1), 'America/Chicago') as tz
    ) zone
    cross join lateral (
      select d.day, ((d.day + r.at_time::time) at time zone zone.tz) as slot
        from (values ((p_now at time zone zone.tz)::date), ((p_now at time zone zone.tz)::date - 1)) d (day)
    ) s
   where r.enabled
     and extract(dow from s.day)::int = any (r.days)
     and s.slot <= p_now
     and s.slot > p_now - interval '10 minutes'
     and r.updated_at <= s.slot
     and (r.last_run_at is null or r.last_run_at < s.slot)
   order by s.slot, r.id
$$;
revoke execute on function public.due_routines(timestamptz) from public, anon, authenticated;
grant execute on function public.due_routines(timestamptz) to service_role;

-- One run_routine job per routine and scheduled minute, ever.
create unique index if not exists jobs_routine_run_idx on public.jobs ((payload ->> 'routine'), (payload ->> 'slot')) where kind = 'run_routine';

-- Queues a run_routine job for each due routine and marks it as run for that minute. Returns how many it queued.
-- A second call for the same minute queues nothing. max_attempts 1: a turn is never run twice on its own, since it
-- may already have saved work for approval. The job (src/lib/routinesServer.ts) checks the AI allowance and paused
-- teammates before it starts.
create or replace function public.queue_routine_runs(p_now timestamptz default now()) returns int
language sql set search_path = '' as $$
  with added as (
    insert into public.jobs (kind, workspace_id, payload, max_attempts)
    select 'run_routine', d.workspace_id,
           jsonb_build_object('routine', d.routine_id, 'slot', to_char(d.slot at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 1
      from public.due_routines(p_now) d
    on conflict do nothing
    returning (payload ->> 'routine')::uuid as id, (payload ->> 'slot')::timestamptz as slot
  ),
  marked as (
    update public.routines r set last_run_at = a.slot from added a where r.id = a.id returning r.id
  )
  select count(*)::int from added;
$$;
revoke execute on function public.queue_routine_runs(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_routine_runs(timestamptz) to service_role;

-- ─────────────── skills ───────────────
-- The workspace's own playbooks. agent null: for every teammate. name: lowercase words joined by dashes, unique for
-- each teammate (a skill for everyone counts as its own teammate). A Workspace skill with the same name as a System
-- skill takes its place for that teammate (src/lib/skills.ts skillsFor).
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text check (agent is null or agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(name) <= 64),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists skills_name_idx on public.skills (workspace_id, coalesce(agent, '*'), name);
alter table public.skills enable row level security;
revoke all on public.skills from anon, authenticated;
grant select, delete on public.skills to authenticated;
grant insert (workspace_id, agent, name, description, body) on public.skills to authenticated;
grant update (agent, name, description, body) on public.skills to authenticated;

drop policy if exists "skills read" on public.skills;
drop policy if exists "skills add" on public.skills;
drop policy if exists "skills change" on public.skills;
drop policy if exists "skills delete" on public.skills;
create policy "skills read" on public.skills for select using (public.has_role(workspace_id, 'viewer'));
create policy "skills add" on public.skills for insert
  with check (public.has_role(workspace_id, 'admin') and created_by = auth.uid());
create policy "skills change" on public.skills for update
  using (public.has_role(workspace_id, 'admin')) with check (public.has_role(workspace_id, 'admin'));
create policy "skills delete" on public.skills for delete using (public.has_role(workspace_id, 'admin'));

drop trigger if exists skills_touch on public.skills;
create trigger skills_touch before update on public.skills for each row execute function public.knowledge_touch();

create or replace function public.skills_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.skills s where s.workspace_id = new.workspace_id) >= 100 then
    raise exception 'You can have up to 100 skills. Delete one to add another.';
  end if;
  return new;
end;
$$;
revoke execute on function public.skills_limit() from public, anon, authenticated;
drop trigger if exists skills_limit on public.skills;
create trigger skills_limit before insert on public.skills for each row execute function public.skills_limit();

-- ─────────────── memories ───────────────
-- Short facts about the business the team learned in chats (the remember tool), with the chat they came from.
-- agent null: for every teammate. fact_key is the fact in lowercase letters and numbers only, so the same fact
-- written twice is saved once. The server checks for secrets before saving (src/lib/memory.ts looksSecret).
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text check (agent is null or agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  fact text not null check (char_length(btrim(fact)) between 1 and 500),
  fact_key text generated always as (btrim(regexp_replace(lower(fact), '[^a-z0-9]+', ' ', 'g'))) stored,
  thread_id uuid references public.threads (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists memories_fact_idx on public.memories (workspace_id, fact_key);
create index if not exists memories_ws_idx on public.memories (workspace_id, created_at desc);
alter table public.memories enable row level security;
revoke all on public.memories from anon, authenticated;
grant select, delete on public.memories to authenticated;

drop policy if exists "memories read" on public.memories;
drop policy if exists "memories delete" on public.memories;
create policy "memories read" on public.memories for select using (public.has_role(workspace_id, 'viewer'));
create policy "memories delete" on public.memories for delete using (public.has_role(workspace_id, 'viewer'));

create or replace function public.memories_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.memories m where m.workspace_id = new.workspace_id) >= 200 then
    raise exception 'Memory is full. Delete some facts on the Memory page to save new ones.';
  end if;
  return new;
end;
$$;
revoke execute on function public.memories_limit() from public, anon, authenticated;
drop trigger if exists memories_limit on public.memories;
create trigger memories_limit before insert on public.memories for each row execute function public.memories_limit();
