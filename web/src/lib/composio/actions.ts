// What a connected app can do for the AI team: Composio's actions for the app's toolkit (GET /api/v3.1/tools), each
// sorted as a read, a write or blocked, and run on the workspace's own connection (POST /api/v3.1/tools/execute/<slug>).
// Reads run when asked. A write is saved for the owner's approval unless the teammate is on autopilot
// (src/lib/appTools.ts). Blocked actions never run. Hiccups (timeouts, Composio's rate limit and outages) are tried
// again with growing waits; what won't get better (a 4xx, a connection that's gone) is said in one short line.
// Copied from Omniscient's src/lib/composio/actions.ts and trimmed (no billing or template rules: those apps aren't
// here). Not "server-only", so the tests load it; only server code imports it.

import { isWrite } from "../approvals.ts";
import { appAction, appName, TOOLKITS } from "./catalog.ts";
import { composioCall, GONE, type Net } from "./composio.ts";

export type JsonSchema = { type?: string | string[]; description?: string; title?: string; enum?: unknown[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[]; default?: unknown; format?: string };
export type Tool = { slug: string; name: string; description: string; input: JsonSchema; tags: string[] };
export type ToolKind = "read" | "write" | "blocked";
export type Sorted = Tool & { kind: ToolKind; why?: string };
/** A connection to run an action on: the workspace's Composio user and its connected account for the app. */
export type Conn = { toolkit: string; account: string; user: string };

/** Something that won't get better by trying again: said to the agent or the person, and not retried. */
export class AppSetupError extends Error {}

const READ = new Set(["GET", "LIST", "SEARCH", "FIND", "FETCH", "RETRIEVE", "READ", "QUERY", "COUNT", "DESCRIBE", "LOOKUP", "CHECK", "VIEW", "SHOW", "PREVIEW", "LOOK", "VALIDATE", "VERIFY"]);
const DESTRUCTIVE = /(^|_)(DELETE|DELETES|REMOVE|DESTROY|PURGE|ERASE|WIPE|TRASH|ARCHIVE|CANCEL|REVOKE|DEACTIVATE|DISABLE|SUSPEND|BAN|KICK|LEAVE|UNSUBSCRIBE|TERMINATE|CLEAR|RESET|UNINSTALL|DROP|TRUNCATE)(_|$)/;
// Never, in any app: LinkedIn, keys, sign-ins and hooks that could send data elsewhere, acting as someone else.
const NEVER = /LINKEDIN|API_?KEY|TOKEN|PASSWORD|SECRET|OAUTH|CREDENTIAL|WEBHOOK|IMPERSONAT/;
// Words in a slug that mean a change even when Composio calls the action read-only.
const CHANGES = /(CREATE|UPDATE|SEND|REPLY|POST|ADD|SET|EDIT|MOVE|UPLOAD|INVITE|EXECUTE|RUN|MODIFY|PATCH|PUT|INSERT|FORWARD|SCHEDULE|BOOK)/;

/** The action's verb: HUBSPOT_LIST_CONTACTS is LIST; a BATCH_ or BULK_ prefix reads past it. */
export function verbOf(toolkit: string, slug: string): string {
  const prefix = `${toolkit.toUpperCase()}_`;
  const words = (slug.toUpperCase().startsWith(prefix) ? slug.slice(prefix.length) : slug).toUpperCase().split("_").filter(Boolean);
  return words[0] === "BATCH" || words[0] === "BULK" ? (words[1] ?? "") : (words[0] ?? "");
}

/**
 * Read, write or blocked, from the action's name, Composio's hints (its tags) and the verb list the products' tools
 * use (isWrite in approvals.ts). Anything unclear is a write, so it waits for the owner.
 * An app that lists its actions (the website builders in catalog.ts) runs only those. A listed change is a write even
 * when Composio hints it is destructive (Framer marks publishing that way), so it waits for the owner like any change.
 * A listed read is a read only when its name says so too. Deleting is blocked whatever a list says.
 */
export function kindOf(toolkit: string, t: Pick<Tool, "slug" | "name" | "description" | "tags">): { kind: ToolKind; why?: string } {
  const slug = t.slug.toUpperCase();
  if (!TOOLKITS[toolkit]) return { kind: "blocked", why: "That app can't be connected here." };
  if (!slug.startsWith(`${toolkit.toUpperCase()}_`)) return { kind: "blocked", why: "That action belongs to another app." };
  if (NEVER.test(slug) || /linkedin/i.test(`${t.name} ${t.description}`)) return { kind: "blocked", why: "Your team doesn't run that action." };
  const listed = appAction(toolkit, slug);
  if (TOOLKITS[toolkit].actions && !listed) return { kind: "blocked", why: "Your team doesn't run that action." };
  const tags = (t.tags ?? []).map((x) => x.toLowerCase());
  if (DESTRUCTIVE.test(slug) || (tags.includes("destructivehint") && listed?.kind !== "write")) return { kind: "blocked", why: "Deleting and cancelling stay in the app itself." };
  if (listed?.kind === "write") return { kind: "write" };
  const verb = verbOf(toolkit, slug);
  const hinted = tags.includes("readonlyhint") && !CHANGES.test(slug);
  const read = (READ.has(verb) || hinted) && !isWrite({ name: verb.toLowerCase() });
  return { kind: read ? "read" : "write" };
}

// Actions change rarely: kept for ten minutes per toolkit.
const cache = new Map<string, { at: number; tools: Tool[] }>();
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const statusOf = (e: unknown) => Number((e as { status?: number } | null)?.status) || 0;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A hiccup worth trying again: Composio or the app busy or down, a timeout, a dropped connection. */
export function hiccup(e: unknown): boolean {
  if (e instanceof AppSetupError) return false;
  const s = statusOf(e);
  if (s === 408 || s === 429 || s >= 500) return true;
  return !s && /timeout|timed out|aborted|network|fetch failed|econnreset|econnrefused|socket|busy|overloaded|rate limit|too many/i.test(messageOf(e));
}

/** Try a call again after a hiccup, waiting longer each time (1s, 3s); anything else goes up as it is. */
export async function withTries<T>(fn: () => Promise<T>, o: { tries?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const tries = o.tries ?? 3;
  const sleep = o.sleep ?? wait;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!hiccup(e) || i >= tries - 1) throw e;
      await sleep(1000 * 3 ** i);
    }
  }
}

type ToolItem = { slug?: string; name?: string; description?: string; input_parameters?: JsonSchema; tags?: unknown[]; is_deprecated?: boolean };

export type ActionOpts = Net & { sleep?: (ms: number) => Promise<void>; tries?: number };

/** The toolkit's actions on Composio, sorted. */
export async function toolsOf(toolkit: string, o: ActionOpts = {}): Promise<Sorted[]> {
  if (!TOOLKITS[toolkit]) throw new AppSetupError("That app can't be connected here.");
  const hit = cache.get(toolkit);
  let tools = hit && Date.now() - hit.at < 600_000 ? hit.tools : null;
  if (!tools) {
    const got: Tool[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ toolkit_slug: toolkit, limit: "200", ...(cursor ? { cursor } : {}) });
      const d = await withTries(() => composioCall<{ items?: ToolItem[]; next_cursor?: string | null }>(`/api/v3.1/tools?${q}`, o), o);
      for (const x of d.items ?? []) {
        if (!x.slug || x.is_deprecated) continue;
        got.push({
          slug: x.slug,
          name: x.name ?? x.slug,
          description: (x.description ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
          input: x.input_parameters ?? { type: "object", properties: {} },
          tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === "string") : [],
        });
      }
      cursor = d.next_cursor ?? "";
      if (!cursor) break;
    }
    tools = got;
    cache.set(toolkit, { at: Date.now(), tools });
  }
  return tools.map((t) => ({ ...t, ...kindOf(toolkit, t) }));
}

/** Forget the cached actions (tests). */
export const forgetTools = () => cache.clear();

type ExecAnswer = { data?: unknown; error?: unknown; successful?: boolean };

// An app's own refusal that won't change by trying again.
const SETUP_WORDS = /\b(400|401|403|404|409|410|422)\b|not found|invalid|required|missing|forbidden|unauthori[sz]ed|permission|not allowed|does not exist|bad request|unprocessable|already exists/i;
const BUSY_WORDS = /\b(429|500|502|503|504)\b|rate limit|too many|timeout|timed out|temporar|unavailable|overloaded|try again/i;

/** What a person or agent reads when the app's sign-in is gone. Also how the server spots it (needsReconnect). */
export const reconnectText = (toolkit: string) => `Connect ${appName(toolkit)} again in Settings, Apps.`;
export const needsReconnect = (e: unknown) => e instanceof AppSetupError && / again in Settings, Apps\.$/.test(e.message);

/**
 * Run one action on a connection. Tried again on hiccups; a refusal that won't change (a 4xx, a connection that's
 * gone, the app saying the input is wrong) is an AppSetupError. Returns the action's data.
 */
export async function runTool(conn: Conn, slug: string, args: Record<string, unknown>, o: ActionOpts = {}): Promise<unknown> {
  const once = async () => {
    let d: ExecAnswer;
    try {
      d = await composioCall<ExecAnswer>(`/api/v3.1/tools/execute/${encodeURIComponent(slug)}`, {
        ...o,
        method: "POST",
        body: JSON.stringify({ connected_account_id: conn.account, user_id: conn.user, arguments: args }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      const s = statusOf(e);
      const words = `${(e as { slug?: string }).slug ?? ""} ${messageOf(e)}`;
      if (s === 0 && !hiccup(e)) throw new AppSetupError(messageOf(e));
      if (s >= 400 && s < 500 && s !== 408 && s !== 429) {
        if (s === 401) throw new AppSetupError("Apps aren't working on the server right now. Morning Telos is fixing it.");
        // The connection is gone (revoked, expired, removed): connect it again. Anything else Composio can't run: why.
        if (s === 410 || /connected.?account/i.test(words) || GONE.test(words)) throw new AppSetupError(reconnectText(conn.toolkit));
        throw new AppSetupError(messageOf(e).replace(/^Composio:\s*/, "").slice(0, 200));
      }
      throw e;
    }
    if (d.successful === false || (d.error && d.successful !== true)) {
      const why = typeof d.error === "string" ? d.error : JSON.stringify(d.error ?? "It didn't work.");
      if (GONE.test(why)) throw new AppSetupError(reconnectText(conn.toolkit));
      if (BUSY_WORDS.test(why) && !SETUP_WORDS.test(why.replace(/\b(429|5\d\d)\b/g, ""))) throw Object.assign(new Error(why.slice(0, 200)), { status: 503 });
      throw new AppSetupError(why.slice(0, 200));
    }
    return d.data ?? null;
  };
  return withTries(once, o);
}
