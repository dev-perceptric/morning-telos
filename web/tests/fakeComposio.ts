// A fake Composio for the tests (copied in spirit from Omniscient's tests/apps/fakeComposio.ts): auth configs, the
// hosted connect link, connected accounts per Composio user, the toolkit's actions, running one, and proxy execute.
// It checks the server key on every call and that an action runs only on an account of the Composio user it names.
// Any other address fails the test, so nothing reaches the real Composio.

export const KEY = "test_composio_key";
export const BASE = "https://composio.test";

type Account = { id: string; user_id: string; toolkit: string; status: string; status_reason?: string };
type ToolItem = { slug: string; name: string; description: string; input_parameters?: Record<string, unknown>; tags?: string[] };

export const GMAIL_TOOLS: ToolItem[] = [
  { slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails", description: "Fetch emails from the inbox.", tags: ["readOnlyHint"], input_parameters: { type: "object", properties: { query: { type: "string", description: "A Gmail search." } } } },
  { slug: "GMAIL_GET_PROFILE", name: "Get profile", description: "The signed-in account." },
  { slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send an email.", input_parameters: { type: "object", properties: { recipient_email: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["recipient_email", "body"] } },
  { slug: "GMAIL_CREATE_EMAIL_DRAFT", name: "Create email draft", description: "Save a draft." },
  { slug: "GMAIL_DELETE_MESSAGE", name: "Delete message", description: "Delete an email.", tags: ["destructiveHint"] },
  { slug: "GMAIL_MOVE_TO_TRASH", name: "Move to trash", description: "Trash an email." },
  { slug: "GMAIL_REPLY_TO_THREAD", name: "Reply to thread", description: "Reply in a thread." },
];
export const HUBSPOT_TOOLS: ToolItem[] = [
  { slug: "HUBSPOT_LIST_CONTACTS", name: "List contacts", description: "Contacts." },
  { slug: "HUBSPOT_UPDATE_DEAL", name: "Update deal", description: "Change a deal." },
];

export function fakeComposio(o: { tools?: Record<string, ToolItem[]>; configs?: { id: string; toolkit: string; is_composio_managed?: boolean }[] } = {}) {
  const accounts: Account[] = [];
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const ran: { slug: string; account: string; user: string; args: unknown }[] = [];
  const deleted: string[] = [];
  const configs = [...(o.configs ?? [])];
  const tools = o.tools ?? { gmail: GMAIL_TOOLS, hubspot: HUBSPOT_TOOLS };
  let n = 0;
  /** Make the next calls to a path start with these answers (status codes), to test retries and errors. */
  const failNext: { path: RegExp; status: number; body?: unknown }[] = [];

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.origin !== BASE) throw new Error(`Test tried to reach ${url.origin}`);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname + url.search, body });
    if (new Headers(init.headers).get("x-api-key") !== KEY) return json({ error: { message: "Invalid API key" } }, 401);
    const f = failNext.findIndex((x) => x.path.test(url.pathname));
    if (f >= 0) {
      const [x] = failNext.splice(f, 1);
      return json(x.body ?? { error: { message: `fake ${x.status}` } }, x.status);
    }
    const p = url.pathname;
    const q = url.searchParams;

    if (p === "/api/v3.1/auth_configs" && method === "GET") return json({ items: configs.filter((c) => c.toolkit === q.get("toolkit_slug")).map((c) => ({ ...c, toolkit: { slug: c.toolkit } })) });
    if (p === "/api/v3.1/auth_configs" && method === "POST") {
      const id = `ac_${++n}`;
      configs.push({ id, toolkit: String((body!.toolkit as { slug: string }).slug), is_composio_managed: true });
      return json({ auth_config: { id } });
    }
    if (p === "/api/v3.1/connected_accounts/link" && method === "POST") {
      const cfg = configs.find((c) => c.id === body!.auth_config_id);
      const id = `ca_${++n}`;
      accounts.push({ id, user_id: String(body!.user_id), toolkit: cfg?.toolkit ?? "unknown", status: "INITIATED" });
      return json({ redirect_url: `https://connect.composio.test/link/${id}`, connected_account_id: id });
    }
    if (p === "/api/v3.1/connected_accounts" && method === "GET") {
      const users = (q.get("user_ids") ?? "").split(",");
      const kits = (q.get("toolkit_slugs") ?? "").split(",");
      return json({ items: accounts.filter((a) => users.includes(a.user_id) && kits.includes(a.toolkit)).map((a) => ({ id: a.id })) });
    }
    const acc = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/.exec(p);
    if (acc) {
      const a = accounts.find((x) => x.id === decodeURIComponent(acc[1]));
      if (method === "DELETE") {
        deleted.push(decodeURIComponent(acc[1]));
        if (!a) return json({ error: { message: "not found" } }, 404);
        accounts.splice(accounts.indexOf(a), 1);
        return json({ success: true });
      }
      if (!a) return json({ error: { message: "Connected account not found" } }, 404);
      return json({ id: a.id, status: a.status, status_reason: a.status_reason ?? null, user_id: a.user_id, toolkit: { slug: a.toolkit } });
    }
    if (p === "/api/v3.1/tools" && method === "GET") return json({ items: tools[q.get("toolkit_slug") ?? ""] ?? [], next_cursor: null });
    if (p === "/api/v3.1/tools/execute/proxy" && method === "POST") {
      const a = accounts.find((x) => x.id === body!.connected_account_id && x.user_id === body!.user_id && x.status === "ACTIVE");
      if (!a) return json({ error: { message: "Connected account not found" } }, 404);
      const endpoint = String(body!.endpoint);
      if (endpoint.includes("gmail.googleapis.com")) return json({ data: { emailAddress: "ana@anasbakery.com" }, status: 200 });
      return json({ data: {}, status: 404 });
    }
    const ex = /^\/api\/v3\.1\/tools\/execute\/([A-Z0-9_]+)$/.exec(p);
    if (ex && method === "POST") {
      const a = accounts.find((x) => x.id === body!.connected_account_id);
      if (!a || a.user_id !== body!.user_id) return json({ error: { message: "Connected account not found for this user", slug: "ConnectedAccount_NotFound" } }, 404);
      if (a.status !== "ACTIVE") return json({ error: { message: "Connected account is expired", slug: "ConnectedAccount_Expired" } }, 410);
      ran.push({ slug: ex[1], account: a.id, user: a.user_id, args: body!.arguments });
      return json({ successful: true, data: { ran: ex[1], args: body!.arguments } });
    }
    return json({ error: { message: `No fake for ${method} ${p}` } }, 404);
  }) as typeof globalThis.fetch;

  /** An account as if the person finished signing in on Composio's page. */
  const addAccount = (user: string, toolkit: string, status = "ACTIVE") => {
    const id = `ca_${++n}`;
    accounts.push({ id, user_id: user, toolkit, status });
    return id;
  };
  const finish = (id: string, status = "ACTIVE") => {
    const a = accounts.find((x) => x.id === id);
    if (a) a.status = status;
  };
  return { fetch, accounts, calls, ran, deleted, configs, failNext, addAccount, finish };
}
