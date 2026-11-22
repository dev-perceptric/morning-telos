-- ─────────────── work_cache ───────────────
-- What a teammate's work tab last read from one of our products, so a screen doesn't call the product on every visit.
-- Theseus's Visibility tab (src/lib/seoWork.ts) reads Arrowsterr at most once a day: each read uses one of our
-- Arrowsterr tasks, and Arrowsterr only checks the AI tools once a day anyway. A change made on the tab clears it.
-- Server only: RLS on, no policies. The routes read it with the server key after checking the person's role.
create table if not exists public.work_cache (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text not null check (agent in ('chief', 'sales', 'support', 'forms', 'email', 'social', 'seo', 'web')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 2000000),
  fetched_at timestamptz not null default now(),
  primary key (workspace_id, agent)
);
alter table public.work_cache enable row level security;
revoke all on public.work_cache from anon, authenticated;
