-- ─────────────── leads ───────────────
-- Hermes's list of leads and open quotes, for businesses with no CRM (src/lib/leads.ts). The Leads tab on his page
-- shows it (src/components/Leads.tsx); Hermes keeps it up to date with save_lead and reads it with find_leads.
-- Members read; editors and up add, change and delete. Hermes writes as the server.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  company text not null default '' check (char_length(company) <= 120),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  value numeric(12, 2) check (value is null or value between 0 and 100000000),
  stage text not null default 'open' check (stage in ('open', 'won', 'lost')),
  next_step text not null default '' check (char_length(next_step) <= 200),
  next_date date,
  last_contact timestamptz,
  notes text not null default '' check (char_length(notes) <= 4000),
  source text not null default 'person' check (source in ('person', 'hermes')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_ws_email_idx on public.leads (workspace_id, lower(email)) where email is not null;
create index if not exists leads_ws_stage_idx on public.leads (workspace_id, stage, next_date);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select, insert, update, delete on public.leads to authenticated;

drop policy if exists "leads read" on public.leads;
create policy "leads read" on public.leads for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "leads add" on public.leads;
create policy "leads add" on public.leads for insert with check (public.has_role(workspace_id, 'editor'));
drop policy if exists "leads change" on public.leads;
create policy "leads change" on public.leads for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
drop policy if exists "leads delete" on public.leads;
create policy "leads delete" on public.leads for delete using (public.has_role(workspace_id, 'editor'));

-- At most 5,000 leads a workspace, so one workspace can't fill the database.
create or replace function public.leads_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.leads l where l.workspace_id = new.workspace_id) >= 5000 then
    raise exception 'This workspace has 5,000 leads. Delete some first.';
  end if;
  return new;
end $$;
drop trigger if exists leads_limit on public.leads;
create trigger leads_limit before insert on public.leads for each row execute function public.leads_limit();
