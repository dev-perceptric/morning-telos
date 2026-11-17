// Make Morning Telos's products and prices in Stripe: STRIPE_SECRET_KEY=sk_... npm run stripe:setup
// Run it once with the test key and once with the live key. Safe to run again: it only adds what is missing,
// and moves a lookup key to a new price when a plan's price changed in src/lib/plans.ts.
// Customers already paying keep their old price until you move them in Stripe.
// Copied from Omniscient's and Arrowsterr's scripts/stripe-setup.mjs (Arrowsterr's REST client, no stripe package).

import { PAID_PLANS, PLANS, lookupKey, priceCents } from "../src/lib/plans.ts";

const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
if (!key) {
  console.error("Set STRIPE_SECRET_KEY first.");
  process.exit(1);
}

function encode(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => out.append(`${name}[${i}]`, String(x)));
    else if (typeof v === "object") encode(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

async function stripe(method, path, params = {}) {
  const body = encode(params);
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

for (const id of PAID_PLANS) {
  const plan = PLANS[id];
  const productId = `morningtelos_${id}`;
  const product = await stripe("GET", `products/${productId}`).catch(() => null);
  if (!product) {
    await stripe("POST", "products", { id: productId, name: `Morning Telos ${plan.name}`, metadata: { plan: id } });
    console.log("Made product", productId);
  } else if (!product.active) {
    await stripe("POST", `products/${productId}`, { active: true });
  }
  const interval = "month";
  const lk = lookupKey(id, interval);
  const cents = priceCents(id);
  const { data } = await stripe("GET", "prices", { lookup_keys: [lk], active: true, limit: 1 });
  if (data[0]?.unit_amount === cents && data[0]?.recurring?.interval === interval) {
    console.log(`${lk}: $${cents / 100} ok`);
    continue;
  }
  await stripe("POST", "prices", {
    product: productId,
    currency: "usd",
    unit_amount: cents,
    recurring: { interval },
    lookup_key: lk,
    transfer_lookup_key: true,
    tax_behavior: "exclusive",
    metadata: { plan: id, interval },
  });
  console.log(`${lk}: $${cents / 100} ${data[0] ? "updated" : "made"}`);
}
console.log("Done.");
