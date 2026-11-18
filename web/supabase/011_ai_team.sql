-- Morning Telos migration 011: the AI team. Chats with agents, each agent's settings, and the AI meter.
-- Run once in Supabase → SQL Editor, after 010_expire_trials.sql. Safe to run again.
-- Ported from the old app's threads, messages, agent_prefs and usage tables (app/), with Arrowsterr's
-- cost_by_workspace view (015_billing.sql) for staff.
--
-- Who can do what:
--   threads, messages  members read their workspace's chats. Editors and up start, rename and delete chats and
--                      write their own messages. Agent replies and handoff notes come from the server (POST /api/chat).
--   agent_prefs        members read, admins and the owner change.
--   ai_usage           server only. Every Claude call's tokens and dollars, read for the AI allowance check.
--   cost_by_workspace  server only. Staff read it in the SQL Editor for margin per customer per month.
--
-- The agent and model lists below match src/lib/team.ts (ORDER) and src/lib/models.ts (MODEL_CHOICES).
-- tests/team.test.ts fails when they drift.

-- ─────────────── threads ───────────────
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- So messages can point at (thread, workspace) and never sit in another workspace's thread.
  unique (id, workspace_id)
);
create index if not exists threads_ws_updated_idx on public.threads (workspace_id, updated_at desc);
alter table public.threads enable row level security;
revoke all on public.threads from anon, authenticated;
grant select, insert, delete on public.threads to authenticated;
grant update (title) on public.threads to authenticated;

drop policy if exists "threads read" on public.threads;
create policy "threads read" on public.threads for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "threads start" on public.threads;
create policy "threads start" on public.threads for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
drop policy if exists "threads rename" on public.threads;
create policy "threads rename" on public.threads for update
  using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
drop policy if exists "threads delete" on public.threads;
create policy "threads delete" on public.threads for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── messages ───────────────
-- role: user (a person), agent (a teammate's reply, or a limit or error message), note (a handoff).
-- meta: who wrote it ({"user": email}), {"to": agent} on a handoff, {"error": true}, {"blocked": reason}, ...
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null,
  workspace_id uuid not null,
  role text not null check (role in ('user', 'agent', 'note')),
  agent text check (agent is null or agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  content text not null check (char_length(content) <= 40000),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete cascade,
  check ((role = 'user') = (agent is null))
);
create index if not exists messages_thread_idx on public.messages (thread_id, id);
create index if not exists messages_ws_idx on public.messages (workspace_id, created_at desc);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select using (public.has_role(workspace_id, 'viewer'));
-- Editors write only their own words. A reply that looks like it came from an agent can only come from the server.
drop policy if exists "messages write" on public.messages;
create policy "messages write" on public.messages for insert
  with check (public.has_role(workspace_id, 'editor') and role = 'user');

-- ─────────────── agent_prefs ───────────────
-- trust: 0 every change waits for approval, 1 reserved (big changes only, later), 2 autopilot.
-- model: auto, opus, sonnet or haiku (src/lib/models.ts says which Claude model each runs).
create table if not exists public.agent_prefs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  enabled boolean not null default true,
  trust smallint not null default 0 check (trust in (0, 1, 2)),
  model text not null default 'auto' check (model in ('auto', 'opus', 'sonnet', 'haiku')),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, agent)
);
alter table public.agent_prefs enable row level security;
revoke all on public.agent_prefs from anon, authenticated;
grant select, insert, update, delete on public.agent_prefs to authenticated;

drop policy if exists "agent prefs read" on public.agent_prefs;
create policy "agent prefs read" on public.agent_prefs for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "agent prefs add" on public.agent_prefs;
create policy "agent prefs add" on public.agent_prefs for insert with check (public.has_role(workspace_id, 'admin'));
drop policy if exists "agent prefs change" on public.agent_prefs;
create policy "agent prefs change" on public.agent_prefs for update
  using (public.has_role(workspace_id, 'admin')) with check (public.has_role(workspace_id, 'admin'));
drop policy if exists "agent prefs reset" on public.agent_prefs;
create policy "agent prefs reset" on public.agent_prefs for delete using (public.has_role(workspace_id, 'admin'));

-- ─────────────── ai_usage ───────────────
-- One row per Claude call. cost_usd comes from src/lib/meter.ts. A deleted workspace's rows stay with no
-- workspace, so the totals still match the Anthropic bill.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  thread_id uuid references public.threads (id) on delete set null,
  agent text check (agent is null or agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cache_read_tokens int not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens int not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_ws_at_idx on public.ai_usage (workspace_id, created_at desc);
alter table public.ai_usage enable row level security; -- no policies: server only
revoke all on public.ai_usage from anon, authenticated;

-- US dollars of AI a workspace spent since a time. The chat route calls it before each turn (src/lib/meter.ts says
-- from when). Server only.
create or replace function public.ai_spend(p_ws uuid, p_since timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(u.cost_usd), 0) from public.ai_usage u where u.workspace_id = p_ws and u.created_at >= p_since
$$;
revoke execute on function public.ai_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend(uuid, timestamptz) to service_role;

-- ─────────────── cost_by_workspace ───────────────
-- AI cost per workspace per month, next to its plan in force. Read it in the SQL Editor for margin per customer.
-- Rows of deleted workspaces show with no name.
drop view if exists public.cost_by_workspace;
create view public.cost_by_workspace with (security_invoker = true) as
  select u.workspace_id, w.name, public.effective_plan(w.plan, w.status, w.trial_ends_at) as plan,
         date_trunc('month', u.created_at)::date as month,
         round(sum(u.cost_usd), 2) as cost_usd, count(*) as calls,
         sum(u.input_tokens)::bigint as input_tokens, sum(u.output_tokens)::bigint as output_tokens,
         sum(u.cache_read_tokens)::bigint as cache_read_tokens, sum(u.cache_write_tokens)::bigint as cache_write_tokens
    from public.ai_usage u left join public.workspaces w on w.id = u.workspace_id
   group by u.workspace_id, w.name, w.plan, w.status, w.trial_ends_at, date_trunc('month', u.created_at);
revoke all on public.cost_by_workspace from anon, authenticated;
