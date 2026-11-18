-- Morning Telos migration 018: trial and lifecycle emails, sent once each, and each owner's choice to turn some off.
-- Run once in Supabase → SQL Editor, after 017. Safe to run again.
-- Copied from Arrowsterr's email_log (023_emails.sql) and nudges.ts, keyed per person as well as per workspace.
--
-- Once an hour the worker (POST /api/worker) queues one lifecycle_emails job with queue_hourly_jobs(). The job
-- (src/lib/lifecycleSend.ts) asks src/lib/lifecycle.ts which emails each workspace is due and sends them to its owner:
-- trial day 7, day 12, the last day, the morning after the trial ended, 80% of the AI allowance, and the weekly
-- digest on Monday.
--
--   email_log    server only. One row per email sent. The row goes in before the email is sent (the claim), so two
--                worker runs at once can never send the same email twice.
--   email_prefs  each person's own row per workspace. digest = false turns off the weekly digest and tips. Trial and
--                billing emails always go. Only that person reads it, and they change it with set_email_digest().
--                The one-click unsubscribe link (src/app/api/email/unsubscribe) writes it with the server key.

-- ─────────────── email_log ───────────────
-- kind: which email (src/lib/lifecycle.ts, LIFECYCLE_KINDS). period_key: which one of that kind, like the trial's end
-- date, the AI allowance's period or the digest's Monday.
create table if not exists public.email_log (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  period_key text not null check (char_length(period_key) between 1 and 40),
  sent_at timestamptz not null default now(),
  unique (workspace_id, user_id, kind, period_key)
);
create index if not exists email_log_user_idx on public.email_log (user_id);
alter table public.email_log enable row level security; -- no policies: server only
revoke all on public.email_log from anon, authenticated;
grant select, insert, delete on public.email_log to service_role;

-- ─────────────── email_prefs ───────────────
-- No row means everything is on.
create table if not exists public.email_prefs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  digest boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists email_prefs_user_idx on public.email_prefs (user_id);
alter table public.email_prefs enable row level security;
revoke all on public.email_prefs from anon, authenticated;
grant select on public.email_prefs to authenticated;
grant select, insert, update, delete on public.email_prefs to service_role;

drop policy if exists "email prefs read own" on public.email_prefs;
create policy "email prefs read own" on public.email_prefs for select
  using (user_id = auth.uid() and public.has_role(workspace_id, 'viewer'));

-- Turn the weekly digest and tips on or off for the signed-in person in one of their workspaces.
create or replace function public.set_email_digest(p_ws uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.has_role(p_ws, 'viewer') then raise exception 'You are not in that workspace.'; end if;
  insert into public.email_prefs (workspace_id, user_id, digest, updated_at)
  values (p_ws, auth.uid(), coalesce(p_on, true), now())
  on conflict (workspace_id, user_id) do update set digest = excluded.digest, updated_at = now();
  return coalesce(p_on, true);
end;
$$;
revoke execute on function public.set_email_digest(uuid, boolean) from public, anon;
grant execute on function public.set_email_digest(uuid, boolean) to authenticated;

-- ─────────────── one hourly job per kind and UTC hour ───────────────
-- Like queue_daily_jobs() (010_expire_trials.sql), with the hour in the payload ({"hour": "2026-11-18T09"}).
create unique index if not exists jobs_hourly_idx on public.jobs (kind, (payload ->> 'hour')) where payload ? 'hour';

create or replace function public.queue_hourly_jobs() returns int
language sql set search_path = '' as $$
  with now_hour (hour) as (select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24')),
  added as (
    insert into public.jobs (kind, payload, max_attempts)
    select k.kind, jsonb_build_object('hour', t.hour), 3
      from now_hour t cross join (values ('lifecycle_emails')) k (kind)
     where not exists (select 1 from public.jobs j where j.kind = k.kind and j.payload ? 'hour' and j.payload ->> 'hour' = t.hour)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from added;
$$;
revoke execute on function public.queue_hourly_jobs() from public, anon, authenticated;
grant execute on function public.queue_hourly_jobs() to service_role;
