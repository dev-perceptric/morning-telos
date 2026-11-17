-- Login security. Run once in Supabase → SQL Editor, after schema.sql. Only the server and Supabase Auth use these tables.
--
-- 1. auth_attempts: the /api/auth/signin route counts wrong passwords here and pauses sign-in
--    after 5 for one email from one address, 20 from one address, or 30 for one email in an hour.
-- 2. auth_failures and the hooks: lock an account for 15 minutes after 5 wrong passwords, inside Supabase Auth,
--    so calling Supabase directly can't get around it. Turn them on in Supabase: Authentication, Hooks,
--    "Password verification attempt" and "MFA verification attempt", Postgres, schema public, the matching function.
-- (Copied from Arrowsterr's 090_auth_security.sql and 097_auth_attempt_hooks.sql.)

create table if not exists public.auth_attempts (
  id bigserial primary key,
  email text not null,
  ip text not null default '',
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_email_idx on public.auth_attempts (email, created_at desc);
create index if not exists auth_attempts_ip_idx on public.auth_attempts (ip, created_at desc);
alter table public.auth_attempts enable row level security; -- no policies: server only

create table if not exists public.auth_failures (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists auth_failures_user_idx on public.auth_failures (user_id, kind, at desc);
alter table public.auth_failures enable row level security; -- no policies: Supabase Auth only

create or replace function public.auth_attempt_decision(p_user uuid, p_kind text, p_valid boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  wrong int;
begin
  select count(*) into wrong from public.auth_failures
    where user_id = p_user and kind = p_kind and at > now() - interval '15 minutes';
  if wrong >= 5 then
    return jsonb_build_object('decision', 'reject', 'message', 'Too many wrong tries. Wait 15 minutes, or reset your password.', 'should_logout_user', false);
  end if;
  if p_valid then
    delete from public.auth_failures where user_id = p_user and kind = p_kind;
  else
    insert into public.auth_failures (user_id, kind) values (p_user, p_kind);
    delete from public.auth_failures where at < now() - interval '1 day';
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.auth_attempt_decision((event->>'user_id')::uuid, 'password', (event->>'valid')::boolean);
end;
$$;

create or replace function public.hook_mfa_verification_attempt(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.auth_attempt_decision((event->>'user_id')::uuid, 'mfa', (event->>'valid')::boolean);
end;
$$;

-- Only Supabase Auth may call these.
revoke execute on function public.auth_attempt_decision(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
revoke execute on function public.hook_mfa_verification_attempt(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
grant execute on function public.auth_attempt_decision(uuid, text, boolean) to supabase_auth_admin;
grant select, insert, delete on public.auth_failures to supabase_auth_admin;
