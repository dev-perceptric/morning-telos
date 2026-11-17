-- Morning Telos migration 008: closing a workspace's brands when it is deleted or its subscription ends.
-- Run once in Supabase → SQL Editor, after 007_social.sql. Safe to run again.
--
-- On delete or cancel the server revokes each brand key at once and queues remove_brand for 30 days later
-- (src/lib/closeout.ts). A deleted workspace's rows are gone by then, so those jobs carry what they need in their
-- payload and must outlive the workspace: jobs.workspace_id becomes null instead of deleting the job.

do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.jobs'::regclass and con.contype = 'f' and con.confrelid = 'public.workspaces'::regclass
  loop
    execute format('alter table public.jobs drop constraint %I', c);
  end loop;
end $$;
alter table public.jobs add constraint jobs_workspace_id_fkey foreign key (workspace_id) references public.workspaces (id) on delete set null;

-- Finding a workspace's waiting revoke_keys and remove_brand jobs, to cancel them when the subscription comes back.
create index if not exists jobs_pending_kind_idx on public.jobs (kind, workspace_id) where done_at is null;
