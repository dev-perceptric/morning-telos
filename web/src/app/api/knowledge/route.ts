import { cleanDoc } from "@/lib/knowledge";
import { preflight, refuseOtherExtension, withCors } from "@/lib/cors";
import { capText, cleanText, isBlockedUrl, URL_MAX } from "@/lib/pageContext";
import { roleGate } from "@/lib/serverAuth";

// Add a text doc to Knowledge (editors and up). Body: { workspaceId, title, body, sourceUrl?, agent? }. The Chrome
// extension's "Save to Knowledge" (selected text) and "Save this page to Knowledge" use it, with the page's address
// as sourceUrl. The doc is saved as the caller, so row level security checks the role and the workspace a second
// time, the same as the Knowledge screen (supabase/012_knowledge.sql). Long text is cut to 50,000 characters.
// Only the extension's origin gets CORS (src/lib/cors.ts).
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export const OPTIONS = (request: Request) => preflight(request);

export async function POST(request: Request) {
  const refused = refuseOtherExtension(request);
  if (refused) return refused;
  return withCors(request, await save(request));
}

async function save(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate, client } = roleGate(request, b.workspaceId);
  const who = await gate("editor");
  if (!who.ok) return fail(who.error, who.status);

  let sourceUrl: string | null = null;
  if (b.sourceUrl !== undefined && b.sourceUrl !== null && b.sourceUrl !== "") {
    const u = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
    if (!u || u.length > URL_MAX || isBlockedUrl(u)) return fail("That page can't be saved to Knowledge.");
    sourceUrl = u;
  }
  const body = capText(cleanText(b.body), 50_000);
  if (!body) return fail("There is no text to save.");
  const doc = cleanDoc({ title: capText(cleanText(b.title).replace(/\s+/g, " "), 200) || (sourceUrl ? new URL(sourceUrl).hostname : ""), body, agent: b.agent });
  if (!doc.ok) return fail(doc.error);

  try {
    const { data, error } = await client()
      .from("knowledge_docs")
      .insert({ workspace_id: b.workspaceId, ...doc.value, source: "manual", source_url: sourceUrl })
      .select("id, title, body, agent, source, source_url, updated_at")
      .single();
    if (error) return fail(/200 docs/.test(error.message) ? error.message : /row-level security|permission denied/.test(error.message) ? "You need editor access in this workspace to do that." : "We couldn't save that. Try again.", /200 docs/.test(error.message) ? 400 : /row-level security|permission denied/.test(error.message) ? 403 : 500);
    return Response.json({ doc: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("We couldn't save that. Try again.", 500);
  }
}
