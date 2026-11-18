-- Morning Telos migration 020: Hephaestus on the owner's own WordPress site, and Shopify in the app list.
-- Run once in Supabase → SQL Editor, after 019_website_builders.sql. Safe to run again.
--
-- A self-hosted WordPress site isn't connected through Composio. The owner types the site's address on Settings,
-- Apps, WordPress's own Approve screen makes an Application Password named "Morning Telos", and WordPress sends it to
-- our callback (src/app/api/apps/wordpress/callback). The server seals it with SEALING_KEYS (src/lib/sealing.ts,
-- AAD "<workspace id>:wordpress") and calls the site's REST API with it (src/lib/wordpress).
--
-- Who can do what:
--   wordpress_sites   members read which site is connected, the WordPress user and whether it works. Nobody writes
--                     from the browser: owners and admins connect and disconnect through the server routes, which
--                     save with the service role (save_wordpress).
--   wordpress_logins  server only (row level security on, no policies): the sealed password and the REST address.
--                     It goes with its wordpress_sites row, so a disconnect or a deleted workspace removes it.

-- status: active (works), reconnect (WordPress no longer takes the login: the owner connects it again).
create table if not exists public.wordpress_sites (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  site_url text not null check (site_url ~ '^https://[^\s/?#]+(/[^\s?#]*)?$' and char_length(site_url) <= 300),
  user_login text not null check (char_length(user_login) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'reconnect')),
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wordpress_sites enable row level security;
revoke all on public.wordpress_sites from anon, authenticated;
grant select on public.wordpress_sites to authenticated;

drop policy if exists "wordpress sites read" on public.wordpress_sites;
create policy "wordpress sites read" on public.wordpress_sites for select using (public.has_role(workspace_id, 'viewer'));

create table if not exists public.wordpress_logins (
  workspace_id uuid primary key references public.wordpress_sites (workspace_id) on delete cascade,
  api_root text not null check (api_root ~ '^https://[^\s?#]+/wp-json/$' and char_length(api_root) <= 400),
  sealed_password text not null check (sealed_password ~ '^v2\.[A-Za-z0-9_-]{1,32}\.' and char_length(sealed_password) <= 1000),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.wordpress_logins enable row level security;
revoke all on public.wordpress_logins from anon, authenticated;

-- Save a new connection, or replace the workspace's old one, in one step. Server only.
create or replace function public.save_wordpress(p_ws uuid, p_site text, p_login text, p_api text, p_sealed text, p_by uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wordpress_sites (workspace_id, site_url, user_login, status, connected_by)
  values (p_ws, p_site, p_login, 'active', p_by)
  on conflict (workspace_id) do update
    set site_url = excluded.site_url, user_login = excluded.user_login, status = 'active', connected_by = excluded.connected_by, updated_at = now();
  insert into public.wordpress_logins (workspace_id, api_root, sealed_password)
  values (p_ws, p_api, p_sealed)
  on conflict (workspace_id) do update
    set api_root = excluded.api_root, sealed_password = excluded.sealed_password, last_error = null, updated_at = now();
end $$;
revoke execute on function public.save_wordpress(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.save_wordpress(uuid, text, text, text, text, uuid) to service_role;

-- Shopify joins the website builders (through Composio). The list matches TOOLKITS in src/lib/composio/catalog.ts;
-- tests/apps.test.ts fails when they drift. Who reads app_connections and how stays as 016 set it.
alter table public.app_connections drop constraint if exists app_connections_toolkit_check;
alter table public.app_connections add constraint app_connections_toolkit_check check (toolkit in ('gmail', 'outlook', 'googlecalendar', 'calendly', 'hubspot', 'pipedrive', 'salesforce', 'slack', 'zendesk', 'help_scout', 'framer', 'webflow', 'wordpress_com', 'shopify'));
