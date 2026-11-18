-- The internal plan: our own workspaces, with no AI limit. Never sold and never set by Stripe; staff set it by hand:
--   update public.workspaces set plan = 'internal', status = 'active' where id = '<workspace id>';
-- Run once in Supabase → SQL Editor, after 012_knowledge.sql. Safe to run twice.

alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check check (plan in ('trial', 'starter', 'pro', 'internal'));

-- Same rule as effectivePlan() in src/lib/plans.ts: internal first, then a paid plan, then the trial, then expired.
create or replace function public.effective_plan(p_plan text, p_status text, p_trial_ends_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p_plan = 'internal' then 'internal'
    when p_plan in ('starter', 'pro') and p_status in ('trialing', 'active', 'past_due') then p_plan
    when p_trial_ends_at > now() then 'trial'
    else 'expired'
  end
$$;
