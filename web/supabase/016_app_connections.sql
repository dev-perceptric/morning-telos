-- Morning Telos migration 016: the customer's own apps, connected through Composio.
-- Run once in Supabase → SQL Editor, after 015_internal_plan.sql. Safe to run again.
-- Copied from Omniscient's 137_composio.sql and trimmed: Morning Telos has only the team's apps (one connection per
-- workspace and app), no personal ones and no app settings.
--
-- Composio keeps each connection's sign-in and refreshes it. We keep only the connected account's id, which reaches
-- nothing without the server's COMPOSIO_API_KEY. Every connection belongs to the workspace's own Composio user
-- (mt_<workspace id>, src/lib/composio/composio.ts), and the server checks that before it saves or uses one, so one
-- customer can never use another's connection.
--
-- Who can do what:
--   app_connections  members read which apps are connected, their status and the account's label (like the
--                    connected email). They never read the Composio account id. Nobody writes from the browser: owners
--                    and admins connect and disconnect through the server routes (src/app/api/apps), which save with
--                    the service role.
--
-- The toolkit list matches TOOLKITS in src/lib/composio/catalog.ts. tests/apps.test.ts fails when they drift.

-- status: active (works), reconnect (Composio says the sign-in is gone: the person connects it again).
create table if not exists public.app_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  toolkit text not null check (toolkit in ('gmail', 'outlook', 'googlecalendar', 'calendly', 'hubspot', 'pipedrive', 'salesforce', 'slack', 'zendesk', 'help_scout')),
  composio_account text not null check (composio_account ~ '^[A-Za-z0-9_-]{4,100}$'),
  status text not null default 'active' check (status in ('active', 'reconnect')),
  account_label text check (account_label is null or char_length(account_label) between 1 and 200),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists app_connections_ws_toolkit_idx on public.app_connections (workspace_id, toolkit);
alter table public.app_connections enable row level security;
revoke all on public.app_connections from anon, authenticated;
-- Labels and status only: the Composio account id and the last error stay on the server.
grant select (id, workspace_id, toolkit, status, account_label, connected_by, created_at, updated_at) on public.app_connections to authenticated;

drop policy if exists "app connections read" on public.app_connections;
create policy "app connections read" on public.app_connections for select using (public.has_role(workspace_id, 'viewer'));
