import type { SupabaseClient } from "@supabase/supabase-js";
import { closeServices, expireTrials, planAction, trialOver, reopenServices, removeBrandJob, revokeKeysJob, type NewJob, type ServiceRow } from "./closeout.ts";
import { closeApps } from "./composio/store.ts";
import type { Handler } from "./jobs.ts";
import { partnerFor, type Product } from "./partner.ts";
import type { PlanFields } from "./plans.ts";

// closeout.ts wired to Supabase (the full-access client) and the partner APIs from the server's settings.
// Used by the delete route, the billing webhook and the worker.

/** A close happens while someone waits (delete, or Stripe's webhook), so each revoke gets less time than a job call. */
const CLOSE_TIMEOUT_MS = 8_000;

const log = (message: string) => console.error(message);

async function servicesOf(db: SupabaseClient, ws: string): Promise<ServiceRow[]> {
  const { data, error } = await db.from("services").select("product, status, brand_id").eq("workspace_id", ws);
  if (error) throw new Error(`Could not read services: ${error.message}`);
  return (data ?? []) as ServiceRow[];
}

async function queue(db: SupabaseClient, jobs: NewJob[]) {
  for (const job of jobs) {
    const { error } = await db.from("jobs").insert(job);
    if (error) throw new Error(`Could not queue ${job.kind}: ${error.message}`);
  }
}

/**
 * Revoke the workspace's brand keys now and queue each brand's removal in 30 days. First its own apps are
 * disconnected at Composio (best effort: Composio being down never stops the close).
 */
export async function closeWorkspace(db: SupabaseClient, ws: string, fetcher: typeof fetch = fetch) {
  await closeApps(db, ws, { fetcher, log });
  return closeServices(ws, {
    services: () => servicesOf(db, ws),
    partner: (product) => partnerFor(product, process.env, fetcher, CLOSE_TIMEOUT_MS),
    mark: async (product, patch) => {
      const { error } = await db.from("services").update({ ...patch, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("product", product);
      if (error) throw new Error(`Could not save the ${product} service: ${error.message}`);
    },
    queue: (jobs) => queue(db, jobs),
    now: () => new Date(),
    log,
  });
}

/** The subscription came back: stop the removals and make fresh brand keys. */
export function reopenWorkspace(db: SupabaseClient, ws: string) {
  return reopenServices(ws, {
    services: () => servicesOf(db, ws),
    cancelJobs: async (kinds, reason) => {
      let n = 0;
      for (const kind of kinds) {
        const { data, error } = await db.from("jobs").select("id").eq("workspace_id", ws).eq("kind", kind).is("done_at", null);
        if (error) throw new Error(`Could not read ${kind} jobs: ${error.message}`);
        for (const { id } of (data ?? []) as { id: number }[]) {
          const { error: e } = await db.from("jobs").update({ done_at: new Date().toISOString(), last_error: reason, locked_until: null }).eq("id", id);
          if (e) throw new Error(`Could not cancel job ${id}: ${e.message}`);
          n++;
        }
      }
      return n;
    },
    reset: async (product) => {
      const { error } = await db.from("services").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("product", product);
      if (error) throw new Error(`Could not save the ${product} service: ${error.message}`);
    },
    queue: (jobs) => queue(db, jobs),
    now: () => new Date(),
  });
}

async function planOf(db: SupabaseClient, ws: string): Promise<PlanFields | null> {
  const { data, error } = await db.from("workspaces").select("plan, status, trial_ends_at").eq("id", ws).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlanFields | null) ?? null;
}

/** After Stripe changes a workspace's plan: close its brands when the subscription ended, reopen them when it came back. */
export async function afterPlanChange(db: SupabaseClient, ws: string, fetcher: typeof fetch = fetch) {
  const data = await planOf(db, ws);
  if (!data) return "none";
  const action = planAction(data);
  if (action === "close") await closeWorkspace(db, ws, fetcher);
  if (action === "reopen") await reopenWorkspace(db, ws);
  return action;
}

/** The revoke_keys and remove_brand job handlers for the worker. */
export function brandJobHandlers(db: SupabaseClient, fetcher: typeof fetch = fetch): Record<"revoke_keys" | "remove_brand", Handler> {
  const deps = {
    partner: (product: Product) => partnerFor(product, process.env, fetcher),
    service: async (ws: string, product: Product) => {
      const { data, error } = await db.from("services").select("product, status, brand_id").eq("workspace_id", ws).eq("product", product).maybeSingle();
      if (error) throw new Error(`Could not read services: ${error.message}`);
      return (data as ServiceRow | null) ?? null;
    },
    markRemoved: async (ws: string, product: Product, brandId: string) => {
      const { error } = await db
        .from("services")
        .update({ status: "removed", sealed_key: null, key_prefix: null, last_error: null, updated_at: new Date().toISOString() })
        .eq("workspace_id", ws)
        .eq("product", product)
        .eq("brand_id", brandId)
        .eq("status", "removing");
      if (error) throw new Error(`Could not save the ${product} service: ${error.message}`);
    },
  };
  return { revoke_keys: (job) => revokeKeysJob(job, deps), remove_brand: (job) => removeBrandJob(job, deps) };
}

/** The daily expire_trials job: close the brands of every trial that ended without a plan (Stripe sends nothing then). */
export function expireTrialsHandler(db: SupabaseClient, fetcher: typeof fetch = fetch): Handler {
  return () =>
    expireTrials({
      find: async (n) => {
        const { data, error } = await db.rpc("expired_workspaces", { n });
        if (error) throw new Error(/expired_workspaces/.test(error.message) ? "Run supabase/010_expire_trials.sql in Supabase." : `Could not find expired trials: ${error.message}`);
        return (data ?? []) as string[];
      },
      expired: async (ws) => {
        const data = await planOf(db, ws);
        return Boolean(data) && trialOver(data!);
      },
      close: (ws) => closeWorkspace(db, ws, fetcher),
      reopen: (ws) => reopenWorkspace(db, ws),
      log,
    });
}
