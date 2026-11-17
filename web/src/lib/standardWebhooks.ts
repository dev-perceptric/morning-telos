// The Standard Webhooks signature check (standardwebhooks.com), shared by every webhook that uses it: Supabase's Send
// Email hook (src/lib/emailHook.ts) and Capybaroar's partner webhook (src/lib/social.ts). Pure, no server imports.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far a webhook's timestamp may be from now, in seconds. */
export const HOOK_WINDOW = 300;

/**
 * Standard Webhooks check: HMAC-SHA256 of "id.timestamp.body" with the secret, sent within 5 minutes.
 * The secret is the one the sender shows, like "whsec_<base64>" or Supabase's "v1,whsec_<base64>".
 */
export function verifyWebhook(headers: Headers, body: string, secretSetting: string | undefined, nowSeconds = Date.now() / 1000): boolean {
  const secret = secretSetting?.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  if (!secret || !id || !ts || !sigs) return false;
  if (!/^\d+$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > HOOK_WINDOW) return false;
  const want = createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
