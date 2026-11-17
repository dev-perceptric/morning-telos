import { subscriptionOf, syncSubscription } from "@/lib/billing";
import { adminClient } from "@/lib/serverAuth";
import { getSubscription, readEvent, type Subscription } from "@/lib/stripe";

// Stripe calls this on every billing change. In Stripe, Developers, Webhooks, add
// https://chat.morningtelos.com/api/billing/webhook with the events below, and put its signing secret in STRIPE_WEBHOOK_SECRET.
// Copied from Arrowsterr's and Omniscient's billing webhook.
const EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const raw = await request.text();
  const event = readEvent(raw, request.headers.get("stripe-signature"));
  if (!event) return Response.json({ error: "Bad signature." }, { status: 400 });
  if (!EVENTS.has(event.type)) return Response.json({ received: true, skipped: event.type });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });

  // Each event once. Stripe resends until it gets a 2xx, so a failure below removes the mark.
  const { error: dupe } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === "23505") return Response.json({ received: true, duplicate: true });
    return Response.json({ error: dupe.message }, { status: 500 });
  }

  try {
    const subId = subscriptionOf(event);
    if (subId) {
      // Events can arrive out of order, so read the subscription as it is now. A deleted one can't be read, so its event copy is used.
      const sub = event.type === "customer.subscription.deleted" ? (event.data.object as unknown as Subscription) : await getSubscription(subId);
      if (event.type === "checkout.session.completed" && !sub.metadata?.workspace_id) {
        const ws = event.data.object.client_reference_id;
        if (typeof ws === "string") sub.metadata = { ...sub.metadata, workspace_id: ws };
      }
      await syncSubscription(db, sub);
    }
    return Response.json({ received: true });
  } catch (e) {
    await db.from("stripe_events").delete().eq("id", event.id);
    const message = e instanceof Error ? e.message : String(e);
    console.error("Stripe webhook failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
