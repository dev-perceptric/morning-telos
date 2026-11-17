-- Workspace settings, members and invites (P1.5). Run once in Supabase → SQL Editor, after 003_auth_security.sql.
--
-- 1. Admins may change a member's role and nothing else on that row (not their email, user or workspace).
-- 2. accept_invite() says exactly what is wrong with a link: revoked, used, expired or for another email.
--    Opening a link you already used just takes you back to that workspace.
-- 3. A time zone must be a short name like America/Chicago.

revoke update on public.workspace_members from authenticated, anon;
grant update (role) on public.workspace_members to authenticated;

alter table public.workspaces drop constraint if exists workspaces_timezone_check;
alter table public.workspaces add constraint workspaces_timezone_check check (char_length(timezone) between 1 and 64);

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.workspace_invites;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into inv from public.workspace_invites where token = p_token;
  if inv.id is null then
    raise exception 'This invite link does not work. It may have been cancelled. Ask for a new one.';
  end if;
  if inv.accepted_at is not null then
    -- The same person opening their link again just goes back to the workspace.
    if exists (select 1 from public.workspace_members m where m.workspace_id = inv.workspace_id and m.user_id = auth.uid()) then
      return inv.workspace_id;
    end if;
    raise exception 'This invite was already used. Ask for a new one.';
  end if;
  if inv.expires_at <= now() then
    raise exception 'This invite has expired. Ask for a new one.';
  end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite is for %. Sign in with that email to accept it.', inv.email;
  end if;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (inv.workspace_id, auth.uid(), auth.jwt() ->> 'email', inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites set accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
