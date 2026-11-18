// Composio holds the sign-in for the customer's own apps (Gmail, Outlook, HubSpot and the rest): the customer
// connects on Composio's hosted page, Composio keeps and refreshes the tokens, and every call goes through Composio
// with the workspace's connected account. Morning Telos keeps only the connected account's id
// (supabase/016_app_connections.sql).
// Copied from Omniscient's src/lib/composio/composio.ts and trimmed: no personal apps, and the proxy only sends JSON
// (it is used for one call at connect, to read the account's label).
//
// Not "server-only": the tests load it in plain Node. Nothing in this file reaches the browser (it reads
// process.env), and no secret of a connected account ever comes back from Composio.

/** The auth schemes Composio names (GET /api/v3.1/toolkits/<slug>). */
export type Scheme = "OAUTH2" | "OAUTH1" | "API_KEY" | "BASIC" | "BEARER_TOKEN";
/**
 * One toolkit on Composio. `managed`: Composio has its own app for it (no developer app for us to register), from
 * the toolkit's page on composio.dev (is_composio_managed). An OAuth toolkit without a managed app needs our own app,
 * set up once in Composio, with its auth config id in COMPOSIO_AUTH_CONFIG_<TOOLKIT>.
 */
export type ComposioTool = { toolkit: string; scheme: Scheme; managed: boolean };

type Env = Record<string, string | undefined>;
const env = (name: string, e: Env = process.env) => e[name]?.trim() ?? "";

export const composioKey = (e: Env = process.env) => env("COMPOSIO_API_KEY", e);
/** Apps work on this server: it has a Composio key. Without it, Settings says so and agents get no app tools. */
export const composioOn = (e: Env = process.env) => !!composioKey(e);
export const composioBase = (e: Env = process.env) => env("COMPOSIO_BASE_URL", e).replace(/\/+$/, "") || "https://backend.composio.dev";
/** An auth config set by hand (our own app for a toolkit), by toolkit. */
export const authConfigEnv = (toolkit: string, e: Env = process.env) => env(`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`, e);

/** Whether a toolkit connects now: the server has a key, and the toolkit needs no app of ours or has one. */
export function connectable(t: ComposioTool | undefined, e: Env = process.env): boolean {
  if (!t || !composioKey(e)) return false;
  return t.managed || !t.scheme.startsWith("OAUTH") || !!authConfigEnv(t.toolkit, e);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The workspace's own Composio user. Every connection is made for it and every call names it, and the server checks
 * an account belongs to it before saving or using one, so a workspace only ever reaches its own connections.
 */
export function composioUser(workspaceId: string): string {
  if (!UUID.test(workspaceId)) throw new Error("Not a workspace id.");
  return `mt_${workspaceId.toLowerCase()}`;
}

/** The headers every call to Composio carries. */
export function composioHeaders(e: Env = process.env): Record<string, string> {
  return { "x-api-key": composioKey(e), "content-type": "application/json", accept: "application/json" };
}

/** Composio's own refusal (not the tool's answer), as its error body says it. */
export type ComposioFailure = { status: number; message: string; slug: string };

export function failureOf(status: number, body: unknown): ComposioFailure {
  const e = ((body as { error?: unknown } | null)?.error ?? body) as Record<string, unknown> | null;
  const message = typeof e?.message === "string" ? e.message : typeof body === "string" ? body.slice(0, 300) : `Composio answered ${status}.`;
  return { status, message: message.slice(0, 300), slug: typeof e?.slug === "string" ? e.slug : "" };
}

/** A connection Composio can't use any more: the person revoked it, it expired, or it was removed. */
export const GONE = /expired|revoked|inactive|not[ _-]?active|disabled|deleted|re-?auth|reconnect|invalid[ _-]?(state|token|grant)/i;

export type Net = { fetcher?: typeof fetch; env?: Env };

/** One call to Composio's own endpoints. Throws with a short line; `status` says what Composio answered. */
export async function composioCall<T>(path: string, init: RequestInit & Net = {}): Promise<T> {
  const { fetcher = fetch, env: e, ...rest } = init;
  if (!composioKey(e)) throw Object.assign(new Error("Apps aren't set up on the server yet."), { status: 0 });
  const res = await fetcher(`${composioBase(e)}${path}`, { ...rest, headers: composioHeaders(e), signal: rest.signal ?? AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const f = failureOf(res.status, body);
    throw Object.assign(new Error(res.status === 401 ? "Composio turned down the server's key." : `Composio: ${f.message}`), { status: res.status, slug: f.slug });
  }
  return body as T;
}

/**
 * One GET to the app's own API through Composio's proxy execute (POST /api/v3.1/tools/execute/proxy), signed with the
 * connected account. Returns the app's JSON answer, or throws. Used at connect to read the account's label.
 */
export async function proxyGet<T>(account: string, user: string, url: string, o: Net = {}): Promise<T> {
  const a = await composioCall<{ data?: unknown; status?: number }>("/api/v3.1/tools/execute/proxy", {
    ...o,
    method: "POST",
    body: JSON.stringify({ connected_account_id: account, user_id: user, endpoint: url, method: "GET" }),
  });
  const status = Number(a?.status) || 200;
  if (status >= 400) throw Object.assign(new Error(`It answered ${status}.`), { status });
  return (typeof a?.data === "string" ? JSON.parse(a.data) : a?.data) as T;
}
