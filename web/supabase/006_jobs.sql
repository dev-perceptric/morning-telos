-- Morning Telos migration 006: the job queue, and setting up each new workspace's brands in the background.
-- Run once in Supabase → SQL Editor, after 005_services.sql. Safe to run again.
-- Copied from Omniscient's 002_records.sql (jobs, claim_jobs) and Arrowsterr's 016_queue.sql.
--
-- The worker (POST /api/worker, called every minute) claims due jobs and runs them. Two workers never get the same
-- job (for update skip locked), a crashed worker's job comes back when its lease ends, and a failed job is tried
-- again later (src/lib/jobs.ts) until max_attempts. A job that used up its attempts stays here with its last_error.
-- To try those again (after setting a missing key, say):
--   update public.jobs set attempts = 0, run_at = now() where done_at is null and attempts >= max_attempts;
--
-- Everything here is server only: RLS on, no policies, no rights for the API roles.

-- ─────────────── jobs ───────────────
create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  kind text not null check (char_length(kind) between 1 and 60),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5 check (max_attempts between 1 and 50),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.jobs enable row level security; -- no policies: server only
revoke all on public.jobs from anon, authenticated;
create index if not exists jobs_ready_idx on public.jobs (run_at) where done_at is null;
create index if not exists jobs_workspace_idx on public.jobs (workspace_id);

-- Take up to n due jobs and hold each for `lease`. A job whose lease ran out (its worker died) is taken again.
-- Each claim counts as an attempt. Jobs that used up their attempts are never taken.
create or replace function public.claim_jobs(n int, lease interval default interval '5 minutes')
returns setof public.jobs language sql set search_path = '' as $$
  update public.jobs j set locked_until = now() + lease, attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where done_at is null and run_at <= now() and (locked_until is null or locked_until < now()) and attempts < max_attempts
    order by run_at, id
    limit greatest(n, 0)
    for update skip locked
  )
  returning j.*;
$$;
revoke execute on function public.claim_jobs(int, interval) from public, anon, authenticated;
grant execute on function public.claim_jobs(int, interval) to service_role;

-- ─────────────── a new workspace gets its brands ───────────────
-- Every new workspace starts with a pending Arrowsterr and Capybaroar service and one provision job.
-- The job (src/lib/provision.ts) makes the brand in each product and saves its sealed brand key.
create or replace function public.queue_provision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.services (workspace_id, product)
  values (new.id, 'arrowsterr'), (new.id, 'capybaroar')
  on conflict (workspace_id, product) do nothing;
  insert into public.jobs (kind, workspace_id) values ('provision', new.id);
  return new;
end;
$$;
revoke execute on function public.queue_provision() from public, anon, authenticated;
drop trigger if exists workspaces_provision on public.workspaces;
create trigger workspaces_provision after insert on public.workspaces for each row execute function public.queue_provision();

-- Workspaces made before this file: the same rows and job, once.
insert into public.services (workspace_id, product)
select w.id, p.product from public.workspaces w cross join (values ('arrowsterr'), ('capybaroar')) p (product)
on conflict (workspace_id, product) do nothing;
insert into public.jobs (kind, workspace_id)
select 'provision', w.id from public.workspaces w
 where not exists (select 1 from public.jobs j where j.kind = 'provision' and j.workspace_id = w.id);
