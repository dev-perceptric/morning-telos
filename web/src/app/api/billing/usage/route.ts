import { spendWindowStart } from "@/lib/meter";
import { effectivePlan } from "@/lib/plans";
import { adminClient, requireRole } from "@/lib/serverAuth";

// How much of this period's AI allowance the workspace used, for the Billing page's meter. Anyone in the workspace
// may read it. AI spend (ai_usage) is server only, so this route reads it with the server key, for this workspace only.
// Never returns the Stripe ids: just whether billing is set up, so the owner sees Manage billing.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const { data: ws } = await db.from("workspaces").select("plan, status, trial_ends_at, period_start, stripe_customer_id").eq("id", body.workspaceId).maybeSingle();
  if (!ws) return Response.json({ error: "That workspace was not found." }, { status: 404 });
  const plan = effectivePlan(ws);
  const since = spendWindowStart(ws);
  const { data: spent, error } = await db.rpc("ai_spend", { p_ws: body.workspaceId, p_since: since });
  if (error) return Response.json({ error: "We couldn't read your AI use. Try again." }, { status: 500 });
  const used = Math.round(Number(spent ?? 0) * 100) / 100;
  // The internal plan has no real limit, so no meter.
  const allowance = plan.plan === "internal" ? null : plan.aiAllowance;
  const percent = allowance ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  return Response.json({ plan: plan.plan, daysLeft: plan.daysLeft, status: plan.status, used, allowance, percent, since, hasBilling: Boolean(ws.stripe_customer_id) });
}
