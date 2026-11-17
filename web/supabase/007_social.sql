-- Morning Telos migration 007: each workspace's social accounts, connected through its brand in Capybaroar.
-- Run once in Supabase → SQL Editor, after 006_jobs.sql. Safe to run again.
--
-- The customer connects Instagram, Facebook, LinkedIn and others on a one-time Capybaroar page
-- (POST /api/social/connect-link). Capybaroar then calls POST /api/partner/capybaroar/webhook with channel.connected
-- or channel.lost, and the server saves the channel here. Members read their own workspace's channels.
-- Only the server writes them.

-- ─────────────── social_channels ───────────────
create table if not exists public.social_channels (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id text not null check (char_length(channel_id) between 1 and 200),
  network text not null check (network ~ '^[a-z0-9_-]{1,40}$'),
  name text not null default '' check (char_length(name) <= 200),
  status text not null check (status in ('connected', 'lost')),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, channel_id)
);
alter table public.social_channels enable row level security;
revoke all on public.social_channels from anon, authenticated;
grant select on public.social_channels to authenticated;
drop policy if exists "social channels read" on public.social_channels;
create policy "social channels read" on public.social_channels for select using (public.has_role(workspace_id, 'viewer'));

-- Save one channel event. An event older than the saved row is skipped, so a late retry of "connected" never
-- undoes a newer "lost" (and the other way round). Returns true when the row changed. Server only.
create or replace function public.save_social_channel(p_ws uuid, p_channel text, p_network text, p_name text, p_status text, p_at timestamptz)
returns boolean language sql set search_path = '' as $$
  with saved as (
    insert into public.social_channels as c (workspace_id, channel_id, network, name, status, updated_at)
    values (p_ws, p_channel, p_network, coalesce(p_name, ''), p_status, p_at)
    on conflict (workspace_id, channel_id) do update
      set network = excluded.network, name = excluded.name, status = excluded.status, updated_at = excluded.updated_at
      where c.updated_at <= excluded.updated_at
    returning 1
  )
  select exists (select 1 from saved)
$$;
revoke execute on function public.save_social_channel(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_social_channel(uuid, text, text, text, text, timestamptz) to service_role;

-- ─────────────── webhook_events ───────────────
-- Each partner webhook delivery once, by its webhook-id. A resend of the same id is answered without running again.
create table if not exists public.webhook_events (
  source text not null check (source in ('capybaroar')),
  id text not null check (char_length(id) between 1 and 200),
  type text not null check (char_length(type) between 1 and 60),
  at timestamptz not null default now(),
  primary key (source, id)
);
alter table public.webhook_events enable row level security; -- no policies: server only
revoke all on public.webhook_events from anon, authenticated;
