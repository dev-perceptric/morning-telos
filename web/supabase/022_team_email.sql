-- Morning Telos migration 022: the email door. Every workspace gets an address like acme@team.morningtelos.com. The
-- owner and the team email it or forward to it, the right teammate answers by email, and the chat shows in the app.
-- Run once in Supabase → SQL Editor, after 021_brand.sql. Safe to run again.
-- Nothing changes for customers until TEAM_EMAIL_DOMAIN is set on the server (src/lib/teamEmail.ts).
--
-- How mail flows: Resend receives the email and calls POST /api/email/inbound (src/lib/teamEmailInbound.ts). The
-- route checks the signature, finds the workspace by the address and the sender, and queues one team_email job
-- with queue_team_email(). The job (src/lib/teamEmailServer.ts) reads the email, saves it as the person's message,
-- runs the team's turn and emails the answer back.
--
-- Who can do what:
--   team_email          members read their workspace's address. The owner changes the address once
--                       (set_team_email_slug) and turns it on or off (set_team_email_enabled).
--   team_email_senders  "Also accept email from": members read, the owner adds and removes, 20 at most.
--   team_email_threads, team_email_messages, team_email_inbound, team_email_drops, approval_links
--                       server only: RLS on, no policies, no rights for the API roles.

-- ─────────────── the address ───────────────
-- slug is the part before the @. slug_changed_at is set the one time the owner changes it.
create table if not exists public.team_email (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' and slug !~ '--'),
  enabled boolean not null default true,
  slug_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.team_email enable row level security;
revoke all on public.team_email from anon, authenticated;
grant select on public.team_email to authenticated;
grant select, insert, update, delete on public.team_email to service_role;

drop policy if exists "team email read" on public.team_email;
create policy "team email read" on public.team_email for select using (public.has_role(workspace_id, 'viewer'));

-- Names nobody gets, because mail systems or people expect them to mean something else. Keep in step with
-- RESERVED_SLUGS in src/lib/teamEmail.ts (tests/rls.test.ts checks both give the same slugs).
create or replace function public.team_email_reserved(p_slug text) returns boolean
language sql immutable set search_path = '' as $$
  select p_slug = any (array[
    'abuse', 'admin', 'billing', 'help', 'hostmaster', 'info', 'mailer-daemon', 'morningtelos', 'no-reply', 'noreply',
    'postmaster', 'root', 'security', 'staff', 'support', 'team', 'webmaster'
  ])
$$;

-- The slug a business name starts from: lower case letters and digits, other runs of characters become one dash,
-- at most 30 characters. Same as slugFromName() in src/lib/teamEmail.ts.
create or replace function public.team_email_slug_base(p_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text;
begin
  s := lower(coalesce(p_name, ''));
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := trim(both '-' from s);
  s := trim(both '-' from left(s, 30));
  if s = '' then s := 'team'; end if;
  if public.team_email_reserved(s) then s := left(s, 25) || '-team'; end if;
  return s;
end $$;

-- Gives a workspace its address, the base slug or the first free one of base-2, base-3, ... Does nothing when it
-- already has one. Two new workspaces with the same name at once both get an address: the loser of the race tries
-- the next number.
create or replace function public.give_team_email(p_ws uuid, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  base text := public.team_email_slug_base(p_name);
  pick text;
  n int := 1;
begin
  select slug into pick from public.team_email where workspace_id = p_ws;
  if pick is not null then return pick; end if;
  loop
    pick := case when n = 1 then base else base || '-' || n end;
    if not exists (select 1 from public.team_email where slug = pick) then
      begin
        insert into public.team_email (workspace_id, slug) values (p_ws, pick);
        return pick;
      exception when unique_violation then
        -- Someone took this slug a moment ago, or this workspace got its row from another call.
        select slug into pick from public.team_email where workspace_id = p_ws;
        if pick is not null then return pick; end if;
      end;
    end if;
    n := n + 1;
    if n > 10000 then raise exception 'No free email address for %', base; end if;
  end loop;
end $$;
revoke execute on function public.give_team_email(uuid, text) from public, anon, authenticated;
grant execute on function public.give_team_email(uuid, text) to service_role;

create or replace function public.team_email_for_new_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.give_team_email(new.id, new.name);
  return new;
end $$;
drop trigger if exists workspaces_team_email on public.workspaces;
create trigger workspaces_team_email after insert on public.workspaces for each row execute function public.team_email_for_new_workspace();

-- Workspaces made before this migration get theirs now, oldest first, so the oldest keeps the plain name.
do $$
declare w record;
begin
  for w in select id, name from public.workspaces order by created_at, id loop
    perform public.give_team_email(w.id, w.name);
  end loop;
end $$;

-- The owner picks a new address, once. Checks the format, the reserved names and that nobody else has it.
create or replace function public.set_team_email_slug(p_ws uuid, p_slug text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s text := lower(trim(coalesce(p_slug, '')));
  cur public.team_email;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.has_role(p_ws, 'owner') then raise exception 'Only the owner can change the team email.'; end if;
  if char_length(s) < 2 or char_length(s) > 40 or s !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' or s ~ '--' then
    raise exception 'Use 2 to 40 letters, numbers or dashes. Start and end with a letter or number.';
  end if;
  if public.team_email_reserved(s) then raise exception 'That address is saved for email systems. Pick another one.'; end if;
  select * into cur from public.team_email where workspace_id = p_ws for update;
  if cur.workspace_id is null then raise exception 'This workspace has no team email yet.'; end if;
  if cur.slug = s then return s; end if;
  if cur.slug_changed_at is not null then raise exception 'You already changed this address once.'; end if;
  if exists (select 1 from public.team_email where slug = s) then raise exception 'That address is taken. Pick another one.'; end if;
  begin
    update public.team_email set slug = s, slug_changed_at = now(), updated_at = now() where workspace_id = p_ws;
  exception when unique_violation then
    raise exception 'That address is taken. Pick another one.';
  end;
  return s;
end $$;
revoke execute on function public.set_team_email_slug(uuid, text) from public, anon;
grant execute on function public.set_team_email_slug(uuid, text) to authenticated;

-- The owner turns the address on or off. Off means emails to it are dropped with no reply.
create or replace function public.set_team_email_enabled(p_ws uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.has_role(p_ws, 'owner') then raise exception 'Only the owner can turn the team email on or off.'; end if;
  update public.team_email set enabled = coalesce(p_on, true), updated_at = now() where workspace_id = p_ws;
  return coalesce(p_on, true);
end $$;
revoke execute on function public.set_team_email_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_team_email_enabled(uuid, boolean) to authenticated;

-- ─────────────── who may email it ───────────────
-- Members may, from their confirmed sign-in email. These are the other addresses the owner allows.
create table if not exists public.team_email_senders (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 200 and email = lower(email) and email ~ '^[^@\s<>",;]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
alter table public.team_email_senders enable row level security;
revoke all on public.team_email_senders from anon, authenticated;
grant select, insert, delete on public.team_email_senders to authenticated;
grant select, insert, delete on public.team_email_senders to service_role;

drop policy if exists "team email senders read" on public.team_email_senders;
create policy "team email senders read" on public.team_email_senders for select using (public.has_role(workspace_id, 'viewer'));
drop policy if exists "team email senders add" on public.team_email_senders;
create policy "team email senders add" on public.team_email_senders for insert
  with check (public.has_role(workspace_id, 'owner') and added_by = auth.uid()
    and (select count(*) from public.team_email_senders s where s.workspace_id = team_email_senders.workspace_id) < 20);
drop policy if exists "team email senders remove" on public.team_email_senders;
create policy "team email senders remove" on public.team_email_senders for delete using (public.has_role(workspace_id, 'owner'));

-- Who an email is from, for the server: a member whose confirmed sign-in email matches (with their role), else an
-- extra sender the owner added (kind 'extra', no user), else no row.
create or replace function public.team_email_sender(p_ws uuid, p_email text)
returns table (kind text, user_id uuid, role public.ws_role)
language sql stable security definer set search_path = '' as $$
  (select 'member'::text, m.user_id, m.role
     from public.workspace_members m join auth.users u on u.id = m.user_id
    where m.workspace_id = p_ws and lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null
    limit 1)
  union all
  (select 'extra'::text, null::uuid, null::public.ws_role
     from public.team_email_senders s
    where s.workspace_id = p_ws and s.email = lower(trim(p_email))
      and not exists (
        select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
         where m.workspace_id = p_ws and lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null)
    limit 1)
$$;
revoke execute on function public.team_email_sender(uuid, text) from public, anon, authenticated;
grant execute on function public.team_email_sender(uuid, text) to service_role;

-- ─────────────── threads and messages (server only) ───────────────
-- An email chat: the thread it lives in and the token in its reply-to address (acme+t<token>@...).
create table if not exists public.team_email_threads (
  thread_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token text not null unique check (token ~ '^[a-z0-9]{16}$'),
  subject text not null default '' check (char_length(subject) <= 300),
  created_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete cascade
);
create index if not exists team_email_threads_ws_idx on public.team_email_threads (workspace_id);
alter table public.team_email_threads enable row level security; -- no policies: server only
revoke all on public.team_email_threads from anon, authenticated;
grant select, insert, delete on public.team_email_threads to service_role;

-- Every email in and out, by its Message-ID, so a reply finds its chat from In-Reply-To or References, and the
-- answer's References list the whole conversation. No email text is kept here: that is the chat message.
create table if not exists public.team_email_messages (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  message_id text not null check (char_length(message_id) between 3 and 300),
  direction text not null check (direction in ('in', 'out')),
  created_at timestamptz not null default now(),
  unique (workspace_id, message_id),
  foreign key (thread_id, workspace_id) references public.threads (id, workspace_id) on delete cascade
);
create index if not exists team_email_messages_thread_idx on public.team_email_messages (thread_id, id);
create index if not exists team_email_messages_in_idx on public.team_email_messages (workspace_id, created_at) where direction = 'in';
alter table public.team_email_messages enable row level security; -- no policies: server only
revoke all on public.team_email_messages from anon, authenticated;
grant select, insert, delete on public.team_email_messages to service_role;

-- Each received email once, by Resend's email id, so a webhook sent twice queues one job.
create table if not exists public.team_email_inbound (
  email_id text primary key check (char_length(email_id) between 1 and 100),
  workspace_id uuid references public.workspaces (id) on delete set null,
  received_at timestamptz not null default now()
);
alter table public.team_email_inbound enable row level security; -- no policies: server only
revoke all on public.team_email_inbound from anon, authenticated;
grant select, insert, delete on public.team_email_inbound to service_role;

-- Queues the team_email job for one received email, once. True when this call queued it.
create or replace function public.queue_team_email(p_email_id text, p_ws uuid) returns boolean
language plpgsql set search_path = '' as $$
declare n int;
begin
  insert into public.team_email_inbound (email_id, workspace_id) values (p_email_id, p_ws) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  insert into public.jobs (kind, workspace_id, payload, max_attempts)
  values ('team_email', p_ws, jsonb_build_object('email_id', p_email_id), 3);
  return true;
end $$;
revoke execute on function public.queue_team_email(text, uuid) from public, anon, authenticated;
grant execute on function public.queue_team_email(text, uuid) to service_role;

-- Emails dropped with no reply, counted per UTC day and reason for the staff console. No address or text is kept.
create table if not exists public.team_email_drops (
  day date not null,
  reason text not null check (reason ~ '^[a-z][a-z_]{0,29}$'),
  count int not null default 0 check (count >= 0),
  primary key (day, reason)
);
alter table public.team_email_drops enable row level security; -- no policies: server only
revoke all on public.team_email_drops from anon, authenticated;
grant select on public.team_email_drops to service_role;

create or replace function public.count_team_email_drop(p_reason text) returns void
language sql set search_path = '' as $$
  insert into public.team_email_drops (day, reason, count) values ((now() at time zone 'utc')::date, p_reason, 1)
  on conflict (day, reason) do update set count = public.team_email_drops.count + 1;
$$;
revoke execute on function public.count_team_email_drop(text) from public, anon, authenticated;
grant execute on function public.count_team_email_drop(text) to service_role;

-- ─────────────── Approve links in emails (server only) ───────────────
-- One row per Approve link sent. The link holds a sealed token (src/lib/approveLink.ts) naming this row's nonce,
-- the approval and the member it was sent to. It works once and for 72 hours.
create table if not exists public.approval_links (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  approval_id bigint not null references public.approvals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approval_links_approval_idx on public.approval_links (approval_id);
alter table public.approval_links enable row level security; -- no policies: server only
revoke all on public.approval_links from anon, authenticated;
grant select, insert, delete on public.approval_links to service_role;

-- Uses a link: marks it used when the nonce, approval and member all match, it is unused and it hasn't expired.
-- Returns 'ok', or why not: 'missing', 'used' or 'expired'. Two clicks at once never both get 'ok'.
create or replace function public.use_approval_link(p_nonce text, p_approval bigint, p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.approval_links;
begin
  select * into l from public.approval_links where nonce = p_nonce for update;
  if l.nonce is null or l.approval_id <> p_approval or l.user_id <> p_user then return 'missing'; end if;
  if l.used_at is not null then return 'used'; end if;
  if l.expires_at <= now() then return 'expired'; end if;
  update public.approval_links set used_at = now() where nonce = p_nonce;
  return 'ok';
end $$;
revoke execute on function public.use_approval_link(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.use_approval_link(text, bigint, uuid) to service_role;
