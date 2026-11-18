import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandJobHandlers, expireTrialsHandler } from "@/lib/closeoutDb";
import { teamClient } from "@/lib/claude";
import { cronAllowed } from "@/lib/cronAuth";
import { STALE_AFTER } from "@/lib/approvals";
import { runJob, type Handler, type Job } from "@/lib/jobs";
import { lifecycleEmailsHandler } from "@/lib/lifecycleDb";
import { partnerFor, type Product } from "@/lib/partner";
import { provision, type ServicePatch, type ServiceStatus } from "@/lib/provision";
import { routineJobHandlers } from "@/lib/routinesServer";
import { seal } from "@/lib/sealing";
import { knowledgeJobHandlers } from "@/lib/siteScanDb";
import { adminClient } from "@/lib/serverAuth";

// One worker tick: claim the jobs that are due (supabase/006_jobs.sql) and run them a few at a time.
// Copied from Arrowsterr's and Omniscient's /api/worker.
//
// How it runs: the server calls this every minute with the CRON_SECRET, the way Arrowsterr's worker calls its
// /api/worker (scripts/worker.mjs there: POST with "Authorization: Bearer <CRON_SECRET>"). On the VPS, as root:
//   1. Put the header in a file only root can read:
//        printf 'Authorization: Bearer %s\n' "<CRON_SECRET>" > /root/.morningtelos-worker && chmod 600 /root/.morningtelos-worker
//   2. crontab -e, and add:
//        * * * * * curl -fsS -m 280 -X POST -H @/root/.morningtelos-worker https://chat.morningtelos.com/api/worker >/dev/null
// CRON_SECRET is the same value in the web container's settings. A wrong or missing secret gets 401 and runs nothing.
// Ticks may overlap: claim_jobs skips jobs another tick holds, and a job's lease brings it back if a tick dies.
// Daily jobs need no cron line of their own: each tick calls queue_daily_jobs() (supabase/010_expire_trials.sql),
// which queues each one once per UTC day. Hourly jobs the same way with queue_hourly_jobs() (018_email_log.sql).
// Routines the same way: queue_routine_runs() queues each due one once.
// When the worker image (plan: Deploy, morningtelos-worker) lands, it calls this in a loop instead of cron.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** How long a claimed job is held. A provision job makes at most 6 calls of 15 seconds. */
const LEASE = "5 minutes";
const CONCURRENCY = 4;

type ServiceRow = { product: Product; status: ServiceStatus };

/** Every job kind this worker knows. Any other kind fails with a clear last_error. */
function handlers(db: SupabaseClient): Record<string, Handler> {
  return {
    // Closing a deleted or canceled workspace's brands (src/lib/closeout.ts): a revoke that failed at close time,
    // and the brand's removal 30 days later.
    ...brandJobHandlers(db),
    // Once a day: close the brands of trials that ended without a plan, which Stripe tells us nothing about.
    expire_trials: expireTrialsHandler(db),
    // Once an hour: trial and lifecycle emails to each owner, each one once (src/lib/lifecycleSend.ts).
    lifecycle_emails: lifecycleEmailsHandler(db, { log: (m) => warn(m, "lifecycle_emails") }),
    // Reading the customer's website into Knowledge (src/lib/siteScan.ts).
    ...knowledgeJobHandlers(db),
    // A routine's scheduled run: its teammate does the job in a new chat (src/lib/routinesServer.ts).
    ...routineJobHandlers(db, { client: teamClient, log: (m) => warn(m, "run_routine") }),
    provision: async (job) => {
      const ws = job.workspace_id;
      if (!ws) return { status: "failed", error: "A provision job needs a workspace." };
      const { result, products } = await provision({
        workspace: async () => {
          const { data, error } = await db.from("workspaces").select("id, name, website").eq("id", ws).maybeSingle();
          if (error) throw new Error(`Could not read the workspace: ${error.message}`);
          return data as { id: string; name: string; website: string | null } | null;
        },
        services: async () => {
          const { data, error } = await db.from("services").select("product, status").eq("workspace_id", ws);
          if (error) throw new Error(`Could not read services: ${error.message}`);
          return (data ?? []) as ServiceRow[];
        },
        partner: (product) => partnerFor(product, process.env, fetch),
        seal,
        save: async (product, patch: ServicePatch) => {
          const row: Record<string, unknown> = { workspace_id: ws, product, ...patch, updated_at: new Date().toISOString() };
          const { error } = await db.from("services").upsert(row, { onConflict: "workspace_id,product" });
          if (error) throw new Error(`Could not save the ${product} service: ${error.message}`);
        },
      });
      // A product that won't fix itself (domain_taken, plan_limit, a 403 or 404) is told to staff now, even while the
      // other product's hiccup keeps the job retrying. When the whole job fails, runJob alerts instead.
      if (result.status === "retry") {
        for (const p of products.filter((x) => x.status === "failed" && !x.retryable)) alert(`Provision for workspace ${ws}: ${p.error}`, job);
      }
      return result;
    },
  };
}

/** A job that gave up. Goes to Sentry when it's set up, and to the server log. */
function alert(message: string, job: Job) {
  console.error(message);
  Sentry.captureMessage(message, { level: "error", tags: { job_kind: job.kind }, extra: { job_id: job.id, workspace_id: job.workspace_id } });
}

/** A problem outside any job (the daily jobs couldn't be queued), or inside a routine's turn. Sentry groups repeats of the same line. */
function warn(message: string, kind = "daily") {
  console.error(message);
  Sentry.captureMessage(message, { level: kind === "daily" ? "error" : "warning", tags: { job_kind: kind } });
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function POST(request: Request) {
  if (!cronAllowed(request.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });

  // A missing daily job must not stop the jobs that are due, so a problem here is only logged.
  const daily = await db.rpc("queue_daily_jobs");
  if (daily.error) warn(/queue_daily_jobs/.test(daily.error.message) ? "Run supabase/010_expire_trials.sql in Supabase." : `Daily jobs: ${daily.error.message}`);
  const hourly = await db.rpc("queue_hourly_jobs");
  if (hourly.error) warn(/queue_hourly_jobs/.test(hourly.error.message) ? "Run supabase/018_email_log.sql in Supabase." : `Hourly jobs: ${hourly.error.message}`);
  // Routines due this minute in each workspace's time zone, queued once each (supabase/014_routines_skills_memory.sql).
  const routines = await db.rpc("queue_routine_runs");
  if (routines.error) warn(/queue_routine_runs/.test(routines.error.message) ? "Run supabase/014_routines_skills_memory.sql in Supabase." : `Routines: ${routines.error.message}`, "routines");

  // An approved change whose call never finished (the server restarted mid-call) is failed, so a person checks it.
  const stale = await db.rpc("fail_stale_approvals", { p_older: STALE_AFTER });
  if (stale.error) warn(/fail_stale_approvals/.test(stale.error.message) ? "Run supabase/013_approvals.sql in Supabase." : `Stale approvals: ${stale.error.message}`);

  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 10));
  const { data, error } = await db.rpc("claim_jobs", { n: limit, lease: LEASE });
  if (error) return Response.json({ error: /claim_jobs/.test(error.message) ? "Run supabase/006_jobs.sql in Supabase." : `Queue: ${error.message}` }, { status: 500 });

  const jobs = (data ?? []) as Job[];
  const run = handlers(db);
  const counts = { done: 0, retry: 0, failed: 0 };
  await pool(jobs, CONCURRENCY, async (job) => {
    const out = await runJob(job, run, { now: () => new Date(), alert });
    counts[out.outcome]++;
    if (out.error) console.error(`Job ${job.id} (${job.kind}) ${out.outcome}: ${out.error}`);
    const { error } = await db.from("jobs").update(out.patch).eq("id", job.id);
    // The lease runs out on its own, so a job whose row couldn't be saved comes back later.
    if (error) console.error(`Job ${job.id} could not be saved: ${error.message}`);
  });
  return Response.json({ claimed: jobs.length, ...counts }, { headers: { "Cache-Control": "no-store" } });
}
