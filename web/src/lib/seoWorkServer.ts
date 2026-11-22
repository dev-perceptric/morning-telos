// The database and product calls behind Theseus's Visibility tab (src/lib/seoWork.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { effectivePlan, questionLimit, type PlanFields } from "./plans.ts";
import { productRead, productWrite } from "./productTools.ts";
import { questionsOf, readJson, type SeoData } from "./seoWork.ts";
import { productDeps } from "./teamTools.ts";

export function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "seo-work" } });
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export function seoData(db: SupabaseClient, ws: string) {
  const products = productDeps(db, log);
  const read = (tool: string, input: Record<string, unknown>) => productRead(ws, "arrowsterr", tool, input, products);
  const cache = {
    get: async () => {
      const r = must(await db.from("work_cache").select("data, fetched_at").eq("workspace_id", ws).eq("agent", "seo").maybeSingle()) as { data: SeoData; fetched_at: string } | null;
      return r ? { data: r.data, fetchedAt: r.fetched_at } : null;
    },
    set: async (data: SeoData) => {
      must(await db.from("work_cache").upsert({ workspace_id: ws, agent: "seo", data, fetched_at: new Date().toISOString() }, { onConflict: "workspace_id,agent" }));
    },
    clear: async () => {
      must(await db.from("work_cache").delete().eq("workspace_id", ws).eq("agent", "seo"));
    },
  };
  const limit = async () => {
    const w = must(await db.from("workspaces").select("plan, status, trial_ends_at").eq("id", ws).maybeSingle()) as PlanFields | null;
    return w ? questionLimit(effectivePlan(w).plan) : 0;
  };
  return {
    read,
    cache,
    limit,
    serviceStatus: async () => (must(await db.from("services").select("status").eq("workspace_id", ws).eq("product", "arrowsterr").maybeSingle()) as { status: string } | null)?.status ?? null,
    approvals: async () =>
      must(await db.from("approvals").select("id, tool, input, status").eq("workspace_id", ws).eq("agent", "seo").eq("product", "arrowsterr").eq("status", "pending").order("id").limit(100)) as {
        id: number;
        tool: string;
        input: Record<string, unknown> | null;
        status: string;
      }[],
    write: (tool: string, input: Record<string, unknown>) => productWrite(ws, "arrowsterr", tool, input, products),
    // The saved copy when there is one, so counting doesn't cost a task; otherwise one read.
    tracked: async () => {
      const saved = await cache.get();
      if (saved) return saved.data.questions.length;
      return questionsOf(readJson(await read("get_prompts", { days: 30 }))).length;
    },
    activity: async (text: string) => {
      must(await db.from("activity").insert({ workspace_id: ws, agent: "seo", text }));
    },
  };
}
