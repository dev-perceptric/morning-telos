// Stripe billing over its HTTPS API (no SDK needed).
import crypto from "node:crypto";
import { q, one, getSetting } from "./db.js";
import { decrypt } from "./util.js";

async function stripeKey() {
  const c = await one("select secret_enc, status from connections where tool='stripe'");
  return c?.status === "ok" ? decrypt(c.secret_enc) : null;
}
export async function stripeReady() { return !!(await stripeKey()); }

function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
export async function stripe(path, body, key, method) {
  key = key || (await stripeKey());
  if (!key) throw new Error("Billing isn't set up yet.");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Stripe error ${r.status}`);
  return data;
}

export async function checkoutUrl(ws, user, plan, origin) {
  const body = {
    mode: "subscription",
    "line_items[0][price]": plan.stripe_price_id,
    "line_items[0][quantity]": 1,
    success_url: `${origin}/#billing?paid=1`,
    cancel_url: `${origin}/#billing`,
    client_reference_id: String(ws.id),
    allow_promotion_codes: "true",
    metadata: { workspace_id: ws.id, plan: plan.key },
    subscription_data: { metadata: { workspace_id: ws.id, plan: plan.key } },
  };
  if (ws.stripe_customer_id) body.customer = ws.stripe_customer_id; else body.customer_email = user.email;
  return (await stripe("checkout/sessions", body)).url;
}
export async function portalUrl(ws, origin) {
  if (!ws.stripe_customer_id) throw new Error("No billing account yet. Pick a plan first.");
  return (await stripe("billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: `${origin}/#billing` })).url;
}

// Checks the Stripe-Signature header (HMAC-SHA256 of "t.body", 5 minute window).
export async function verifyWebhook(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || decrypt(await getSetting("stripe_webhook_secret"));
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

async function planForPrice(priceId) {
  return (await one("select key from plans where stripe_price_id=$1", [priceId]))?.key || null;
}
export async function handleEvent(ev) {
  const o = ev.data?.object || {};
  if (ev.type === "checkout.session.completed") {
    const wsId = Number(o.metadata?.workspace_id || o.client_reference_id);
    if (!wsId) return;
    await q("update workspaces set stripe_customer_id=$2, stripe_subscription_id=$3, plan=coalesce($4, plan), status='active', period_start=now() where id=$1",
      [wsId, o.customer, o.subscription, o.metadata?.plan || null]);
  } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.created" || ev.type === "customer.subscription.deleted") {
    const ws = await one("select id from workspaces where stripe_subscription_id=$1 or stripe_customer_id=$2 order by (stripe_subscription_id=$1) desc limit 1", [o.id, o.customer]);
    if (!ws) return;
    const plan = await planForPrice(o.items?.data?.[0]?.price?.id);
    const status = ev.type === "customer.subscription.deleted" ? "canceled" : o.status;
    await q("update workspaces set status=$2, plan=coalesce($3, plan), stripe_subscription_id=$4 where id=$1", [ws.id, status, plan, o.id]);
  } else if (ev.type === "invoice.paid" && o.billing_reason === "subscription_cycle") {
    await q("update workspaces set period_start=now(), status='active' where stripe_customer_id=$1", [o.customer]);
  } else if (ev.type === "invoice.payment_failed") {
    await q("update workspaces set status='past_due' where stripe_customer_id=$1", [o.customer]);
  }
}
