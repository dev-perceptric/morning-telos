// Archon's Pages tab (src/components/Pages.tsx): the pages and posts he made on the business's own site, read from
// his approvals (approvals.ts). Waiting ones are pending approvals; done ones went to the site, as a draft unless the
// change was a publish. Members read approvals straight from the database (013_approvals.sql). Shared by the browser
// and the tests.
import { appName } from "./composio/catalog.ts";

/** The site builders Archon works in: Composio's toolkits, and self-hosted WordPress ("wordpress", direct). */
export const SITE_PRODUCTS = ["framer", "webflow", "wordpress_com", "shopify", "wordpress"] as const;

export type Page = {
  approvalId: number;
  status: "wait" | "done" | "failed" | "denied";
  /** The page's own title, or the change's title when it has none. */
  title: string;
  /** What kind of change it was, like "Add a draft page to WordPress". */
  change: string;
  product: string;
  site: string;
  /** The first words of the page, as plain text. */
  preview: string | null;
  url: string | null;
  /** Publishing puts it live; everything else goes in as a draft (catalog.ts makes new pages drafts). */
  live: boolean;
  why: string | null;
  at: string;
};

type Row = { id: number; product: string; tool: string; title: string; input: Record<string, unknown> | null; status: string; result: string | null; created_at: string; finished_at: string | null };

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** HTML or Markdown as plain text, cut to about `max` characters at a word. */
export function plainText(v: unknown, max = 600): string | null {
  const t = str(v, 20000)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}...` : t;
}

/** The page's title from whichever field the builder uses. */
export function titleIn(input: Record<string, unknown>): string {
  const field = obj(input.fieldData ?? input.field_data);
  return str(input.title, 200) || str(input.name, 200) || str(field.name, 200) || str(obj(input.page).title, 200) || str(obj(input.post).title, 200) || str(obj(input.article).title, 200);
}

/** The page's words from whichever field the builder uses. */
export function bodyIn(input: Record<string, unknown>): unknown {
  const field = obj(input.fieldData ?? input.field_data);
  return input.content ?? input.body_html ?? input.html ?? field["post-body"] ?? field.body ?? obj(input.page).body_html ?? obj(input.article).body_html ?? null;
}

/** A link to what went to the site, from the builder's answer, when it gave one. */
export function urlIn(result: string | null): string | null {
  if (!result) return null;
  try {
    const d = obj(JSON.parse(result.slice(result.indexOf("{") >= 0 ? result.indexOf("{") : 0)));
    const inner = obj(d.data ?? d);
    for (const k of ["link", "url", "permalink", "published_url", "preview_url", "previewUrl", "editUrl"]) {
      const v = str(inner[k] ?? d[k], 500);
      if (/^https:\/\//.test(v)) return v;
    }
  } catch {
    /* not JSON: no link */
  }
  return null;
}

const STATUS: Record<string, Page["status"] | null> = { pending: "wait", approved: "wait", running: "wait", done: "done", failed: "failed", denied: "denied" };

/** Archon's site changes as pages. Uploads and reads are left out; so are changes that weren't to his sites. */
export function pagesOf(rows: readonly Row[]): Page[] {
  const out: Page[] = [];
  for (const r of rows) {
    if (!(SITE_PRODUCTS as readonly string[]).includes(r.product)) continue;
    if (/UPLOAD|IMAGE|MEDIA|METADATA/i.test(r.tool)) continue;
    const status = STATUS[r.status];
    if (!status) continue;
    const input = obj(r.input);
    const live = /PUBLISH/i.test(r.tool) || input.published === true || input.status === "publish";
    out.push({
      approvalId: r.id,
      status,
      title: titleIn(input) || r.title,
      change: r.title,
      product: r.product,
      site: r.product === "wordpress" ? "WordPress" : appName(r.product),
      preview: plainText(bodyIn(input)),
      url: status === "done" ? urlIn(r.result) : null,
      live,
      why: status === "failed" ? str(r.result, 300) || null : null,
      at: r.finished_at ?? r.created_at,
    });
  }
  return out;
}

/** Archon's line at the top of the tab. Null before his first page. */
export function pagesSummary(pages: readonly Page[]): string | null {
  const waiting = pages.filter((p) => p.status === "wait").length;
  const done = pages.filter((p) => p.status === "done").length;
  if (!waiting && !done) return null;
  const parts: string[] = [];
  if (done) parts.push(`${done === 1 ? "1 page" : `${done} pages`} on your site`);
  if (waiting) parts.push(`${waiting === 1 ? "1 waits" : `${waiting} wait`} for your OK`);
  return `${parts.join(", and ")}. Nothing goes live until you approve it.`;
}
