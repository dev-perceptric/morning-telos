-- Morning Telos migration 022: files attached to chat messages. Run once in Supabase → SQL Editor, after
-- 021_brand.sql. Safe to run again.
--
-- The message box's + button (and drag and drop, and pasted images) uploads images, PDFs and text files through
-- POST /api/chat/files. The server keeps each one in the private "chat-files" bucket at
-- <workspace id>/<random id>/<file name> and the person's message lists them in messages.meta.files
-- (src/lib/attachments.ts). The chat route reads them back with the service key and sends them to Claude.
--
-- Who can do what:
--   chat-files   members of the workspace in the first folder of the path read (the chat screen shows the files with
--                a signed link). Nobody writes, changes or deletes through the API: only the server does, with the
--                service key, after checking the file's type, size and first bytes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files',
  'chat-files',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown']
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The workspace a chat file belongs to: the first folder of its path, or null when that isn't a workspace id.
create or replace function public.chat_file_workspace(path text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when split_part(path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(path, '/', 1)::uuid
  end
$$;
grant execute on function public.chat_file_workspace(text) to authenticated;

drop policy if exists "chat files read" on storage.objects;
create policy "chat files read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.has_role(public.chat_file_workspace(name), 'viewer'));
