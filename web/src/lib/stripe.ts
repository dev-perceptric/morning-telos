import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// A small Stripe client over its REST API, copied from Arrowsterr. Needs STRIPE_SECRET_KEY,
// and STRIPE_WEBHOOK_SECRET for the webhook.

/** The app's own address, for links back from Stripe. */
export const originOf = (request: Request) => process.env.APP_URL?.trim().replace(/\/+$/, "") || request.headers.get("origin") || new URL(request.url).origin;

export const stripeReady = () => Boolean(process.env.STRIPE_SECRET_KEY?.trim());

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects become a[b][c]=v, arrays a[0]=v. */
function encode(params: Params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" && x !== null ? encode(x as Params, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") encode(v as Params, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set on the server.");
  const body = encode(params);
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe: ${(data as { error?: { message?: string } }).error?.message ?? res.status}`);
  return data as T;
}

export type Price = { id: string; lookup_key: string | null; unit_amount: number | null; recurring: { interval: string } | null };
export type Subscription = {
  id: string;
  created: number;
  schedule: string | { id: string } | null;
  customer: string | { id: string };
  status: string;
  metadata: Record<string, string>;
  current_period_start?: number;
  items: { data: { id: string; price: Price; current_period_start?: number }[] };
};
export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

const prices = new Map<string, { at: number; price: Price }>();

/** The live price for a lookup key, like morningtelos_pro_month. Prices are made by scripts/stripe-setup.mjs, never here. */
export async function priceFor(lookupKey: string): Promise<Price> {
  const hit = prices.get(lookupKey);
  if (hit && Date.now() - hit.at < 600_000) return hit.price;
  const { data } = await stripe<{ data: Price[] }>("GET", "prices", { lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = data[0];
  if (!price) throw new Error(`Stripe has no price ${lookupKey}. Run npm run stripe:setup with this Stripe key.`);
  prices.set(lookupKey, { at: Date.now(), price });
  return price;
}

/** Forget cached prices. For tests and after running the setup script. */
export const forgetPrices = () => prices.clear();

export const getSubscription = (id: string) => stripe<Subscription>("GET", `subscriptions/${id}`);

/** Check a webhook really came from Stripe, and was signed in the last 5 minutes. Returns the event, or null. */
export function readEvent(raw: string, header: string | null, now = Date.now()): StripeEvent | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return null;
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return null;
  const want = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
