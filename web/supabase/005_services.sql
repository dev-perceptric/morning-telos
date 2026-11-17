-- Each workspace's brand in Arrowsterr and in Capybaroar, and the sealed brand key Morning Telos uses for it.
-- Run once in Supabase → SQL Editor, after 004_members.sql.
--
-- services is server only: RLS on, no policies, no table rights for the API roles. Brand keys are sealed with
-- AES-256-GCM (web/src/lib/sealing.ts) before they are stored, bound to the workspace and product.
-- Members see only each product's status, through service_status().

create table if not exists public.services (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product text not null check (product in ('arrowsterr', 'capybaroar')),
  brand_id text,
  sealed_key text,
  key_prefix text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'removing', 'removed')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, product)
);
alter table public.services enable row level security; -- no policies: server only
revoke all on public.services from anon, authenticated;

-- What a member may know about their workspace's services: which product, its status, and when it changed.
-- Never the brand id or key. Returns no rows for a workspace the caller isn't in.
create or replace function public.service_status(ws uuid)
returns table (product text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.product, s.status, s.updated_at
    from public.services s
   where s.workspace_id = ws and public.has_role(ws, 'viewer')
   order by s.product
$$;
revoke execute on function public.service_status(uuid) from public, anon;
grant execute on function public.service_status(uuid) to authenticated;
