-- Morning Telos migration 009: Arrowsterr waits for the customer's website.
-- Run once in Supabase → SQL Editor, after 008_cancel.sql. Safe to run again.
--
-- Arrowsterr's partner API needs a brand's website domain. A workspace with no website gets its Arrowsterr service
-- set to 'waiting' by the provision job (src/lib/provision.ts), with no call to Arrowsterr. The Home card asks for
-- the website. When someone adds it in Settings, the trigger below sets the service pending and queues provision.

-- ─────────────── 'waiting': needs something from the customer first ───────────────
alter table public.services drop constraint if exists services_status_check;
alter table public.services add constraint services_status_check
  check (status in ('pending', 'waiting', 'ready', 'failed', 'removing', 'removed'));

-- ─────────────── adding the website starts Arrowsterr's setup ───────────────
create or replace function public.website_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(new.website), '') = '' then return new; end if;
  update public.services set status = 'pending', last_error = null, updated_at = now()
   where workspace_id = new.id and product = 'arrowsterr' and status = 'waiting';
  if found and not exists (
    select 1 from public.jobs j where j.kind = 'provision' and j.workspace_id = new.id and j.done_at is null and j.attempts < j.max_attempts
       and (j.locked_until is null or j.locked_until < now()) -- one running now may have read the old website
  ) then
    insert into public.jobs (kind, workspace_id) values ('provision', new.id);
  end if;
  return new;
end;
$$;
revoke execute on function public.website_added() from public, anon, authenticated;
drop trigger if exists workspaces_website_added on public.workspaces;
create trigger workspaces_website_added after update of website on public.workspaces
  for each row when (new.website is distinct from old.website) execute function public.website_added();
