-- Disconnecting a social account from Aphrodite's Settings (src/lib/socialWork.ts disconnectSocial) removes its row
-- from social_channels. Capybaroar then sends channel.lost, which must not bring the account back as one that needs
-- reconnecting. So a "lost" event for a channel we don't have is skipped; "connected" still adds a new one.
-- Everything else is as in 007_social.sql: an older event never replaces a newer one. Server only.
create or replace function public.save_social_channel(p_ws uuid, p_channel text, p_network text, p_name text, p_status text, p_at timestamptz)
returns boolean language sql set search_path = '' as $$
  with saved as (
    insert into public.social_channels as c (workspace_id, channel_id, network, name, status, updated_at)
    select p_ws, p_channel, p_network, coalesce(p_name, ''), p_status, p_at
     where p_status = 'connected'
        or exists (select 1 from public.social_channels k where k.workspace_id = p_ws and k.channel_id = p_channel)
    on conflict (workspace_id, channel_id) do update
      set network = excluded.network, name = excluded.name, status = excluded.status, updated_at = excluded.updated_at
      where c.updated_at <= excluded.updated_at
    returning 1
  )
  select exists (select 1 from saved)
$$;
revoke execute on function public.save_social_channel(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_social_channel(uuid, text, text, text, text, timestamptz) to service_role;
