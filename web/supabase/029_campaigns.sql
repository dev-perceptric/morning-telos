-- ─────────────── Cyrus's email campaigns ───────────────
-- The business's own mailing list, Cyrus's campaigns, and what went to whom (src/lib/campaigns.ts). Campaigns go out
-- from the business's own Gmail or Outlook through Composio, a few at a time under the inbox's daily limit
-- (src/lib/campaignSend.ts, called by the worker). Every email ends with the business's mailing address and an
-- unsubscribe link (/api/unsubscribe), and nobody who unsubscribed is emailed again.

-- contacts: members read; editors and up add, change and delete. The unsubscribe token is made here.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (char_length(email) <= 200 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  name text not null default '' check (char_length(name) <= 120),
  list text not null default 'Customers' check (char_length(btrim(list)) between 1 and 60),
  token text not null default replace(gen_random_uuid()::text, '-', '') unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index if not exists contacts_ws_list_idx on public.contacts (workspace_id, list);
alter table public.contacts enable row level security;
revoke all on public.contacts from anon, authenticated;
grant select on public.contacts to authenticated;
grant insert (workspace_id, email, name, list) on public.contacts to authenticated;
grant update (name, list) on public.contacts to authenticated;
grant delete on public.contacts to authenticated;
drop policy if exists "contacts read" on public.contacts;
create policy "contacts read" on public.contacts for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "contacts add" on public.contacts;
create policy "contacts add" on public.contacts for insert with check (public.has_role(workspace_id, 'editor'));
drop policy if exists "contacts change" on public.contacts;
create policy "contacts change" on public.contacts for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
drop policy if exists "contacts delete" on public.contacts;
create policy "contacts delete" on public.contacts for delete using (public.has_role(workspace_id, 'editor'));

create or replace function public.contacts_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.contacts c where c.workspace_id = new.workspace_id) >= 20000 then
    raise exception 'This workspace has 20,000 contacts. Delete some first.';
  end if;
  return new;
end $$;
drop trigger if exists contacts_limit on public.contacts;
create trigger contacts_limit before insert on public.contacts for each row execute function public.contacts_limit();

-- campaigns: members read; editors write drafts and cancel. Only the server schedules one (after its checks) and
-- sends it, so a person's own update can only leave it a draft or canceled.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  list text check (list is null or char_length(btrim(list)) between 1 and 60),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'canceled')),
  send_at timestamptz,
  from_app text check (from_app is null or from_app in ('gmail', 'outlook')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  source text not null default 'person' check (source in ('person', 'iris')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or status = 'canceled' or send_at is not null)
);
create index if not exists campaigns_due_idx on public.campaigns (send_at) where status in ('scheduled', 'sending');
create index if not exists campaigns_ws_idx on public.campaigns (workspace_id, created_at desc);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant select on public.campaigns to authenticated;
grant insert (workspace_id, subject, body, list) on public.campaigns to authenticated;
grant update (subject, body, list, status, updated_at) on public.campaigns to authenticated;
grant delete on public.campaigns to authenticated;
drop policy if exists "campaigns read" on public.campaigns;
create policy "campaigns read" on public.campaigns for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "campaigns add" on public.campaigns;
create policy "campaigns add" on public.campaigns for insert with check (public.has_role(workspace_id, 'editor') and status = 'draft');
drop policy if exists "campaigns change" on public.campaigns;
-- A draft can be edited or canceled; a scheduled one only canceled. Sending and sent ones stay as they are.
create policy "campaigns change" on public.campaigns for update
  using (public.has_role(workspace_id, 'editor') and status in ('draft', 'scheduled'))
  with check (public.has_role(workspace_id, 'editor') and status in ('draft', 'canceled'));
drop policy if exists "campaigns delete" on public.campaigns;
create policy "campaigns delete" on public.campaigns for delete using (public.has_role(workspace_id, 'editor') and status in ('draft', 'canceled'));

-- campaign_sends: one row per contact a campaign went to (or failed for), so no one gets it twice. Server only.
create table if not exists public.campaign_sends (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null check (status in ('sent', 'failed')),
  error text check (error is null or char_length(error) <= 300),
  at timestamptz not null default now(),
  primary key (campaign_id, contact_id)
);
create index if not exists campaign_sends_ws_at_idx on public.campaign_sends (workspace_id, at desc);
alter table public.campaign_sends enable row level security;
revoke all on public.campaign_sends from anon, authenticated;

-- The next contacts a campaign hasn't gone to yet, on its list, who haven't unsubscribed. Server only.
create or replace function public.next_campaign_contacts(p_campaign uuid, p_n int)
returns table (id uuid, email text, name text, list text, token text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.email, c.name, c.list, c.token
    from public.campaigns k
    join public.contacts c on c.workspace_id = k.workspace_id and (k.list is null or c.list = k.list)
   where k.id = p_campaign
     and c.unsubscribed_at is null
     and not exists (select 1 from public.campaign_sends s where s.campaign_id = k.id and s.contact_id = c.id)
   order by c.created_at, c.id
   limit greatest(0, least(p_n, 500))
$$;
revoke execute on function public.next_campaign_contacts(uuid, int) from public, anon, authenticated;
grant execute on function public.next_campaign_contacts(uuid, int) to service_role;

-- Unsubscribing from a link in an email: no sign-in, only the contact's own token. Returns true when it changed.
create or replace function public.unsubscribe_contact(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return false; end if;
  update public.contacts set unsubscribed_at = coalesce(unsubscribed_at, now()) where token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.unsubscribe_contact(text) from public, anon, authenticated;
grant execute on function public.unsubscribe_contact(text) to service_role;
