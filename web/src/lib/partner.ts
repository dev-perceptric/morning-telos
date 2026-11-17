// A small client for the partner API in Arrowsterr and Capybaroar (plan: "Partner API in Arrowsterr and Capybaroar").
// Morning Telos uses it to make each customer's brand and its brand key. Pure: fetch and the settings are passed in,
// so tests never reach the real products.
//
// Every call answers with a typed result instead of throwing. `retryable` is true for a hiccup worth trying again
// later: a timeout, a network error, 429 or a 5xx. 401, 403, 404, 409 and 422 won't fix themselves.

export type Product = "arrowsterr" | "capybaroar";
export const PRODUCTS: readonly Product[] = ["arrowsterr", "capybaroar"];
export const PRODUCT_NAME: Record<Product, string> = { arrowsterr: "Arrowsterr", capybaroar: "Capybaroar" };

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
};

type Env = Record<string, string | undefined>;
const ENV: Record<Product, { url: string; key: string }> = {
  arrowsterr: { url: "ARROWSTERR_PARTNER_URL", key: "ARROWSTERR_PARTNER_KEY" },
  capybaroar: { url: "CAPYBAROAR_PARTNER_URL", key: "CAPYBAROAR_PARTNER_KEY" },
};

/** How long one call may take before it counts as a hiccup. */
export const TIMEOUT_MS = 15_000;

/** The partner for a product from the server's settings, or the plain-English reason it can't be used. */
export function partnerFor(product: Product, env: Env, fetcher: typeof fetch, timeoutMs = TIMEOUT_MS): { ok: true; partner: Partner } | { ok: false; error: string } {
  const name = PRODUCT_NAME[product];
  const url = env[ENV[product].url]?.trim().replace(/\/+$/, "") ?? "";
  const key = env[ENV[product].key]?.trim() ?? "";
  if (!key) return { ok: false, error: `${name} partner key is not set on the server.` };
  if (!/^https?:\/\/\S+$/.test(url)) return { ok: false, error: `${name} partner address is not set on the server.` };
  return { ok: true, partner: partnerClient({ product, url, key, fetch: fetcher, timeoutMs }) };
}

export function partnerClient(o: { product: Product; url: string; key: string; fetch: typeof fetch; timeoutMs?: number }): Partner {
  async function call<T>(method: string, path: string, body?: unknown): Promise<PartnerResult<T>> {
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
    return {
      ok: false,
      status: res.status,
      code: typeof err?.code === "string" ? err.code : `http_${res.status}`,
      message: typeof err?.message === "string" ? err.message.slice(0, 300) : res.statusText || `HTTP ${res.status}`,
      retryable: isRetryable(res.status),
    };
  }

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
    async connectLink(brandId) {
      const r = await call<ConnectLink>("POST", `/brands/${id(brandId)}/connect-link`);
      if (r.ok && (typeof r.data.url !== "string" || !/^https?:\/\/\S+$/.test(r.data.url))) return { ok: false, status: r.status, code: "bad_response", message: "The connect link came back without an address.", retryable: true };
      if (r.ok) return { ...r, data: { url: r.data.url, expires_at: typeof r.data.expires_at === "string" ? r.data.expires_at : null } };
      return r;
    },
  };
}

/** A timeout, network error, 429 or 5xx: worth trying again later. */
export const isRetryable = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;
