-- Morning Telos database. Paste all of this into Supabase → SQL Editor → Run on a new project (sb-morningtelos).
-- Later changes go in numbered files (002_*.sql, 003_*.sql, ...), run once each, in order.
--
-- Each customer business is a workspace. People join a workspace with a role:
--   owner  > admin  > editor > viewer
--   owner: everything, including billing and deleting the workspace.
--   admin: manage members and settings.  editor: chat with agents and approve work.  viewer: read only.
--
-- Rules for every table added later (tests/schema.test.ts checks them):
--   * customer tables have workspace_id and RLS policies through has_role()
--   * server-only tables have RLS on and no policies

create type public.ws_role as enum ('owner', 'admin', 'editor', 'viewer');

-- ─────────────── tables ───────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  website text check (website is null or char_length(website) <= 200),
  timezone text not null default 'America/Chicago',
  -- Billing. Only the server (service role) changes these, from the Stripe webhook.
  plan text not null default 'trial',
  status text not null default 'trialing',
  trial_ends_at timestamptz not null default now() + interval '14 days',
  period_start timestamptz not null default now(),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  role public.ws_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);
-- Exactly one owner per workspace.
create unique index workspace_members_one_owner on public.workspace_members (workspace_id) where role = 'owner';

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 200),
  role public.ws_role not null check (role <> 'owner'),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create index workspace_invites_ws_idx on public.workspace_invites (workspace_id);

-- ─────────────── role helpers ───────────────

create function public.role_rank(r public.ws_role) returns int
language sql immutable set search_path = '' as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 else 1 end
$$;

-- True when the signed-in user has at least this role in the workspace.
create function public.has_role(ws uuid, min public.ws_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select public.role_rank(m.role) >= public.role_rank(min)
       from public.workspace_members m
      where m.workspace_id = ws and m.user_id = auth.uid()),
    false)
$$;

-- ─────────────── making and joining workspaces ───────────────

-- Make a workspace and add the signed-in user as its owner.
create function public.create_workspace(p_name text, p_website text default null, p_timezone text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.workspaces (name, website, timezone, created_by)
  values (
    coalesce(nullif(trim(p_name), ''), 'My business'),
    nullif(trim(p_website), ''),
    coalesce(nullif(trim(p_timezone), ''), 'America/Chicago'),
    auth.uid())
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (ws, auth.uid(), auth.jwt() ->> 'email', 'owner');
  return ws;
end;
$$;

-- Join a workspace from an invite link. The invite must be for the signed-in email and not expired.
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.workspace_invites;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into inv from public.workspace_invites
   where token = p_token and accepted_at is null and expires_at > now();
  if inv.id is null then raise exception 'This invite link is not valid, has expired, or was already used.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite is for %. Sign in with that email to accept it.', inv.email;
  end if;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (inv.workspace_id, auth.uid(), auth.jwt() ->> 'email', inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites set accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end;
$$;

-- A new person who signed up with a business name gets their workspace right away.
-- People who sign up from an invite link don't send one, so they only join the workspace they were invited to.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ws uuid; biz text;
begin
  biz := nullif(trim(new.raw_user_meta_data ->> 'business'), '');
  if biz is null then return new; end if;
  insert into public.workspaces (name, website, timezone, created_by)
  values (
    left(biz, 120),
    nullif(left(trim(new.raw_user_meta_data ->> 'website'), 200), ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'timezone'), ''), 'America/Chicago'),
    new.id)
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, email, role) values (ws, new.id, new.email, 'owner');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- One free trial per person: a workspace's trial ends 14 days after its maker signed up,
-- so making more workspaces (or deleting and remaking one) never starts a fresh trial.
create function public.trial_from_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare joined timestamptz;
begin
  if new.plan <> 'trial' or new.created_by is null then return new; end if;
  select created_at into joined from auth.users where id = new.created_by;
  if joined is not null then
    new.trial_ends_at := least(coalesce(new.trial_ends_at, now() + interval '14 days'), joined + interval '14 days');
  end if;
  return new;
end;
$$;
create trigger workspaces_one_trial before insert on public.workspaces for each row execute function public.trial_from_signup();

revoke execute on function public.create_workspace(text, text, text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.has_role(uuid, public.ws_role) to authenticated;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ─────────────── row level security ───────────────

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- Members can only change the business details. Plan and billing columns are server-only.
revoke insert, update on public.workspaces from authenticated, anon;
grant update (name, website, timezone) on public.workspaces to authenticated;

-- Workspaces: members see them, admins edit the details, only the owner deletes. New ones come from create_workspace().
create policy "ws read" on public.workspaces for select using (public.has_role(id, 'viewer'));
create policy "ws edit" on public.workspaces for update using (public.has_role(id, 'admin')) with check (public.has_role(id, 'admin'));
create policy "ws delete" on public.workspaces for delete using (public.has_role(id, 'owner'));

-- Members: everyone in the workspace sees the list. Admins change roles and remove people, but never the owner,
-- and nobody can make someone an owner. Anyone except the owner can leave.
-- New members come only from create_workspace(), accept_invite() and the sign-up trigger.
revoke insert on public.workspace_members from authenticated, anon;
create policy "members read" on public.workspace_members for select using (public.has_role(workspace_id, 'viewer'));
create policy "members change role" on public.workspace_members for update
  using (public.has_role(workspace_id, 'admin') and role <> 'owner')
  with check (public.has_role(workspace_id, 'admin') and role <> 'owner');
create policy "members remove" on public.workspace_members for delete
  using (role <> 'owner' and (public.has_role(workspace_id, 'admin') or user_id = auth.uid()));

-- Invites: admins only.
create policy "invites read" on public.workspace_invites for select using (public.has_role(workspace_id, 'admin'));
create policy "invites create" on public.workspace_invites for insert
  with check (public.has_role(workspace_id, 'admin') and invited_by = auth.uid());
create policy "invites revoke" on public.workspace_invites for delete using (public.has_role(workspace_id, 'admin'));
