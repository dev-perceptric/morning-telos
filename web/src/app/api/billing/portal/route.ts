import { adminClient, requireRole } from "@/lib/serverAuth";
import { originOf, PAYMENTS_OFF, stripe, stripeReady } from "@/lib/stripe";
import { routeError } from "@/lib/routeError";

// Stripe's customer portal: card, invoices, plan changes and canceling. Owner only.
// Copied from Arrowsterr's billing portal route.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "owner");
  if ("denied" in auth) return auth.denied;
  if (!stripeReady()) return Response.json({ error: PAYMENTS_OFF }, { status: 503 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const { data: ws } = await db.from("workspaces").select("stripe_customer_id").eq("id", body.workspaceId).maybeSingle();
  if (!ws?.stripe_customer_id) return Response.json({ error: "Pick a plan first." }, { status: 400 });
  try {
    const session = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: `${originOf(request)}/billing` });
    return Response.json({ url: session.url });
  } catch (e) {
    return routeError(e, "billing-portal", "We couldn't open billing. Try again.");
  }
}
