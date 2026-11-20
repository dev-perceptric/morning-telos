// Sending files from the message box, as the signed-in person: a file attached to a message (POST /api/chat/files)
// and a file saved to Knowledge (POST /api/knowledge/upload, the same route as the Knowledge page). `fetch` comes in
// as a parameter, so tests use a fake and nothing leaves the test.
import type { StoredFile } from "./attachments.ts";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

async function postForm<T>(f: Fetch, url: string, token: string | null, fields: Record<string, string | Blob>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await f(url, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }).catch(() => null);
  if (!res) throw new Error(OFFLINE);
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error || "Something went wrong. Try again.");
  return out;
}

/** Uploads one file for a chat message. Returns where it is kept; the message sends that with it. */
export async function attachFile(token: string | null, workspaceId: string, file: File, f: Fetch = fetch): Promise<StoredFile> {
  const out = await postForm<{ file?: StoredFile }>(f, "/api/chat/files", token, { workspaceId, file });
  if (!out.file?.path) throw new Error("We couldn't upload that file. Try again.");
  return out.file;
}

/** The one line the chat shows after a file is saved to Knowledge. */
export const savedLine = (title: string, note?: string | null) => `Saved "${title}" to Knowledge. Your team will use it from now on.${note ? ` ${note}` : ""}`;

/** Saves a file to Knowledge for everyone on the team. Returns the line to show. */
export async function saveToKnowledge(token: string | null, workspaceId: string, file: File, f: Fetch = fetch): Promise<string> {
  const out = await postForm<{ doc?: { title?: string }; note?: string | null }>(f, "/api/knowledge/upload", token, { workspaceId, file, agent: "" });
  return savedLine(out.doc?.title || file.name, out.note);
}
