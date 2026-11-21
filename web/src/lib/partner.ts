// A small client for the partner API in Arrowsterr and Capybaroar (plan: "Partner API in Arrowsterr and Capybaroar").
// Morning Telos uses it to make each customer's brand and its brand key. Pure: fetch and the settings are passed in,
// so tests never reach the real products.
//
// Every call answers with a typed result instead of throwing. `retryable` is true for a hiccup worth trying again
// later: a timeout, a network error, 429, a 5xx, or Capybaroar's 409 "conflict" (the same brand is being made right
// now). 401, 403, 404, 422 and every other 409 (domain_taken, plan_limit, limit_reached) won't fix themselves.

export type Product = "arrowsterr" | "capybaroar";
export const PRODUCTS: readonly Product[] = ["arrowsterr", "capybaroar"];
export const PRODUCT_NAME: Record<Product, string> = { arrowsterr: "Arrowsterr", capybaroar: "Capybaroar" };
/** Arrowsterr refuses a brand without a website domain (422). Capybaroar takes one with none. */
export const NEEDS_DOMAIN: Record<Product, boolean> = { arrowsterr: true, capybaroar: false };

export type Brand = { id: string; name: string; domain: string | null; external_id: string };
export type BrandKey = { key: string; prefix: string };
export type ConnectLink = { url: string; expires_at: string | null };

export type PartnerFailure = { ok: false; status: number; code: string; message: string; retryable: boolean };
export type PartnerResult<T> = { ok: true; status: number; data: T } | PartnerFailure;

export type Partner = {
  product: Product;
  /** Makes the brand, or returns the one already made with this external_id (safe to retry). */
  createBrand(input: { name: string; domain: string | null; external_id: string }): Promise<PartnerResult<Brand>>;
  /** A new brand key, shown once. */
  createKey(brandId: string): Promise<PartnerResult<BrandKey>>;
  /** Revokes every brand key for the brand. */
  revokeKeys(brandId: string): Promise<PartnerResult<null>>;
  /** Deletes the brand and every brand key for it. */
  removeBrand(brandId: string): Promise<PartnerResult<null>>;
  /** Capybaroar only: a one-time page, good for 24 hours, where the customer signs in to their social networks for this brand. */
  connectLink(brandId: string): Promise<PartnerResult<ConnectLink>>;
  /**
   * Capybaroar only: disconnects one social channel from the brand. A channel that is already gone answers 404
   * not_found, which counts as done (channelGone). Capybaroar then sends channel.lost to our webhook.
   */
  disconnectChannel(brandId: string, channelId: string): Promise<PartnerResult<null>>;
};

/** True when a disconnect failed only because the channel is already gone: the end the person wanted. A 404 with any
 * other code (an older Capybaroar without the route answers http_404) is a real failure. */
export const channelGone = (r: PartnerFailure) => r.status === 404 && r.code === "not_found" && /channel/i.test(r.message);

type Env = Record<string, string | undefined>;
const ENV: Record<Product, { url: string; key: string }> = {
  arrowsterr: { url: "ARROWSTERR_PARTNER_URL", key: "ARROWSTERR_PARTNER_KEY" },
  capybaroar: { url: "CAPYBAROAR_PARTNER_URL", key: "CAPYBAROAR_PARTNER_KEY" },
};

/** How long one call may take before it counts as a hiccup. */
export const TIMEOUT_MS = 15_000;

/** The partner's address and key from the server's settings, or the plain-English reason they can't be used. */
function settingsFor(product: Product, env: Env): { ok: true; url: string; key: string } | { ok: false; error: string } {
  const name = PRODUCT_NAME[product];
  const url = env[ENV[product].url]?.trim().replace(/\/+$/, "") ?? "";
  const key = env[ENV[product].key]?.trim() ?? "";
  if (!key) return { ok: false, error: `${name} partner key is not set on the server.` };
  if (!/^https?:\/\/\S+$/.test(url)) return { ok: false, error: `${name} partner address is not set on the server.` };
  return { ok: true, url, key };
}

/** The partner for a product from the server's settings, or the plain-English reason it can't be used. */
export function partnerFor(product: Product, env: Env, fetcher: typeof fetch, timeoutMs = TIMEOUT_MS): { ok: true; partner: Partner } | { ok: false; error: string } {
  const s = settingsFor(product, env);
  if (!s.ok) return s;
  return { ok: true, partner: partnerClient({ product, url: s.url, key: s.key, fetch: fetcher, timeoutMs }) };
}

type ClientOptions = { product: Product; url: string; key: string; fetch: typeof fetch; timeoutMs?: number };
type Call = <T>(method: string, path: string, body?: unknown) => Promise<PartnerResult<T>>;

/** One call to the partner API under <url>/api/partner, as a typed result. */
function caller(o: ClientOptions): Call {
  return async function call<T>(method: string, path: string, body?: unknown): Promise<PartnerResult<T>> {
    let res: Response;
    try {
      res = await o.fetch(`${o.url}/api/partner${path}`, {
        method,
        headers: { Authorization: `Bearer ${o.key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, status: 0, code: timeout ? "timeout" : "network", message: timeout ? "No answer in time." : "Could not connect.", retryable: true };
    }
    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) {
      if (res.status === 204) return { ok: true, status: res.status, data: null as T };
      if (json && typeof json === "object") return { ok: true, status: res.status, data: json as T };
      return { ok: false, status: res.status, code: "bad_response", message: "The answer was not JSON.", retryable: true };
    }
    const err = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof err?.code === "string" ? err.code : `http_${res.status}`;
    return {
      ok: false,
      status: res.status,
      code,
      message: typeof err?.message === "string" ? err.message.slice(0, 300) : res.statusText || `HTTP ${res.status}`,
      retryable: isRetryable(res.status, code),
    };
  };
}

export function partnerClient(o: ClientOptions): Partner {
  const call = caller(o);
  const id = (s: string) => encodeURIComponent(s);
  return {
    product: o.product,
    async createBrand(input) {
      const r = await call<Brand>("POST", "/brands", input);
      if (r.ok && (typeof r.data.id !== "string" || !r.data.id)) return { ok: false, status: r.status, code: "bad_response", message: "The brand came back without an id.", retryable: true };
      return r;
    },
    async createKey(brandId) {
      const r = await call<BrandKey>("POST", `/brands/${id(brandId)}/keys`);
      if (r.ok && (typeof r.data.key !== "string" || !r.data.key)) return { ok: false, status: r.status, code: "bad_response", message: "The brand key came back empty.", retryable: true };
      return r;
    },
    revokeKeys: (brandId) => call<null>("DELETE", `/brands/${id(brandId)}/keys`),
    removeBrand: (brandId) => call<null>("DELETE", `/brands/${id(brandId)}`),
    disconnectChannel: (brandId, channelId) => call<null>("DELETE", `/brands/${id(brandId)}/channels/${id(channelId)}`),
    async connectLink(brandId) {
      const r = await call<ConnectLink>("POST", `/brands/${id(brandId)}/connect-link`);
      if (r.ok && (typeof r.data.url !== "string" || !/^https?:\/\/\S+$/.test(r.data.url))) return { ok: false, status: r.status, code: "bad_response", message: "The connect link came back without an address.", retryable: true };
      if (r.ok) return { ...r, data: { url: r.data.url, expires_at: typeof r.data.expires_at === "string" ? r.data.expires_at : null } };
      return r;
    },
  };
}

/** 409 codes that mean "try again in a moment". Any other 409 is a conflict a person has to sort out. */
const RETRYABLE_CONFLICTS: ReadonlySet<string> = new Set(["conflict"]);

/** A timeout, network error, 429, 5xx or a 409 "conflict": worth trying again later. */
export const isRetryable = (status: number, code = "") =>
  status === 0 || status === 408 || status === 429 || status >= 500 || (status === 409 && RETRYABLE_CONFLICTS.has(code));

// ─────────────── connecting on our own page ───────────────
// Capybaroar (social networks) and Arrowsterr (its integrations) each start the network's or tool's own sign-in for a
// brand and send the browser back to our return_url, so the customer never sees the product's own connect page.
//   GET  /networks                                 { networks: [{ id, name, kind }] }                  (Capybaroar)
//   POST /brands/:id/connect/start                 { network, return_url } -> { url }                   (Capybaroar)
//   GET  /connect/pick/:token                      { network, options: [{ id, name, picture? }] }      (Capybaroar)
//   POST /connect/pick/:token                      { ids } -> { channels }                              (Capybaroar)
//   GET  /integrations                             { integrations: [{ id, name, kind }] }              (Arrowsterr)
//   POST /brands/:id/connect/start                 { integration, return_url } -> { url }               (Arrowsterr)
// A 404 from the list or the start means the product doesn't have these yet (connectMode in partnerConnect.ts).

/** A network or tool the customer can connect, as the partner lists it. */
export type Connectable = { id: string; name: string; kind: string };
/** A page or account the customer picks after signing in (a Facebook Page, a LinkedIn company page). */
export type PickOption = { id: string; name: string; picture: string | null };
export type Pick = { network: string; options: PickOption[] };

/** Ids of networks, tools and picked accounts: plain, short and safe in a path. */
export const CONNECT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** A pick token from the return address. */
export const PICK_TOKEN = /^[A-Za-z0-9_-]{8,200}$/;
const HTTPS = /^https:\/\/\S+$/;

export type SocialConnect = {
  networks(): Promise<PartnerResult<Connectable[]>>;
  start(brandId: string, input: { network: string; return_url: string }): Promise<PartnerResult<{ url: string }>>;
  pick(token: string): Promise<PartnerResult<Pick>>;
  pickConnect(token: string, ids: string[]): Promise<PartnerResult<{ channels: unknown[] }>>;
};

export type IntegrationConnect = {
  integrations(): Promise<PartnerResult<Connectable[]>>;
  start(brandId: string, input: { integration: string; return_url: string }): Promise<PartnerResult<{ url: string }>>;
};

const bad = (status: number, message: string): PartnerFailure => ({ ok: false, status, code: "bad_response", message, retryable: true });
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/** The list's items that make sense, the rest dropped. */
function connectables(v: unknown): Connectable[] | null {
  if (!Array.isArray(v)) return null;
  const out: Connectable[] = [];
  for (const x of v.slice(0, 100)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = str(o.id, 40)?.toLowerCase();
    const name = str(o.name, 80);
    if (!id || !CONNECT_ID.test(id) || !name || out.some((c) => c.id === id)) continue;
    out.push({ id, name, kind: str(o.kind, 40) ?? "" });
  }
  return out;
}

function startUrl(r: PartnerResult<{ url: string }>): PartnerResult<{ url: string }> {
  if (!r.ok) return r;
  return typeof r.data?.url === "string" && HTTPS.test(r.data.url) ? { ...r, data: { url: r.data.url } } : bad(r.status, "The sign-in came back without an address.");
}

export function socialConnectClient(o: ClientOptions): SocialConnect {
  const call = caller(o);
  const id = (s: string) => encodeURIComponent(s);
  return {
    async networks() {
      const r = await call<{ networks?: unknown }>("GET", "/networks");
      if (!r.ok) return r;
      const list = connectables(r.data?.networks);
      return list ? { ...r, data: list } : bad(r.status, "The networks came back without a list.");
    },
    async start(brandId, input) {
      return startUrl(await call<{ url: string }>("POST", `/brands/${id(brandId)}/connect/start`, input));
    },
    async pick(token) {
      const r = await call<{ network?: unknown; options?: unknown }>("GET", `/connect/pick/${id(token)}`);
      if (!r.ok) return r;
      const network = str(r.data?.network, 40)?.toLowerCase();
      if (!network || !Array.isArray(r.data?.options)) return bad(r.status, "The choices came back without a list.");
      const options: PickOption[] = [];
      for (const x of r.data.options.slice(0, 100)) {
        const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const oid = str(p.id, 200);
        const name = str(p.name, 200);
        if (!oid || !name || options.some((q) => q.id === oid)) continue;
        const picture = str(p.picture, 2000);
        options.push({ id: oid, name, picture: picture && HTTPS.test(picture) ? picture : null });
      }
      return { ...r, data: { network, options } };
    },
    async pickConnect(token, ids) {
      const r = await call<{ channels?: unknown }>("POST", `/connect/pick/${id(token)}`, { ids });
      if (!r.ok) return r;
      return { ...r, data: { channels: Array.isArray(r.data?.channels) ? r.data.channels : [] } };
    },
  };
}

export function integrationConnectClient(o: ClientOptions): IntegrationConnect {
  const call = caller(o);
  return {
    async integrations() {
      const r = await call<{ integrations?: unknown }>("GET", "/integrations");
      if (!r.ok) return r;
      const list = connectables(r.data?.integrations);
      return list ? { ...r, data: list } : bad(r.status, "The integrations came back without a list.");
    },
    async start(brandId, input) {
      return startUrl(await call<{ url: string }>("POST", `/brands/${encodeURIComponent(brandId)}/connect/start`, input));
    },
  };
}

/** Capybaroar's connect calls from the server's settings, or the reason they can't be used. */
export function socialConnectFor(env: Env, fetcher: typeof fetch, timeoutMs = TIMEOUT_MS): { ok: true; client: SocialConnect } | { ok: false; error: string } {
  const s = settingsFor("capybaroar", env);
  if (!s.ok) return s;
  return { ok: true, client: socialConnectClient({ product: "capybaroar", url: s.url, key: s.key, fetch: fetcher, timeoutMs }) };
}

/** Arrowsterr's connect calls from the server's settings, or the reason they can't be used. */
export function integrationConnectFor(env: Env, fetcher: typeof fetch, timeoutMs = TIMEOUT_MS): { ok: true; client: IntegrationConnect } | { ok: false; error: string } {
  const s = settingsFor("arrowsterr", env);
  if (!s.ok) return s;
  return { ok: true, client: integrationConnectClient({ product: "arrowsterr", url: s.url, key: s.key, fetch: fetcher, timeoutMs }) };
}
