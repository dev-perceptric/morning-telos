-- Morning Telos migration 021: the workspace's brand, so chat answers look like the business and the team writes in
-- its tone. Run once in Supabase → SQL Editor, after 020_wordpress.sql. Safe to run again.
-- Copied from Omniscient's brand kit (051_studio.sql, brand_kits), with columns in place of one JSON kit so the
-- database checks each value.
--
-- The website scan (scan_website, src/lib/siteScan.ts and src/lib/brandScan.ts) learns the colors, fonts, logo and
-- tone from the home page and saves them with save_site_brand (server only). A site with nothing usable gets no row,
-- and the app uses the Morning Telos look. Owners and admins change any value in Settings, General, Brand: the row
-- then says source 'manual', and later scans leave it alone until someone presses "Read my website again"
-- (rescan_brand), which hands it back to the website.
--
-- Who can do what:
--   brand_kits   members read (the chat screen styles answers with it). Owners and admins add, change and delete.
--                Source, who changed it and when are set here, never by the browser.

create table if not exists public.brand_kits (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  -- Font names as Google Fonts spells them: answers only load fonts from there.
  heading_font text check (heading_font is null or heading_font ~ '^[A-Za-z0-9 ]{2,60}$'),
  body_font text check (body_font is null or body_font ~ '^[A-Za-z0-9 ]{2,60}$'),
  logo_url text check (logo_url is null or (logo_url ~ '^https://[^\s]+$' and char_length(logo_url) <= 2000)),
  tone text check (tone is null or (char_length(btrim(tone)) between 1 and 80 and tone !~ '[\r\n]')),
  source text not null default 'manual' check (source in ('website', 'manual')),
  use_brand boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_kits enable row level security;
revoke all on public.brand_kits from anon, authenticated;
grant select, delete on public.brand_kits to authenticated;
grant insert (workspace_id, primary_color, accent_color, heading_font, body_font, logo_url, tone, use_brand) on public.brand_kits to authenticated;
grant update (primary_color, accent_color, heading_font, body_font, logo_url, tone, use_brand) on public.brand_kits to authenticated;

drop policy if exists "brand read" on public.brand_kits;
drop policy if exists "brand add" on public.brand_kits;
drop policy if exists "brand edit" on public.brand_kits;
drop policy if exists "brand delete" on public.brand_kits;
create policy "brand read" on public.brand_kits for select using (public.has_role(workspace_id, 'viewer'));
create policy "brand add" on public.brand_kits for insert with check (public.has_role(workspace_id, 'admin'));
create policy "brand edit" on public.brand_kits for update
  using (public.has_role(workspace_id, 'admin')) with check (public.has_role(workspace_id, 'admin'));
create policy "brand delete" on public.brand_kits for delete using (public.has_role(workspace_id, 'admin'));

-- A change by a person (signed in) is theirs: source 'manual' when a brand value changed, and who and when. Turning
-- "Use my brand in answers" on or off alone keeps the source, so the next scan still updates a website brand.
create or replace function public.brand_kits_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    if tg_op = 'INSERT' then
      new.source := 'manual';
    elsif (new.primary_color, new.accent_color, new.heading_font, new.body_font, new.logo_url, new.tone)
          is distinct from (old.primary_color, old.accent_color, old.heading_font, old.body_font, old.logo_url, old.tone) then
      new.source := 'manual';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.brand_kits_touch() from public, anon, authenticated;
drop trigger if exists brand_kits_touch on public.brand_kits;
create trigger brand_kits_touch before insert or update on public.brand_kits for each row execute function public.brand_kits_touch();

-- ─────────────── the brand from the website (server only) ───────────────
-- Saves what a scan found, as the website's brand. A brand people changed is kept. p_brand null (the site shows no
-- usable brand any more) removes a website brand. A new row starts with use_brand on; an old one keeps its switch.
create or replace function public.save_site_brand(ws uuid, p_brand jsonb)
returns text language plpgsql set search_path = '' as $$
declare cur text;
begin
  select b.source into cur from public.brand_kits b where b.workspace_id = ws;
  if cur = 'manual' then return 'kept'; end if;
  if p_brand is null or jsonb_typeof(p_brand) <> 'object' then
    delete from public.brand_kits b where b.workspace_id = ws and b.source = 'website';
    return 'removed';
  end if;
  insert into public.brand_kits as b (workspace_id, primary_color, accent_color, heading_font, body_font, logo_url, tone, source)
  values (ws, p_brand->>'primary', p_brand->>'accent', p_brand->>'headingFont', p_brand->>'bodyFont', p_brand->>'logoUrl',
          nullif(btrim(left(p_brand->>'tone', 80)), ''), 'website')
  on conflict (workspace_id) do update set
    primary_color = excluded.primary_color, accent_color = excluded.accent_color, heading_font = excluded.heading_font,
    body_font = excluded.body_font, logo_url = excluded.logo_url, tone = excluded.tone, source = 'website'
  where b.source = 'website';
  return 'saved';
end;
$$;
revoke execute on function public.save_site_brand(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_site_brand(uuid, jsonb) to service_role;

-- "Read my website again" (owners and admins): the brand goes back to the website and a scan is queued, the same way
-- as "Scan my website again" (rescan_website, 012_knowledge.sql). True when a scan was queued, false when one waits.
create or replace function public.rescan_brand(ws uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(ws, 'admin') then raise exception 'You need admin access in this workspace to do that.'; end if;
  update public.brand_kits b set source = 'website' where b.workspace_id = ws;
  return public.rescan_website(ws);
end;
$$;
revoke execute on function public.rescan_brand(uuid) from public, anon;
grant execute on function public.rescan_brand(uuid) to authenticated;

-- ─────────────── workspaces made before this file ───────────────
-- One learn_brand job each for workspaces with a website and no brand yet: the home page only, no Claude call, and
-- Knowledge isn't touched (src/lib/brandScan.ts). One try: if it fails, the next website scan learns the brand.
insert into public.jobs (kind, workspace_id, max_attempts)
select 'learn_brand', w.id, 1 from public.workspaces w
 where coalesce(btrim(w.website), '') <> ''
   and not exists (select 1 from public.brand_kits b where b.workspace_id = w.id)
   and not exists (select 1 from public.jobs j where j.kind = 'learn_brand' and j.workspace_id = w.id);
