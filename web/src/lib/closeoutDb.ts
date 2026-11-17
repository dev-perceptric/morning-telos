import type { SupabaseClient } from "@supabase/supabase-js";
import { closeServices, planAction, reopenServices, removeBrandJob, revokeKeysJob, type NewJob, type ServiceRow } from "./closeout.ts";
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

/** Revoke the workspace's brand keys now and queue each brand's removal in 30 days. */
export function closeWorkspace(db: SupabaseClient, ws: string, fetcher: typeof fetch = fetch) {
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

/** After Stripe changes a workspace's plan: close its brands when the subscription ended, reopen them when it came back. */
export async function afterPlanChange(db: SupabaseClient, ws: string, fetcher: typeof fetch = fetch) {
  const { data, error } = await db.from("workspaces").select("plan, status, trial_ends_at").eq("id", ws).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return "none";
  const action = planAction(data as PlanFields);
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
