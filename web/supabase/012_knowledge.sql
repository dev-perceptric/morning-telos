-- Morning Telos migration 012: the business brain. Knowledge docs, word search, and reading the customer's website.
-- Run once in Supabase → SQL Editor, after 011_ai_team.sql (or after 010_expire_trials.sql). Safe to run again.
-- Copied from the old app's knowledge table (app/lib/db.js) and Omniscient's 018_knowledge.sql and
-- 121_semantic_search.sql (hybrid_search), with words only for now.
--
-- Every teammate reads these docs before it works (src/lib/knowledgeServer.ts, knowledgeForPrompt). A doc with no
-- agent is for everyone; one with an agent key ('social', 'seo', ...) is only for that teammate.
-- Members read, editors and up add, change and delete. The doc made from the website is saved by the server only.
--
-- Search is Postgres full-text search (tsvector + ts_rank_cd), with a plain text match when the words find nothing
-- (names, codes, part of a word). search_knowledge() keeps the same answer shape when embeddings (Voyage + pgvector,
-- like Omniscient's search_chunks) are added later, so callers don't change.
--
-- The website scan: a scan_website job (src/lib/siteScan.ts) is queued when a workspace is made with a website, when
-- its website changes, and when an editor presses "Scan my website again" (rescan_website). It reads the home page
-- and up to 5 of its pages and saves one "About <business>" doc with source 'website'. Scanning again replaces it.

-- ─────────────── knowledge_docs ───────────────
create table if not exists public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 50000),
  agent text check (agent is null or agent ~ '^[a-z][a-z0-9_]{0,39}$'),
  source text not null default 'manual' check (source in ('manual', 'website', 'file')),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored
);
create index if not exists knowledge_docs_ws_idx on public.knowledge_docs (workspace_id, updated_at desc);
create index if not exists knowledge_docs_words_idx on public.knowledge_docs using gin (tsv);
-- One doc made from the website per workspace. save_website_doc() replaces it.
create unique index if not exists knowledge_docs_one_website on public.knowledge_docs (workspace_id) where source = 'website';

alter table public.knowledge_docs enable row level security;
-- People write only these columns. created_by comes from the sign-in, and source 'website' only from the server.
revoke all on public.knowledge_docs from anon;
revoke insert, update on public.knowledge_docs from authenticated;
grant select, delete on public.knowledge_docs to authenticated;
grant insert (workspace_id, title, body, agent, source, source_url) on public.knowledge_docs to authenticated;
grant update (title, body, agent) on public.knowledge_docs to authenticated;

drop policy if exists "knowledge read" on public.knowledge_docs;
drop policy if exists "knowledge add" on public.knowledge_docs;
drop policy if exists "knowledge edit" on public.knowledge_docs;
drop policy if exists "knowledge delete" on public.knowledge_docs;
create policy "knowledge read" on public.knowledge_docs for select using (public.has_role(workspace_id, 'viewer'));
create policy "knowledge add" on public.knowledge_docs for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid() and source in ('manual', 'file'));
create policy "knowledge edit" on public.knowledge_docs for update
  using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "knowledge delete" on public.knowledge_docs for delete using (public.has_role(workspace_id, 'editor'));

-- updated_at follows every change, so the newest docs come first and the list shows when each one changed.
create or replace function public.knowledge_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.knowledge_touch() from public, anon, authenticated;
drop trigger if exists knowledge_docs_touch on public.knowledge_docs;
create trigger knowledge_docs_touch before update on public.knowledge_docs for each row execute function public.knowledge_touch();

-- At most 200 docs per workspace (the old app's limit). The website doc doesn't count: there is only ever one.
create or replace function public.knowledge_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source <> 'website' and (select count(*) from public.knowledge_docs d where d.workspace_id = new.workspace_id and d.source <> 'website') >= 200 then
    raise exception 'You can have up to 200 docs. Delete some to add more.';
  end if;
  return new;
end;
$$;
revoke execute on function public.knowledge_limit() from public, anon, authenticated;
drop trigger if exists knowledge_docs_limit on public.knowledge_docs;
create trigger knowledge_docs_limit before insert on public.knowledge_docs for each row execute function public.knowledge_limit();

-- ─────────────── search ───────────────
-- The best n docs for a question in one workspace, as the person asking (security invoker), so row level security
-- decides what comes back. rank 1 and up: the words matched (title words count more than body words). Below 1:
-- only a plain text match (0.5 in the title, 0.25 in the body). The snippet is plain text around the match.
create or replace function public.search_knowledge(ws uuid, q text, n int default 8)
returns table (id uuid, title text, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  with ask as (
    select websearch_to_tsquery('english', left(coalesce(q, ''), 500)) as tq,
           nullif(btrim(left(coalesce(q, ''), 200)), '') as raw
  ),
  pattern as (
    select '%' || replace(replace(replace(a.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' as p from ask a
  ),
  words as (
    select d.id, (1 + ts_rank_cd(d.tsv, a.tq, 32))::real as rank
      from public.knowledge_docs d, ask a
     where d.workspace_id = ws and a.raw is not null and d.tsv @@ a.tq
  ),
  loose as (
    select d.id, (case when d.title ilike p.p then 0.5 else 0.25 end)::real as rank
      from public.knowledge_docs d, ask a, pattern p
     where d.workspace_id = ws and a.raw is not null and (d.title ilike p.p or d.body ilike p.p)
       and not exists (select 1 from words w where w.id = d.id)
  ),
  best as (
    select x.id, x.rank from (select * from words union all select * from loose) x
     order by x.rank desc
     limit greatest(1, least(coalesce(n, 8), 50))
  )
  select d.id, d.title,
         case
           when b.rank >= 1 then ts_headline('english', left(d.body, 20000), a.tq,
             'StartSel="",StopSel="",MaxWords=35,MinWords=12,MaxFragments=2,FragmentDelimiter=" ... "')
           when strpos(lower(d.body), lower(a.raw)) > 0 then
             btrim(substr(d.body, greatest(1, strpos(lower(d.body), lower(a.raw)) - 80), 240))
           else left(d.body, 200)
         end as snippet,
         b.rank
    from best b join public.knowledge_docs d on d.id = b.id, ask a
   order by b.rank desc, d.updated_at desc
$$;
revoke execute on function public.search_knowledge(uuid, text, int) from public, anon;
grant execute on function public.search_knowledge(uuid, text, int) to authenticated, service_role;

-- ─────────────── the website doc (server only) ───────────────
-- Saves the doc made from the website, replacing the one from the last scan.
create or replace function public.save_website_doc(ws uuid, p_title text, p_body text, p_url text)
returns uuid language sql set search_path = '' as $$
  insert into public.knowledge_docs as d (workspace_id, title, body, source, source_url, created_by)
  values (ws, left(btrim(p_title), 200), left(coalesce(p_body, ''), 50000), 'website', left(p_url, 2000), null)
  on conflict (workspace_id) where source = 'website'
  do update set title = excluded.title, body = excluded.body, source_url = excluded.source_url
  returning d.id;
$$;
revoke execute on function public.save_website_doc(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_website_doc(uuid, text, text, text) to service_role;

-- ─────────────── queueing the website scan ───────────────
-- One waiting scan per workspace is enough. A scan running right now may have read the old website, so it doesn't count.
create or replace function public.queue_website_scan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(new.website), '') = '' then return new; end if;
  if not exists (
    select 1 from public.jobs j
     where j.kind = 'scan_website' and j.workspace_id = new.id and j.done_at is null and j.attempts < j.max_attempts
       and (j.locked_until is null or j.locked_until < now())
  ) then
    insert into public.jobs (kind, workspace_id, max_attempts) values ('scan_website', new.id, 3);
  end if;
  return new;
end;
$$;
revoke execute on function public.queue_website_scan() from public, anon, authenticated;
drop trigger if exists workspaces_scan_website on public.workspaces;
create trigger workspaces_scan_website after insert on public.workspaces
  for each row when (coalesce(btrim(new.website), '') <> '') execute function public.queue_website_scan();
drop trigger if exists workspaces_website_rescan on public.workspaces;
create trigger workspaces_website_rescan after update of website on public.workspaces
  for each row when (new.website is distinct from old.website and coalesce(btrim(new.website), '') <> '')
  execute function public.queue_website_scan();

-- "Scan my website again" (editors and up). True when a scan was queued, false when one is already waiting.
-- A scan started in the last 2 minutes is enough, so pressing the button again doesn't pay for another one.
create or replace function public.rescan_website(ws uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare site text;
begin
  if not public.has_role(ws, 'editor') then raise exception 'You need editor access in this workspace to do that.'; end if;
  select w.website into site from public.workspaces w where w.id = ws;
  if coalesce(btrim(site), '') = '' then raise exception 'Add your website in Settings first.'; end if;
  if exists (
    select 1 from public.jobs j
     where j.kind = 'scan_website' and j.workspace_id = ws
       and ((j.done_at is null and j.attempts < j.max_attempts) or j.created_at > now() - interval '2 minutes')
  ) then
    return false;
  end if;
  insert into public.jobs (kind, workspace_id, max_attempts) values ('scan_website', ws, 3);
  return true;
end;
$$;
revoke execute on function public.rescan_website(uuid) from public, anon;
grant execute on function public.rescan_website(uuid) to authenticated;

-- Where the latest website scan is, for the Knowledge page: queued, running, done or failed (never the error text,
-- which is for staff). No rows before the first scan, or for a workspace the caller isn't in.
create or replace function public.website_scan_status(ws uuid)
returns table (status text, finished_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select case
           when j.done_at is not null then 'done'
           when j.attempts >= j.max_attempts then 'failed'
           when j.locked_until is not null and j.locked_until > now() then 'running'
           else 'queued'
         end,
         j.done_at
    from public.jobs j
   where j.kind = 'scan_website' and j.workspace_id = ws and public.has_role(ws, 'viewer')
   order by j.created_at desc, j.id desc
   limit 1
$$;
revoke execute on function public.website_scan_status(uuid) from public, anon;
grant execute on function public.website_scan_status(uuid) to authenticated;

-- Workspaces made before this file that have a website: one scan each, once.
insert into public.jobs (kind, workspace_id, max_attempts)
select 'scan_website', w.id, 3 from public.workspaces w
 where coalesce(btrim(w.website), '') <> ''
   and not exists (select 1 from public.jobs j where j.kind = 'scan_website' and j.workspace_id = w.id);
