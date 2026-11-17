// Running one claimed job (supabase/006_jobs.sql): pick its handler, then say how the row changes.
// Pure: the worker route (src/app/api/worker/route.ts) claims the jobs and saves each patch.
// Copied from Omniscient's runJobs and Arrowsterr's retry_job, with a fixed backoff instead of doubling.

export type Job = { id: number; kind: string; workspace_id: string | null; payload: Record<string, unknown>; attempts: number; max_attempts: number };

/** What a handler says happened. "retry" is a hiccup worth trying again; "failed" won't fix itself. */
export type JobResult = { status: "done" } | { status: "retry"; error: string } | { status: "failed"; error: string };
export type Handler = (job: Job) => Promise<JobResult>;
/** Tells us a job gave up for good. Never shown to customers. */
export type Alert = (message: string, job: Job) => void | Promise<void>;

/** Wait before the next try, by the attempt that just failed: 1 minute, 5 minutes, 30 minutes, 2 hours, then 6 hours. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;
export const backoffMs = (attempt: number) => BACKOFF_MS[Math.min(Math.max(1, Math.floor(attempt)), BACKOFF_MS.length) - 1];

export type JobPatch = { done_at?: string; run_at?: string; attempts?: number; locked_until: null; last_error: string | null };
export type JobOutcome = { outcome: "done" | "retry" | "failed"; patch: JobPatch; error?: string };

const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 1000);

/**
 * Runs the job's handler and returns the change to save. A handler that throws counts as a hiccup. The claim already
 * counted this attempt, so a retry is only planned while attempts < max_attempts. A job that gives up keeps its
 * last_error, never runs again (attempts = max_attempts) and calls `alert`.
 */
export async function runJob(job: Job, handlers: Record<string, Handler>, o: { now: () => Date; alert: Alert }): Promise<JobOutcome> {
  const handler = Object.hasOwn(handlers, job.kind) ? handlers[job.kind] : undefined;
  let result: JobResult;
  if (!handler) result = { status: "failed", error: `Unknown job kind "${job.kind}".` };
  else {
    try {
      result = await handler(job);
    } catch (e) {
      result = { status: "retry", error: e instanceof Error ? e.message : String(e) };
    }
  }
  const now = o.now();
  if (result.status === "done") return { outcome: "done", patch: { done_at: now.toISOString(), locked_until: null, last_error: null } };
  const error = short(result.error) || "Failed with no message.";
  if (result.status === "retry" && job.attempts < job.max_attempts) {
    return { outcome: "retry", error, patch: { run_at: new Date(now.getTime() + backoffMs(job.attempts)).toISOString(), locked_until: null, last_error: error } };
  }
  const why = result.status === "retry" ? `Gave up after ${job.attempts} tries. ${error}` : error;
  try {
    await o.alert(`Job ${job.id} (${job.kind}${job.workspace_id ? `, workspace ${job.workspace_id}` : ""}) failed: ${why}`, job);
  } catch {
    // An alert that can't be sent must not stop the job's row from being saved.
  }
  return { outcome: "failed", error: why, patch: { attempts: Math.max(job.attempts, job.max_attempts), locked_until: null, last_error: short(why) } };
}
