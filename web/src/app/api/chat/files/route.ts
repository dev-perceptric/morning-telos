import * as Sentry from "@sentry/nextjs";
import { FILE_MAX_BYTES, FILE_MESSAGES } from "@/lib/attachments";
import { saveFile } from "@/lib/attachmentsServer";
import { rateLimiter } from "@/lib/chat";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { NEEDS } from "@/lib/workspace";

// Attach a file to a chat message (editors and up, the same as chatting). Form fields: workspaceId and file.
// Images (PNG, JPG, WebP, GIF, up to 5 MB), PDFs and .txt, .csv or .md files (up to 10 MB). The file is checked by
// its name, size and first bytes, then kept in the private chat-files bucket in this workspace's folder
// (supabase/022_chat_files.sql) by the server. Answers { file: { path, name, kind, type, size } }; the message box
// sends the path with the message (POST /api/chat), which reads the file again before it is used.
export const dynamic = "force-dynamic";

// 5 files on each of 60 messages an hour per workspace.
const limited = rateLimiter(300, 60 * 60 * 1000);

const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "chat-files" } });
}

export async function POST(request: Request) {
  // Turn away a body that is clearly too big before reading it. 64 KB is room for the other form fields.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > FILE_MAX_BYTES + 64 * 1024) return fail(FILE_MESSAGES.tooBig, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return fail("Choose a file to attach.");
  const ws = form.get("workspaceId");
  const { gate } = roleGate(request, ws);
  const who = await gate(NEEDS.chat);
  if (!who.ok) return fail(who.error, who.status);

  const file = form.get("file");
  if (!file || typeof file === "string") return fail("Choose a file to attach.");
  if (file.size > FILE_MAX_BYTES) return fail(FILE_MESSAGES.tooBig, 413);
  const db = adminClient();
  if (!db) return fail("Add SUPABASE_SECRET_KEY to the server's settings.", 500);
  if (limited(ws as string)) return fail(FILE_MESSAGES.tooFast, 429);
  const saved = await saveFile(db, ws as string, file.name, new Uint8Array(await file.arrayBuffer()), log);
  if (!saved.ok) return fail(saved.error, saved.status);
  return Response.json({ file: saved.file }, { headers: { "Cache-Control": "no-store" } });
}
