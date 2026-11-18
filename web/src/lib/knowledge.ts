// The business brain: Knowledge docs every teammate reads before it works (supabase/012_knowledge.sql).
// Pure, so the screens, the server and tests share one set of rules. Copied from the old app's knowledge routes
// (app/server.js) and how it put docs into the system prompt (systemPrompt in app/lib/agents.js).

export const MAX_DOCS = 200;
export const MAX_TITLE = 200;
/** Most characters in one doc. Longer files are cut to this. */
export const MAX_BODY = 50_000;

export type DocSource = "manual" | "website" | "file";
export type KnowledgeDoc = {
  id: string;
  title: string;
  body: string;
  /** null: for everyone on the team. */
  agent: string | null;
  source: DocSource;
  source_url: string | null;
  updated_at: string;
};

/**
 * Who a doc can be for. Keys match the old app's roster (app/lib/agents.js) and the agent loop's agentKey.
 * The four marked soon can't take work yet, but a doc saved for them waits until they can.
 */
export const DOC_AGENTS: { key: string; name: string; job: string }[] = [
  { key: "chief", name: "Athena", job: "Chief of staff" },
  { key: "seo", name: "Artemis", job: "SEO and AI visibility" },
  { key: "web", name: "Hephaestus", job: "Website pages" },
  { key: "social", name: "Aphrodite", job: "Social posts" },
  { key: "email", name: "Iris", job: "Email campaigns" },
  { key: "forms", name: "Hora", job: "Forms and booking" },
  { key: "sales", name: "Hermes", job: "Sales follow-up" },
  { key: "support", name: "Hestia", job: "Customer support" },
];
export const agentName = (key: string | null) => (key ? (DOC_AGENTS.find((a) => a.key === key)?.name ?? key) : "Everyone");

export const SOURCE_LABEL: Record<DocSource, string> = { manual: "Added by hand", website: "From your website", file: "From a file" };

/** The title of the doc the website scan makes. */
export const aboutTitle = (business: string) => `About ${business.trim() || "the business"}`.slice(0, MAX_TITLE);
/** The title of the doc the scan saves when there is no Claude key: the website's own words. */
export const NOTES_TITLE = "Website notes";

/** Text cut to at most `max` characters, at a line or a space when one is close. */
export function capText(text: string, max = MAX_BODY): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  return { text: (at > max - 500 ? head.slice(0, at) : head).trimEnd(), cut: true };
}

/** Check a doc from the form. Returns what to save, or a message to show. */
export function cleanDoc(input: { title?: unknown; body?: unknown; agent?: unknown }): { ok: true; value: { title: string; body: string; agent: string | null } } | { ok: false; error: string } {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "Give the doc a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `The title can be up to ${MAX_TITLE} letters.` };
  const body = String(input.body ?? "").replace(/\r\n?/g, "\n");
  if (body.length > MAX_BODY) return { ok: false, error: "This doc is too long. Split it into two docs." };
  const raw = input.agent === undefined || input.agent === null || input.agent === "" ? null : String(input.agent);
  if (raw !== null && !DOC_AGENTS.some((a) => a.key === raw)) return { ok: false, error: "Pick who uses this doc." };
  return { ok: true, value: { title, body, agent: raw } };
}

// ─────────────── uploads ───────────────

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = [".txt", ".md", ".csv", ".pdf"] as const;
export type UploadKind = "text" | "pdf";

/** Which kind of file this is, by its name, or why it can't be added. Size in bytes. */
export function checkUpload(name: string, size: number): { ok: true; kind: UploadKind } | { ok: false; error: string } {
  const ext = /\.[a-z0-9]+$/i.exec(name.trim())?.[0]?.toLowerCase() ?? "";
  if (!(UPLOAD_TYPES as readonly string[]).includes(ext)) return { ok: false, error: "Upload a .txt, .md, .csv or .pdf file." };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "That file is empty." };
  if (size > UPLOAD_MAX_BYTES) return { ok: false, error: "That file is too big. Files can be up to 5 MB." };
  return { ok: true, kind: ext === ".pdf" ? "pdf" : "text" };
}

/** A doc title from a file name: no folder, no extension, dashes and underscores as spaces. */
export function titleFromFile(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const t = base.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (t || "Uploaded file").slice(0, MAX_TITLE);
}

/** What we tell the person when a file was cut. */
export const CUT_NOTE = `This file was long, so we kept the first ${MAX_BODY.toLocaleString("en-US")} characters.`;

// ─────────────── the prompt ───────────────

type PromptDoc = Pick<KnowledgeDoc, "title" | "body" | "agent" | "source" | "updated_at">;

/** The line an agent sees when there are no docs yet (the old app's words). */
export const NO_DOCS = "(Nothing added yet. Ask for the details you need, and suggest adding them in Knowledge.)";

/**
 * The docs an agent reads, in the order it should trust them: the doc made from the website, then docs written for
 * this agent, then docs for everyone, newest first. Docs for other agents are left out.
 */
export function docsFor<T extends PromptDoc>(docs: T[], agentKey: string): T[] {
  const weight = (d: T) => (d.source === "website" ? 0 : d.agent === agentKey ? 1 : 2);
  return docs
    .filter((d) => d.agent === null || d.agent === agentKey)
    .sort((a, b) => weight(a) - weight(b) || b.updated_at.localeCompare(a.updated_at));
}

// Text from websites and files must not close our tags and pass for our own instructions.
const safeBody = (s: string) => s.replace(/<\/?(doc|knowledge)\b/gi, (m) => m.replace("<", "&lt;"));
const safeAttr = (s: string) => s.replace(/["<>\n\r]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The knowledge part of an agent's system prompt, within `budgetChars` (plus one short closing line). Whole docs go
 * in, in docsFor order, while they fit. The first one that doesn't is cut to the room left (when that is at least
 * 400 characters). A doc skipped for being too big doesn't stop smaller ones after it. Docs that didn't fit (or were cut) are named
 * at the end, so the agent can look them up with search_knowledge.
 */
export function buildKnowledgePrompt(docs: PromptDoc[], agentKey: string, budgetChars: number): string {
  const list = docsFor(docs, agentKey);
  if (!list.length) return NO_DOCS;
  const budget = Math.max(0, Math.floor(budgetChars));
  const parts: string[] = [];
  const left: string[] = [];
  let used = 0;
  let cut = false;
  for (const d of list) {
    const open = `<doc title="${safeAttr(d.title)}"${d.agent ? ` for="${safeAttr(agentName(d.agent))}"` : ""}${d.source === "website" ? ' source="website"' : d.source === "file" ? ' source="file"' : ""}>\n`;
    const close = "\n</doc>";
    const body = safeBody(d.body.trim());
    const room = budget - used - open.length - close.length - (parts.length ? 1 : 0);
    if (body.length <= room) {
      parts.push(open + body + close);
      used += open.length + body.length + close.length + (parts.length > 1 ? 1 : 0);
      continue;
    }
    if (!cut && room >= 400) {
      cut = true;
      parts.push(`${open}${capText(body, room - 20).text}\n(cut short)${close}`);
      used = budget;
    }
    left.push(safeAttr(d.title));
  }
  if (left.length) parts.push(`More docs that didn't fit here: ${left.join("; ")}. Search Knowledge for them when you need them.`);
  return parts.join("\n");
}

/** The knowledge part of an agent's instructions: the business's docs, as knowledgeForPrompt built them. */
export function knowledgeSection(businessName: string, docs: string): string {
  return `What you know about ${businessName}. Use it, and never contradict it. If something isn't here, ask or search Knowledge.\n<knowledge>\n${docs.trim()}\n</knowledge>`;
}

