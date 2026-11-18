-- Morning Telos migration 010: closing the brands of a free trial that ended without a plan.
-- Run once in Supabase → SQL Editor, after 009_website_gate.sql. Safe to run again.
--
-- Stripe sends nothing when a trial ends and the customer never subscribed, so the billing webhook's close never runs.
-- Once a UTC day the worker (POST /api/worker) queues one expire_trials job with queue_daily_jobs(). The job reads
-- expired_workspaces() and closes each one the same way a canceled subscription is closed (src/lib/closeout.ts):
-- keys revoked now, services removing, remove_brand in 30 days. Subscribing later reopens them, as before.
--
-- Everything here is server only: no rights for the API roles.

-- ─────────────── one daily job per kind and UTC day ───────────────
-- A daily job carries its day in its payload ({"day": "2026-11-18"}). The index makes a second one for the same day
-- impossible, even when two worker ticks run at once.
create unique index if not exists jobs_daily_idx on public.jobs (kind, (payload ->> 'day')) where payload ? 'day';

-- Queues today's daily jobs if they aren't there yet. Returns how many it queued (0 on every call after the first).
-- The not exists check keeps the common case from spending an id; on conflict covers two calls at the same moment.
create or replace function public.queue_daily_jobs() returns int
language sql set search_path = '' as $$
  with today (day) as (select to_char(now() at time zone 'utc', 'YYYY-MM-DD')),
  added as (
    insert into public.jobs (kind, payload, max_attempts)
    select k.kind, jsonb_build_object('day', t.day), 20
      from today t cross join (values ('expire_trials')) k (kind)
     where not exists (select 1 from public.jobs j where j.kind = k.kind and j.payload ? 'day' and j.payload ->> 'day' = t.day)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from added;
$$;
revoke execute on function public.queue_daily_jobs() from public, anon, authenticated;
grant execute on function public.queue_daily_jobs() to service_role;

-- ─────────────── which workspaces to close ───────────────
-- Workspaces whose plan in force is expired (the trial ended and no subscription pays) that still have a service
-- that isn't closed. Already removing or removed ones are left out, so running the job again changes nothing.
-- A first payment still going through ('incomplete') is left to Stripe, whose next event closes or keeps it.
-- Same rule as trialOver() in src/lib/closeout.ts (tests/rls.test.ts checks they agree).
create or replace function public.expired_workspaces(n int) returns setof uuid
language sql stable set search_path = '' as $$
  select w.id from public.workspaces w
   where public.effective_plan(w.plan, w.status, w.trial_ends_at) = 'expired' and w.status <> 'incomplete'
     and exists (select 1 from public.services s where s.workspace_id = w.id and s.status in ('pending', 'waiting', 'ready', 'failed'))
   order by w.trial_ends_at, w.id
   limit greatest(n, 0);
$$;
revoke execute on function public.expired_workspaces(int) from public, anon, authenticated;
grant execute on function public.expired_workspaces(int) to service_role;
