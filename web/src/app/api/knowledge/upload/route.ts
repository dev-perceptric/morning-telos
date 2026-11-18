import { cleanDoc, UPLOAD_MAX_BYTES } from "@/lib/knowledge";
import { readUpload } from "@/lib/fileText";
import { roleGate } from "@/lib/serverAuth";

// Add a .txt, .md, .csv or .pdf file to Knowledge (editors and up). Form fields: workspaceId, file, and agent
// (empty for everyone). A text file is saved as it is; a PDF's text is pulled out on the server. Long files are cut
// to 50,000 characters and the answer says so. The doc is saved as the caller, so row level security checks the
// role and the workspace a second time.
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // Turn away a body that is clearly too big before reading it. 64 KB is room for the other form fields.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > UPLOAD_MAX_BYTES + 64 * 1024) return fail("That file is too big. Files can be up to 5 MB.", 413);
  const form = await request.formData().catch(() => null);
  if (!form) return fail("Choose a file to upload.");
  const ws = form.get("workspaceId");
  const { gate, client } = roleGate(request, ws);
  const who = await gate("editor");
  if (!who.ok) return fail(who.error, who.status);

  const file = form.get("file");
  if (!file || typeof file === "string") return fail("Choose a file to upload.");
  if (file.size > UPLOAD_MAX_BYTES) return fail("That file is too big. Files can be up to 5 MB.", 413);
  const read = await readUpload(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!read.ok) return fail(read.error);
  const doc = cleanDoc({ title: read.title, body: read.text, agent: form.get("agent") });
  if (!doc.ok) return fail(doc.error);

  try {
    const { data, error } = await client()
      .from("knowledge_docs")
      .insert({ workspace_id: ws, ...doc.value, source: "file" })
      .select("id, title, body, agent, source, source_url, updated_at")
      .single();
    if (error) return fail(/200 docs/.test(error.message) ? error.message : /row-level security|permission denied/.test(error.message) ? "You need editor access in this workspace to do that." : "We couldn't save the file. Try again.", /200 docs/.test(error.message) ? 400 : 500);
    return Response.json({ doc: data, cut: read.cut, note: read.note }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("We couldn't save the file. Try again.", 500);
  }
}
