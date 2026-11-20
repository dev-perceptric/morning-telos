// Goals and plan steps in the database (supabase/022_goals.sql), for the card tools and the Monday check-in, with
// the server's client. The browser starts goals and plans itself, as the signed-in person, through row level
// security; only the server moves steps and writes a goal's number. Every query names the workspace (CLAUDE.md:
// server code checks the workspace too). Not "server-only", so the tests load it; only server code imports it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalFace, GoalPatch } from "./cardTools.ts";
import { GOAL_COLUMNS, goalOf, STEP_COLUMNS, type GoalRow, type StepRow } from "./goals.ts";

const MISSING = /goals|goal_steps/;
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(MISSING.test(r.error.message) && /exist|find/.test(r.error.message) ? "Run supabase/022_goals.sql in Supabase." : `${what}: ${r.error.message}`);
  return r.data;
};

/** The chat's newest active goal, or null. */
export async function activeGoal(db: SupabaseClient, ws: string, threadId: string): Promise<GoalRow | null> {
  const rows = must(await db.from("goals").select(GOAL_COLUMNS).eq("workspace_id", ws).eq("thread_id", threadId).eq("status", "active").order("created_at", { ascending: false }).limit(1), "Goals weren't read") as Record<string, unknown>[] | null;
  return rows?.[0] ? goalOf(rows[0]) : null;
}

/** One goal of this workspace, or null. */
export async function goalById(db: SupabaseClient, ws: string, id: string): Promise<GoalRow | null> {
  const row = must(await db.from("goals").select(GOAL_COLUMNS).eq("workspace_id", ws).eq("id", id).maybeSingle(), "The goal wasn't read") as Record<string, unknown> | null;
  return row ? goalOf(row) : null;
}

/** The steps of the chat's newest started plan, in order. */
export async function planSteps(db: SupabaseClient, ws: string, threadId: string): Promise<StepRow[]> {
  const rows = (must(await db.from("goal_steps").select(`${STEP_COLUMNS}, created_at`).eq("workspace_id", ws).eq("thread_id", threadId).order("created_at", { ascending: false }).limit(60), "Steps weren't read") ?? []) as (StepRow & { created_at: string })[];
  const plan = rows[0]?.plan_id;
  return rows.filter((r) => r.plan_id === plan).sort((a, b) => a.position - b.position).map(({ created_at: _c, ...r }) => (void _c, r));
}

export async function setStep(db: SupabaseClient, ws: string, id: string, status: StepRow["status"]): Promise<void> {
  must(await db.from("goal_steps").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ws), "The step wasn't saved");
}

export async function saveGoal(db: SupabaseClient, ws: string, id: string, patch: GoalPatch): Promise<void> {
  must(await db.from("goals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ws), "The goal wasn't saved");
}

/** The approval a preview card points at, only if it is in this workspace. */
export async function approvalFace(db: SupabaseClient, ws: string, id: number): Promise<ApprovalFace | null> {
  return must(await db.from("approvals").select("id, thread_id, product, tool, status, input").eq("workspace_id", ws).eq("id", id).maybeSingle(), "The approval wasn't read") as ApprovalFace | null;
}

/** How many approvals wait for a person in a chat. */
export async function pendingIn(db: SupabaseClient, ws: string, threadId: string): Promise<number> {
  const r = await db.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("thread_id", threadId).eq("status", "pending");
  return r.error ? 0 : (r.count ?? 0);
}
