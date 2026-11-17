// The provision job: a new workspace's brand in Arrowsterr and in Capybaroar, made through their partner APIs, with
// each brand key sealed and saved in services (supabase/005_services.sql). Queued by supabase/006_jobs.sql when a
// workspace is made, run by the worker. Pure: the database, the partner clients and sealing are passed in.
//
// For each product not ready yet: make the brand with external_id = the workspace id (the partner returns the same
// brand on a retry), make a brand key, seal it, save it ready. If the brand already existed, a retry after a crash
// may have left an unsaved key there, so its keys are revoked before a new one is made. A product that fails is saved
// failed with one short line, and doesn't stop the other. Hiccups (timeouts, 429, 5xx) make the job try again later.
// Arrowsterr needs the workspace's website (NEEDS_DOMAIN). With none, its service waits ("waiting") without a call,
// and 009_website_gate.sql queues provision again when the website is added.

import { NEEDS_DOMAIN, PRODUCT_NAME, PRODUCTS, type Partner, type PartnerFailure, type Product } from "./partner.ts";
import type { JobResult } from "./jobs.ts";

/** waiting: needs something from the customer first (Arrowsterr: the website). */
export type ServiceStatus = "pending" | "waiting" | "ready" | "failed" | "removing" | "removed";
export type ServicePatch =
  | { status: "ready"; brand_id: string; sealed_key: string; key_prefix: string; last_error: null }
  | { status: "waiting"; last_error: null }
  | { status: "failed"; last_error: string; brand_id?: string };

export type ProvisionDeps = {
  workspace: () => Promise<{ id: string; name: string; website: string | null } | null>;
  services: () => Promise<{ product: Product; status: ServiceStatus }[]>;
  /** partnerFor(product, env, fetch) from partner.ts. */
  partner: (product: Product) => { ok: true; partner: Partner } | { ok: false; error: string };
  /** seal() from sealing.ts. Throws when SEALING_KEYS isn't set. */
  seal: (plain: string, aad: string) => string;
  save: (product: Product, patch: ServicePatch) => Promise<void>;
};

export type ProductResult = { product: Product; status: "ready" | "waiting" | "skipped" | "failed"; error?: string; retryable?: boolean };

/** The additional data a brand key is sealed with: it only opens for this workspace and product. */
export const keyAad = (workspaceId: string, product: Product) => `${workspaceId}:${product}`;

/** The bare domain of a website, like "anasbakery.com", or null. */
export function domainOf(website: string | null | undefined): string | null {
  const host = (website ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "").replace(/:\d+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** One short line for staff about what went wrong. Customers never see it (service_status() leaves it out). */
export function errorLine(product: Product, f: PartnerFailure): string {
  const name = PRODUCT_NAME[product];
  if (f.code === "timeout") return `${name} did not answer in time.`;
  if (f.status === 0) return `Could not reach ${name}.`;
  if (f.code === "bad_response") return `${name} sent an answer we could not read.`;
  if (f.code === "domain_taken") return "Another customer already tracks this website in SEO. We'll sort it out.";
  if (f.code === "plan_limit" || f.code === "limit_reached") return `Our ${name} partner plan is full. Raise its limit, then run provision again.`;
  if (f.status === 429) return `${name} asked us to slow down.`;
  if (f.status >= 500) return `${name} had a server problem (${f.status}).`;
  if (f.status === 401) return `${name} did not accept our partner key.`;
  if (f.status === 403) return `${name} says this brand belongs to another partner.`;
  if (f.status === 404) return `${name} could not find the brand.`;
  return `${name} turned down the request (${f.status}): ${f.message}`.slice(0, 300);
}

const SKIP: ReadonlySet<ServiceStatus> = new Set(["ready", "removing", "removed"]);

async function one(product: Product, ws: { id: string; name: string; website: string | null }, d: ProvisionDeps): Promise<ProductResult> {
  const fail = async (error: string, retryable: boolean, brand_id?: string): Promise<ProductResult> => {
    await d.save(product, { status: "failed", last_error: error, ...(brand_id ? { brand_id } : {}) });
    return { product, status: "failed", error, retryable };
  };
  const domain = domainOf(ws.website);
  if (NEEDS_DOMAIN[product] && !domain) {
    await d.save(product, { status: "waiting", last_error: null });
    return { product, status: "waiting" };
  }
  const p = d.partner(product);
  if (!p.ok) return fail(p.error, false);
  const api = p.partner;

  const brand = await api.createBrand({ name: ws.name, domain, external_id: ws.id });
  if (!brand.ok) return fail(errorLine(product, brand), brand.retryable);
  const brandId = brand.data.id;
  if (brand.status !== 201) {
    const revoked = await api.revokeKeys(brandId);
    if (!revoked.ok) return fail(errorLine(product, revoked), revoked.retryable, brandId);
  }
  const key = await api.createKey(brandId);
  if (!key.ok) return fail(errorLine(product, key), key.retryable, brandId);
  let sealed: string;
  try {
    sealed = d.seal(key.data.key, keyAad(ws.id, product));
  } catch {
    return fail("The server can't seal brand keys. Check SEALING_KEYS.", false, brandId);
  }
  await d.save(product, { status: "ready", brand_id: brandId, sealed_key: sealed, key_prefix: String(key.data.prefix ?? "").slice(0, 40), last_error: null });
  return { product, status: "ready" };
}

/** Sets up every product that isn't ready yet. A database error throws, so the job tries again. */
export async function provision(d: ProvisionDeps): Promise<{ result: JobResult; products: ProductResult[] }> {
  const ws = await d.workspace();
  if (!ws) return { result: { status: "done" }, products: [] }; // the workspace was deleted: nothing to set up
  const have = new Map((await d.services()).map((s) => [s.product, s.status]));
  const settled = await Promise.allSettled(
    PRODUCTS.map((product) => (SKIP.has(have.get(product) ?? "pending") ? Promise.resolve<ProductResult>({ product, status: "skipped" }) : one(product, ws, d))),
  );
  const crashed = settled.find((s) => s.status === "rejected");
  if (crashed) throw crashed.reason;
  const products = settled.map((s) => (s as PromiseFulfilledResult<ProductResult>).value);
  const failed = products.filter((p) => p.status === "failed");
  if (!failed.length) return { result: { status: "done" }, products };
  const error = failed.map((f) => f.error).join(" ");
  return { result: failed.some((f) => f.retryable) ? { status: "retry", error } : { status: "failed", error }, products };
}
