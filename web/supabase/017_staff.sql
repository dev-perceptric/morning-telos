-- Morning Telos migration 017: the staff console (the /staff page, src/app/api/staff, src/lib/staff.ts).
-- Run once in Supabase → SQL Editor, after 016_app_connections.sql. Safe to run again.
--
-- Staff are the people whose confirmed email is in the server's STAFF_EMAILS. The server checks that on every staff
-- route, then reads and changes things with the service role. Nothing here is for the API roles: RLS on, no policies,
-- no rights for anon or authenticated.
--
-- Every change staff make writes a row to staff_actions in the same transaction as the change, so the log can't miss
-- one: staff_set_plan, staff_extend_trial and staff_retry_job.

-- ─────────────── staff_actions ───────────────
-- Who on our team changed what, in which workspace, and when. A deleted workspace keeps its rows (workspace_id
-- becomes null), and so does a staff member who leaves (no link to auth.users), so the log is never lost.
create table if not exists public.staff_actions (
  id bigint generated always as identity primary key,
  staff_user_id uuid not null,
  staff_email text check (staff_email is null or char_length(staff_email) <= 200),
  workspace_id uuid references public.workspaces (id) on delete set null,
  action text not null check (action in ('set_plan', 'extend_trial', 'retry_job')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 10000),
  created_at timestamptz not null default now()
);
create index if not exists staff_actions_ws_idx on public.staff_actions (workspace_id, id desc);
alter table public.staff_actions enable row level security; -- no policies: server only
revoke all on public.staff_actions from anon, authenticated;
grant select, insert on public.staff_actions to service_role;

-- ─────────────── reading ───────────────
-- Every workspace (or just p_ws) with its owner's email, member count and AI spend since p_since (the start of the
-- month). The owner's email comes from the members table, or from the sign-in account when that is empty.
create or replace function public.staff_workspaces(p_since timestamptz, p_ws uuid default null)
returns table (
  id uuid, name text, website text, plan text, status text, trial_ends_at timestamptz, period_start timestamptz,
  stripe_subscription_id text, created_at timestamptz, owner_email text, members int, ai_usd numeric
)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, w.website, w.plan, w.status, w.trial_ends_at, w.period_start, w.stripe_subscription_id, w.created_at,
         (select coalesce(m.email, u.email) from public.workspace_members m left join auth.users u on u.id = m.user_id
           where m.workspace_id = w.id and m.role = 'owner' limit 1),
         (select count(*)::int from public.workspace_members m where m.workspace_id = w.id),
         (select coalesce(round(sum(a.cost_usd), 2), 0) from public.ai_usage a where a.workspace_id = w.id and a.created_at >= p_since)
    from public.workspaces w
   where p_ws is null or w.id = p_ws
   order by w.created_at desc, w.id
$$;
revoke execute on function public.staff_workspaces(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.staff_workspaces(timestamptz, uuid) to service_role;

-- All AI spend since p_since, deleted workspaces included, so it matches the Anthropic bill.
create or replace function public.staff_ai_total(p_since timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(round(sum(a.cost_usd), 2), 0) from public.ai_usage a where a.created_at >= p_since
$$;
revoke execute on function public.staff_ai_total(timestamptz) from public, anon, authenticated;
grant execute on function public.staff_ai_total(timestamptz) to service_role;

-- ─────────────── changes ───────────────
-- Set a workspace's plan and status (src/lib/staff.ts planPatch says which status goes with each plan). Returns the
-- plan and status before and after, or null when there is no such workspace.
create or replace function public.staff_set_plan(p_staff uuid, p_email text, p_ws uuid, p_plan text, p_status text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  old record;
  d jsonb;
begin
  select w.plan, w.status into old from public.workspaces w where w.id = p_ws for update;
  if not found then return null; end if;
  update public.workspaces set plan = p_plan, status = p_status where id = p_ws;
  d := jsonb_build_object('from', jsonb_build_object('plan', old.plan, 'status', old.status), 'to', jsonb_build_object('plan', p_plan, 'status', p_status));
  insert into public.staff_actions (staff_user_id, staff_email, workspace_id, action, details) values (p_staff, p_email, p_ws, 'set_plan', d);
  return d;
end;
$$;
revoke execute on function public.staff_set_plan(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_set_plan(uuid, text, uuid, text, text) to service_role;

-- Move the trial's end p_days later, counting from now when it already ended. 1 to 90 days. Returns the old and new
-- end, or null when there is no such workspace.
create or replace function public.staff_extend_trial(p_staff uuid, p_email text, p_ws uuid, p_days int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  old timestamptz;
  d jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'Extend a trial by 1 to 90 days.'; end if;
  select w.trial_ends_at into old from public.workspaces w where w.id = p_ws for update;
  if not found then return null; end if;
  update public.workspaces set trial_ends_at = greatest(old, now()) + make_interval(days => p_days) where id = p_ws;
  d := jsonb_build_object('days', p_days, 'from', old, 'to', greatest(old, now()) + make_interval(days => p_days));
  insert into public.staff_actions (staff_user_id, staff_email, workspace_id, action, details) values (p_staff, p_email, p_ws, 'extend_trial', d);
  return d;
end;
$$;
revoke execute on function public.staff_extend_trial(uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function public.staff_extend_trial(uuid, text, uuid, int) to service_role;

-- Run a job that gave up (attempts used up, not done) again now, the same as the manual fix in 006_jobs.sql. Only a
-- job in p_ws. Its last_error stays until the next try. Returns the job's kind and last error, or null when it is not
-- a failed job in that workspace.
create or replace function public.staff_retry_job(p_staff uuid, p_email text, p_ws uuid, p_job bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare
  j record;
  d jsonb;
begin
  update public.jobs set attempts = 0, run_at = now(), locked_until = null
   where id = p_job and workspace_id = p_ws and done_at is null and attempts >= max_attempts
  returning kind, last_error into j;
  if not found then return null; end if;
  d := jsonb_build_object('job', p_job, 'kind', j.kind, 'last_error', j.last_error);
  insert into public.staff_actions (staff_user_id, staff_email, workspace_id, action, details) values (p_staff, p_email, p_ws, 'retry_job', d);
  return d;
end;
$$;
revoke execute on function public.staff_retry_job(uuid, text, uuid, bigint) from public, anon, authenticated;
grant execute on function public.staff_retry_job(uuid, text, uuid, bigint) to service_role;
