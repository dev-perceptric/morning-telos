-- Morning Telos migration 002: Stripe billing. Run once in Supabase → SQL Editor, after schema.sql.
-- Prices and AI allowances live in src/lib/plans.ts. The Stripe webhook (POST /api/billing/webhook) writes
-- each workspace's plan, status and Stripe ids with the server's secret key. Members can't change them (schema.sql).
-- Copied from Arrowsterr's 015_billing.sql, 017_stripe.sql and Omniscient's 024_billing.sql, 027_stripe_events.sql.
-- One trial per person (Arrowsterr's 018_one_trial.sql) is already in schema.sql as trial_from_signup().

-- ─────────────── plan columns ───────────────
-- plan: what the workspace pays for, or 'trial'. status mirrors Stripe (trialing before any subscription).
alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check check (plan in ('trial', 'starter', 'pro'));
alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'));

-- ─────────────── each Stripe event once ───────────────
-- Stripe can send the same event more than once. The webhook marks each id here first and skips ones it has seen.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  at timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- no policies: server only
revoke all on public.stripe_events from anon, authenticated;

-- ─────────────── the plan in force ───────────────
-- Same rule as effectivePlan() in src/lib/plans.ts (tests/rls.test.ts checks they agree):
--   a paid plan with a trialing, active or past_due subscription is that plan;
--   otherwise the trial, while it lasts;
--   otherwise 'expired' (the trial ended, or the plan was canceled).
create or replace function public.effective_plan(p_plan text, p_status text, p_trial_ends_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p_plan in ('starter', 'pro') and p_status in ('trialing', 'active', 'past_due') then p_plan
    when p_trial_ends_at > now() then 'trial'
    else 'expired'
  end
$$;

-- The plan a workspace is on right now. Runs as the caller, so members only get an answer for their own workspaces.
create or replace function public.effective_plan(p_ws uuid) returns text
language sql stable set search_path = '' as $$
  select public.effective_plan(w.plan, w.status, w.trial_ends_at) from public.workspaces w where w.id = p_ws
$$;

revoke execute on function public.effective_plan(text, text, timestamptz) from public, anon;
revoke execute on function public.effective_plan(uuid) from public, anon;
grant execute on function public.effective_plan(text, text, timestamptz) to authenticated, service_role;
grant execute on function public.effective_plan(uuid) to authenticated, service_role;
