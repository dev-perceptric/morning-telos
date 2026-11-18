-- Morning Telos migration 013: approvals and the activity log.
-- Run once in Supabase → SQL Editor, after 012_knowledge.sql. Safe to run again.
-- Ported from the old app's approvals and activity tables (app/lib/db.js).
--
-- An agent that wants to change something in Arrowsterr or Capybaroar (create posts, add to the content plan, ...)
-- saves an approval instead, unless the owner put that agent on autopilot. An editor approves or denies it in the app,
-- and approving runs it with the workspace's brand key (src/lib/productTools.ts, POST /api/approvals/:id).
--
-- Who can do what:
--   approvals  members read their workspace's approvals. Nobody writes them from the browser: the server saves them
--              (service role) and decides them through decide_approval(), which checks the person is an editor or
--              up in that workspace, and only ever moves a pending approval. Only the server saves the result
--              (finish_approval), so no one can mark a change done that never ran.
--   activity   members read. The server writes it.
--
-- The agent list matches src/lib/team.ts (ORDER), like 011_ai_team.sql. tests/team.test.ts fails when they drift.

-- ─────────────── approvals ───────────────
-- status: pending (waiting for a person), approved (decided, about to run), running (the call is running),
-- denied, done, failed. pending → running or denied happens once (decide_approval). running → done or failed is the
-- server's (finish_approval). A call that never finished (the server restarted) is failed by fail_stale_approvals().
create table if not exists public.approvals (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid,
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  product text not null check (product ~ '^[a-z][a-z0-9_]{0,39}$'),
  tool text not null check (char_length(tool) between 1 and 100),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 100000),
  title text not null check (char_length(title) between 1 and 200),
  why text not null default '' check (char_length(why) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'running', 'done', 'failed')),
  result text check (result is null or char_length(result) <= 25000),
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  finished_at timestamptz,
  -- The chat it came from, in the same workspace. Deleting the chat keeps the approval.
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete set null (thread_id),
  check ((status = 'pending') = (decided_at is null)),
  check ((status in ('done', 'failed')) = (finished_at is not null))
);
create index if not exists approvals_ws_status_idx on public.approvals (workspace_id, status, id desc);
create index if not exists approvals_thread_idx on public.approvals (thread_id) where thread_id is not null;
create index if not exists approvals_open_idx on public.approvals (decided_at) where status in ('approved', 'running');
alter table public.approvals enable row level security;
revoke all on public.approvals from anon, authenticated;
grant select on public.approvals to authenticated;

drop policy if exists "approvals read" on public.approvals;
create policy "approvals read" on public.approvals for select using (public.has_role(workspace_id, 'viewer'));

-- Approve (with the details that will run, maybe edited) or deny one pending approval, as p_by. Server only: the
-- route checks the signed-in person first, and this checks again that p_by is an editor or up in p_ws.
-- Returns the approval when this call moved it, and no row when it wasn't pending, isn't in p_ws, or p_by may not
-- decide. Two calls at the same time never both get it.
create or replace function public.decide_approval(p_id bigint, p_ws uuid, p_by uuid, p_action text, p_input jsonb default null)
returns setof public.approvals
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('approve', 'deny') then raise exception 'Pick approve or deny.'; end if;
  if p_input is not null and jsonb_typeof(p_input) <> 'object' then raise exception 'The details must be an object.'; end if;
  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_ws and m.user_id = p_by and public.role_rank(m.role) >= public.role_rank('editor')
  ) then return; end if;
  return query
    update public.approvals a
       set status = case when p_action = 'approve' then 'running' else 'denied' end,
           input = case when p_action = 'approve' and p_input is not null then p_input else a.input end,
           decided_by = p_by,
           decided_at = now()
     where a.id = p_id and a.workspace_id = p_ws and a.status = 'pending'
    returning a.*;
end $$;
revoke execute on function public.decide_approval(bigint, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.decide_approval(bigint, uuid, uuid, text, jsonb) to service_role;

-- Saves how an approved call went. Only from approved or running, only to done or failed. Server only.
create or replace function public.finish_approval(p_id bigint, p_ws uuid, p_status text, p_result text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_status not in ('done', 'failed') then raise exception 'An approval finishes as done or failed.'; end if;
  update public.approvals a
     set status = p_status, result = left(coalesce(p_result, ''), 25000), finished_at = now()
   where a.id = p_id and a.workspace_id = p_ws and a.status in ('approved', 'running');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.finish_approval(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_approval(bigint, uuid, text, text) to service_role;

-- A decided call that never finished (the server restarted or the call hung) is failed after p_older, so a person
-- checks before trying again. The worker calls it every minute. Returns how many it failed. Server only.
create or replace function public.fail_stale_approvals(p_older interval)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.approvals a
     set status = 'failed', finished_at = now(),
         result = 'This stopped before it finished, so we don''t know if it ran. Check before you try again.'
   where a.status in ('approved', 'running') and a.decided_at < now() - p_older;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fail_stale_approvals(interval) from public, anon, authenticated;
grant execute on function public.fail_stale_approvals(interval) to service_role;

-- ─────────────── activity ───────────────
-- One line per thing the team did that changed something or is waiting on a person: "prepared X for your approval",
-- "ran X on autopilot", "finished: X". The newest show on Home.
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text check (agent is null or agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  thread_id uuid,
  approval_id bigint references public.approvals (id) on delete set null,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete set null (thread_id)
);
create index if not exists activity_ws_idx on public.activity (workspace_id, id desc);
alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;
grant select on public.activity to authenticated;

drop policy if exists "activity read" on public.activity;
create policy "activity read" on public.activity for select using (public.has_role(workspace_id, 'viewer'));
