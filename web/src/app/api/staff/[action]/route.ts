import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, signedInUser } from "@/lib/serverAuth";
import { isStaff, STAFF_MESSAGES, staffRoute, type StaffAction, type StaffApproval, type StaffDeps, type StaffJob, type StaffService, type StaffWorkspaceRow } from "@/lib/staff";

// The staff console's routes (src/lib/staff.ts says what each one does). POST /api/staff/<action> with the signed-in
// person's token. Only people whose confirmed email is in STAFF_EMAILS get past the first check; everyone else gets
// 404, the same as a page that doesn't exist. Staff read every workspace, so this uses the service role, and every
// change runs in one SQL function that also writes its staff_actions row (supabase/017_staff.sql).
export const dynamic = "force-dynamic";

const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "staff" } });
}

/** Throws the database's error so the route answers with one short line and Sentry gets the details. */
function rows<T>(r: { data: unknown; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

function deps(db: SupabaseClient, staff: StaffDeps["staff"]): StaffDeps {
  return {
    staff,
    now: () => Date.now(),
    workspaces: async (since, id) => rows<StaffWorkspaceRow[]>(await db.rpc("staff_workspaces", { p_since: since, ...(id ? { p_ws: id } : {}) })) ?? [],
    aiTotal: async (since) => rows<number | string>(await db.rpc("staff_ai_total", { p_since: since })) ?? 0,
    openJobsSince: async (since) => rows<StaffJob[]>(await db.from("jobs").select("attempts, max_attempts, done_at").is("done_at", null).gte("run_at", since).limit(5000)) ?? [],
    openJobs: async (ws) =>
      rows<StaffJob[]>(await db.from("jobs").select("id, kind, attempts, max_attempts, last_error, run_at, created_at, done_at").eq("workspace_id", ws).is("done_at", null).order("id", { ascending: false }).limit(200)) ?? [],
    // Never the sealed brand key: only these fields are read, and only these are sent on.
    services: async (ws) =>
      (rows<StaffService[]>(await db.from("services").select("product, status, brand_id, key_prefix, last_error, updated_at").eq("workspace_id", ws).order("product")) ?? []).map((s) => ({
        product: s.product,
        status: s.status,
        brand_id: s.brand_id ?? null,
        key_prefix: s.key_prefix ?? null,
        last_error: s.last_error ?? null,
        updated_at: s.updated_at,
      })),
    pendingBefore: async (ws, before) =>
      rows<StaffApproval[]>(await db.from("approvals").select("id, agent, title, created_at").eq("workspace_id", ws).eq("status", "pending").lt("created_at", before).order("created_at").limit(100)) ?? [],
    actions: async (ws) => rows<StaffAction[]>(await db.from("staff_actions").select("id, staff_email, action, details, created_at").eq("workspace_id", ws).order("id", { ascending: false }).limit(20)) ?? [],
    droppedEmails: async (sinceDay) => {
      const r = await db.from("team_email_drops").select("count").gte("day", sinceDay).limit(5000);
      // Before 023_team_email.sql runs there is no table: no count, and the console still loads.
      if (r.error) return 0;
      return ((r.data ?? []) as { count: number }[]).reduce((n, x) => n + (Number(x.count) || 0), 0);
    },
    setPlan: async (who, ws, p) => rows(await db.rpc("staff_set_plan", { p_staff: who.userId, p_email: who.email, p_ws: ws, p_plan: p.plan, p_status: p.status })),
    extendTrial: async (who, ws, days) => rows(await db.rpc("staff_extend_trial", { p_staff: who.userId, p_email: who.email, p_ws: ws, p_days: days })),
    retryJob: async (who, ws, jobId) => rows(await db.rpc("staff_retry_job", { p_staff: who.userId, p_email: who.email, p_ws: ws, p_job: jobId })),
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const user = await signedInUser(request).catch(() => null);
  // "me" answers every signed-in person, so the app can hide the Staff link without a 404 in everyone's console.
  // It says only whether they are staff.
  if (action === "me" && user && !isStaff(user, process.env.STAFF_EMAILS)) return reply({ staff: false });
  // Not staff: 404 before anything else, with no hint that the other staff routes exist.
  if (!isStaff(user, process.env.STAFF_EMAILS)) return reply({ error: STAFF_MESSAGES.notFound }, 404);
  const db = adminClient();
  if (!db) return reply({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);
  const staff = async () => ({ userId: user!.id, email: user!.email!.toLowerCase() });
  try {
    const out = await staffRoute(action, body && typeof body === "object" ? body : {}, deps(db, staff));
    return reply(out.body, out.status);
  } catch (e) {
    log(`Staff ${action} by ${user!.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply({ error: STAFF_MESSAGES.failed }, 500);
  }
}
