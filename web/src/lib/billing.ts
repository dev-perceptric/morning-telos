import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planOfLookup } from "./plans";
import { getSubscription, type StripeEvent, type Subscription } from "./stripe";

// Keeps each workspace's plan in step with its Stripe subscription. Copied from Arrowsterr's billing.ts
// and Omniscient's applySubscription.

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));
const gone = (status: string) => status === "canceled" || status === "incomplete_expired";

/** The subscription an event is about, if any. */
export function subscriptionOf(event: StripeEvent): string | null {
  const o = event.data.object;
  if (event.type === "checkout.session.completed") return idOf(o.subscription as string | { id: string } | null);
  if (event.type.startsWith("invoice.")) {
    const parent = o.parent as { subscription_details?: { subscription?: string | { id: string } } } | null;
    return idOf((o.subscription as string | { id: string } | null | undefined) ?? parent?.subscription_details?.subscription);
  }
  return typeof o.id === "string" ? o.id : null;
}

/** When the workspace's saved subscription was made, so an older one can't replace it. 0 when it has ended. */
async function currentCreated(subId: string) {
  const sub = await getSubscription(subId).catch(() => null);
  return sub && !gone(sub.status) ? sub.created : 0;
}

/**
 * Write a subscription's plan, status and billing month to its workspace. Called from the webhook with the
 * subscription as Stripe has it now. Returns the workspace id, or null when no workspace matches.
 */
export async function syncSubscription(db: SupabaseClient, sub: Subscription): Promise<string | null> {
  const customer = idOf(sub.customer);
  const lookup = db.from("workspaces").select("id, plan, stripe_customer_id, stripe_subscription_id");
  const { data: ws, error: readError } = await (sub.metadata?.workspace_id ? lookup.eq("id", sub.metadata.workspace_id) : lookup.eq("stripe_customer_id", customer ?? "")).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!ws) return null;
  // A subscription never moves to a workspace that already belongs to another Stripe customer.
  if (ws.stripe_customer_id && customer && ws.stripe_customer_id !== customer) {
    console.error(`Subscription ${sub.id} is for customer ${customer}, but workspace ${ws.id} has ${ws.stripe_customer_id}. Left as it is.`);
    return null;
  }
  const ended = gone(sub.status);
  // An older subscription changing or ending never undoes the workspace's current one.
  if (ws.stripe_subscription_id && ws.stripe_subscription_id !== sub.id && (ended || sub.created < (await currentCreated(ws.stripe_subscription_id)))) return ws.id;
  const item = sub.items.data[0];
  const match = planOfLookup(item?.price.lookup_key);
  // A price with no Morning Telos lookup key keeps the plan as it is, so nobody gets a plan they didn't pay for.
  if (!ended && !match) console.error(`Subscription ${sub.id} has a price with no Morning Telos lookup key. Plan left as ${ws.plan}.`);
  const start = iso(item?.current_period_start ?? sub.current_period_start);
  const { error } = await db
    .from("workspaces")
    .update({
      plan: match?.plan ?? ws.plan,
      status: sub.status,
      stripe_customer_id: customer,
      stripe_subscription_id: ended ? null : sub.id,
      ...(start && !ended ? { period_start: start } : {}),
    })
    .eq("id", ws.id);
  // Throwing makes the webhook answer 500, so Stripe sends the event again.
  if (error) throw new Error(error.message);
  return ws.id;
}
