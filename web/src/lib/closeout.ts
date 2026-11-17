// Closing a workspace's brands in Arrowsterr and Capybaroar (plan: Customer journey, step 8 "Cancel or delete").
// When a workspace is deleted or its subscription ends, every brand key is revoked at once and each brand is
// removed 30 days later, so a customer who comes back within 30 days keeps their brands and gets fresh keys.
// Pure: the database, the partner clients and the clock are passed in. src/lib/closeoutDb.ts wires in Supabase.
//
//   closeServices:  revoke keys now (a partner hiccup queues revoke_keys instead of blocking), mark removing,
//                   queue remove_brand for now + 30 days.
//   reopenServices: the subscription came back. Cancel the waiting revoke_keys and remove_brand jobs, set the
//                   services pending and queue provision, which makes fresh brand keys (src/lib/provision.ts).
//   revokeKeysJob, removeBrandJob: the two job handlers. They read only their payload, because a deleted
//                   workspace's rows are gone by the time they run.

import type { Job, JobResult } from "./jobs.ts";
import { PRODUCTS, type Partner, type Product } from "./partner.ts";
import { effectivePlan, type PlanFields } from "./plans.ts";
import { errorLine, type ServiceStatus } from "./provision.ts";

export const REMOVE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;
/** Revoking and removing keep trying for about two days (the backoff tops out at 6 hours). */
export const BRAND_JOB_ATTEMPTS = 12;
export const BRAND_JOB_KINDS = ["revoke_keys", "remove_brand"] as const;

export type ServiceRow = { product: Product; status: ServiceStatus; brand_id: string | null };
export type BrandJobPayload = { product: Product; brand_id: string; workspace_id: string };
export type NewJob = { kind: string; workspace_id: string; payload: Record<string, unknown>; run_at: string; max_attempts?: number };
type PartnerFor = (product: Product) => { ok: true; partner: Partner } | { ok: false; error: string };

const CLOSED: ReadonlySet<ServiceStatus> = new Set(["removing", "removed"]);

// ─────────────── when to close and reopen ───────────────

/** Stripe statuses that mean the subscription is over, not just a card being retried or a first payment going through. */
export const ENDED_STATUSES: ReadonlySet<string> = new Set(["canceled", "unpaid", "incomplete_expired"]);

/**
 * What a billing change means for the brands: "close" when the plan in force is expired because the subscription
 * ended (canceled at or past the period end, or unpaid), "reopen" while any plan is in force, else "none".
 */
export function planAction(ws: PlanFields, now = Date.now()): "close" | "reopen" | "none" {
  const plan = effectivePlan(ws, now).plan;
  if (plan !== "expired") return "reopen";
  return ws.status && ENDED_STATUSES.has(ws.status) ? "close" : "none";
}

// ─────────────── close ───────────────

export type CloseDeps = {
  services: () => Promise<ServiceRow[]>;
  partner: PartnerFor;
  /** Saves the service's new status and drops its sealed key. */
  mark: (product: Product, patch: { status: "removing" | "removed"; sealed_key: null; key_prefix: null; last_error: string | null }) => Promise<void>;
  queue: (jobs: NewJob[]) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
};

export type ClosedProduct = { product: Product; revoked: boolean; removeAt: string | null };

/** Revokes every brand key now and queues each brand's removal. A database error throws; a partner problem never does. */
export async function closeServices(workspaceId: string, d: CloseDeps): Promise<ClosedProduct[]> {
  const rows = (await d.services()).filter((s) => !CLOSED.has(s.status));
  const now = d.now();
  const removeAt = new Date(now.getTime() + REMOVE_AFTER_DAYS * DAY_MS).toISOString();
  const withBrand = rows.filter((s): s is ServiceRow & { brand_id: string } => Boolean(s.brand_id));

  const revoked = await Promise.all(
    withBrand.map(async (s) => {
      const p = d.partner(s.product);
      if (!p.ok) {
        d.log(`Revoke keys for workspace ${workspaceId}: ${p.error} Queued to try again.`);
        return false;
      }
      const r = await p.partner.revokeKeys(s.brand_id);
      if (r.ok || r.status === 404) return true;
      d.log(`Revoke keys for workspace ${workspaceId}: ${errorLine(s.product, r)} Queued to try again.`);
      return false;
    }),
  );

  const jobs: NewJob[] = [];
  const out: ClosedProduct[] = [];
  withBrand.forEach((s, i) => {
    const payload: BrandJobPayload = { product: s.product, brand_id: s.brand_id, workspace_id: workspaceId };
    if (!revoked[i]) jobs.push({ kind: "revoke_keys", workspace_id: workspaceId, payload, run_at: now.toISOString(), max_attempts: BRAND_JOB_ATTEMPTS });
    jobs.push({ kind: "remove_brand", workspace_id: workspaceId, payload, run_at: removeAt, max_attempts: BRAND_JOB_ATTEMPTS });
    out.push({ product: s.product, revoked: revoked[i], removeAt });
  });
  // The jobs first: if marking fails after this, the brand is still removed on time.
  if (jobs.length) await d.queue(jobs);
  for (const s of withBrand) await d.mark(s.product, { status: "removing", sealed_key: null, key_prefix: null, last_error: null });
  // No brand was made yet (pending or failed): nothing to remove in the product.
  for (const s of rows.filter((x) => !x.brand_id)) {
    await d.mark(s.product, { status: "removed", sealed_key: null, key_prefix: null, last_error: null });
    out.push({ product: s.product, revoked: true, removeAt: null });
  }
  return out;
}

// ─────────────── reopen ───────────────

export type ReopenDeps = {
  services: () => Promise<ServiceRow[]>;
  /** Marks the workspace's waiting jobs of these kinds done, so they never run. Returns how many. */
  cancelJobs: (kinds: readonly string[], reason: string) => Promise<number>;
  /** Sets the service pending again, keeping its brand_id, so provision picks it up. */
  reset: (product: Product) => Promise<void>;
  queue: (jobs: NewJob[]) => Promise<void>;
  now: () => Date;
};

/** The subscription came back: keep the brands, stop their removal, and make fresh brand keys. */
export async function reopenServices(workspaceId: string, d: ReopenDeps): Promise<{ reopened: Product[]; canceled: number }> {
  const closed = (await d.services()).filter((s) => CLOSED.has(s.status));
  if (!closed.length) return { reopened: [], canceled: 0 };
  // Cancel first, so a waiting revoke_keys can't kill the fresh key provision is about to make.
  const canceled = await d.cancelJobs(BRAND_JOB_KINDS, "Canceled: the subscription came back.");
  for (const s of closed) await d.reset(s.product);
  await d.queue([{ kind: "provision", workspace_id: workspaceId, payload: {}, run_at: d.now().toISOString() }]);
  return { reopened: closed.map((s) => s.product), canceled };
}

// ─────────────── the job handlers ───────────────

export type BrandJobDeps = {
  partner: PartnerFor;
  /** The workspace's service row for the product, or null (the workspace was deleted). */
  service: (workspaceId: string, product: Product) => Promise<ServiceRow | null>;
  /** Marks the service removed, only if it still holds this brand. */
  markRemoved: (workspaceId: string, product: Product, brandId: string) => Promise<void>;
};

export function brandPayload(p: Record<string, unknown>): BrandJobPayload | null {
  const product = p.product as Product;
  if (!PRODUCTS.includes(product) || typeof p.brand_id !== "string" || !p.brand_id || typeof p.workspace_id !== "string" || !p.workspace_id) return null;
  return { product, brand_id: p.brand_id, workspace_id: p.workspace_id };
}

/** True when the workspace came back and uses this brand again: the job must leave it alone. */
async function inUseAgain(b: BrandJobPayload, d: BrandJobDeps) {
  const s = await d.service(b.workspace_id, b.product);
  return { row: s, inUse: Boolean(s && s.brand_id === b.brand_id && !CLOSED.has(s.status)) };
}

async function brandCall(job: Job, d: BrandJobDeps, call: (api: Partner, brandId: string) => ReturnType<Partner["revokeKeys"]>, after?: (b: BrandJobPayload) => Promise<void>): Promise<JobResult> {
  const b = brandPayload(job.payload);
  if (!b) return { status: "failed", error: `A ${job.kind} job needs product, brand_id and workspace_id in its payload.` };
  if ((await inUseAgain(b, d)).inUse) return { status: "done" };
  const p = d.partner(b.product);
  if (!p.ok) return { status: "failed", error: p.error };
  const r = await call(p.partner, b.brand_id);
  // 404: the brand (or its keys) is already gone, which is what we wanted.
  if (!r.ok && r.status !== 404) return { status: r.retryable ? "retry" : "failed", error: errorLine(b.product, r) };
  if (after) await after(b);
  return { status: "done" };
}

/** revoke_keys: the revoke at close time failed, so it is tried again here. */
export const revokeKeysJob = (job: Job, d: BrandJobDeps) => brandCall(job, d, (api, id) => api.revokeKeys(id));

/** remove_brand: 30 days after close, delete the brand in the product. */
export const removeBrandJob = (job: Job, d: BrandJobDeps) =>
  brandCall(job, d, (api, id) => api.removeBrand(id), (b) => d.markRemoved(b.workspace_id, b.product, b.brand_id));
