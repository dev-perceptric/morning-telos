// Chat files in Supabase Storage (the private "chat-files" bucket, supabase/022_chat_files.sql). Server only.
//   saveFile: check an uploaded file and keep it in the workspace's folder.
//   loadFiles: read files back for a turn, checking each one again.
// Both run with the service client, which skips storage's row level security, so every path is checked against the
// workspace here (inWorkspace in src/lib/attachments.ts) before anything is read or written.
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, checkFile, FILE_MESSAGES, filePath, fileText, inWorkspace, looksLike, storedFile, type LoadedFile, type StoredFile } from "./attachments.ts";
import { decodeText } from "./fileText.ts";

type Saved = { ok: true; file: StoredFile } | { ok: false; error: string; status: number };

/** Checks a file by its name, size and first bytes, then keeps it at <workspace>/<random id>/<name>. Never throws. */
export async function saveFile(db: SupabaseClient, workspaceId: string, name: string, bytes: Uint8Array, log?: (m: string) => void): Promise<Saved> {
  const check = checkFile(name, bytes.byteLength);
  if (!check.ok) return { ok: false, error: check.error, status: 400 };
  if (!looksLike(check.type, bytes)) return { ok: false, error: check.kind === "text" ? FILE_MESSAGES.notText : FILE_MESSAGES.wrongInside, status: 400 };
  if (check.kind === "text" && decodeText(bytes) === null) return { ok: false, error: FILE_MESSAGES.notText, status: 400 };
  const path = filePath(workspaceId, randomUUID(), name);
  const file = storedFile(path, bytes.byteLength, workspaceId);
  if (!file) return { ok: false, error: FILE_MESSAGES.type, status: 400 };
  try {
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: check.type, upsert: false });
    if (error) {
      log?.(`A chat file wasn't saved in workspace ${workspaceId}: ${error.message}`);
      return { ok: false, error: FILE_MESSAGES.upload, status: 500 };
    }
  } catch (e) {
    log?.(`A chat file wasn't saved in workspace ${workspaceId}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: FILE_MESSAGES.upload, status: 500 };
  }
  return { ok: true, file };
}

/** Reads one file in this workspace for Claude, or null when it is gone or isn't what its name says. */
async function loadOne(db: SupabaseClient, workspaceId: string, f: StoredFile): Promise<LoadedFile | null> {
  if (!inWorkspace(f.path, workspaceId)) return null;
  const { data, error } = await db.storage.from(BUCKET).download(f.path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const check = checkFile(f.name, bytes.byteLength);
  if (!check.ok || check.type !== f.type || !looksLike(f.type, bytes)) return null;
  const size = bytes.byteLength;
  if (f.kind === "text") {
    const raw = decodeText(bytes);
    if (raw === null) return null;
    return { ...f, size, kind: "text", ...fileText(raw) };
  }
  return { ...f, size, kind: f.kind, data: Buffer.from(bytes).toString("base64") };
}

/** Reads files for a turn, in order. Ones that are gone or wrong are left out. Never throws. */
export async function loadFiles(db: SupabaseClient, workspaceId: string, files: StoredFile[], log?: (m: string) => void): Promise<LoadedFile[]> {
  const out = await Promise.all(
    files.map((f) =>
      loadOne(db, workspaceId, f).catch((e) => {
        log?.(`A chat file didn't load in workspace ${workspaceId}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }),
    ),
  );
  return out.filter((f): f is LoadedFile => f !== null);
}

/**
 * The agent loop's file reader for one turn (TurnDeps.files). Each file is read once, however many teammates answer.
 * `ready`: files the route already read for the new message.
 */
export function fileReader(db: SupabaseClient, workspaceId: string, ready: LoadedFile[] = [], log?: (m: string) => void) {
  const cache = new Map<string, Promise<LoadedFile | null>>(ready.map((f) => [f.path, Promise.resolve(f)]));
  return async (files: StoredFile[]): Promise<LoadedFile[]> => {
    for (const f of files) if (!cache.has(f.path)) cache.set(f.path, loadFiles(db, workspaceId, [f], log).then((r) => r[0] ?? null));
    const got = await Promise.all(files.map((f) => cache.get(f.path)!));
    return got.filter((f): f is LoadedFile => f !== null);
  };
}
