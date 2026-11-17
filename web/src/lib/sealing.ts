// Sealing secrets at rest (brand keys from Arrowsterr and Capybaroar) with AES-256-GCM and named keys.
// Copied from Capybaroar's src/lib/sealing.ts, without its old v1 format. Pure (no Supabase, no "server-only"),
// so tests use the same code the app does.
//
// Format: v2.<kid>.<iv>.<tag>.<body>. <kid> names the key; the version and kid are bound into the GCM additional
// data, with the caller's optional AAD (the workspace id and product, say), so a value can't be moved to another
// row or relabelled with another key.
//
// Keys come from the environment:
// - SEALING_KEYS="kid1:base64,kid2:base64"  every key that may still be in use, 32 bytes each.
// - SEALING_KEY_CURRENT=kid2                 the key new values are sealed with. Empty means the first one.
// Make a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Keyring = { current: string; keys: ReadonlyMap<string, Buffer> };
type Env = Record<string, string | undefined>;

const KID = /^[A-Za-z0-9_-]{1,32}$/;

function keyBytes(b64: string, name: string) {
  const k = Buffer.from(b64.trim(), "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
}

/** The keys from SEALING_KEYS and SEALING_KEY_CURRENT. Throws on a malformed or missing key. */
export function keyringFromEnv(env: Env = process.env): Keyring {
  const keys = new Map<string, Buffer>();
  for (const part of (env.SEALING_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(":");
    const kid = at > 0 ? part.slice(0, at).trim() : "";
    if (!KID.test(kid)) throw new Error("SEALING_KEYS entries are kid:base64, kid letters, digits, - or _");
    if (keys.has(kid)) throw new Error(`SEALING_KEYS names ${kid} twice`);
    keys.set(kid, keyBytes(part.slice(at + 1), `SEALING_KEYS ${kid}`));
  }
  if (!keys.size) throw new Error("SEALING_KEYS is not set. Add kid:base64 with a 32-byte key.");
  const current = env.SEALING_KEY_CURRENT?.trim() || keys.keys().next().value!;
  if (!keys.has(current)) throw new Error(`SEALING_KEY_CURRENT ${current} is not in SEALING_KEYS`);
  return { current, keys };
}

let cached: { sig: string; ring: Keyring } | null = null;
/** The keyring for this process, read again only when the variables change. */
export function envKeyring(env: Env = process.env): Keyring {
  const sig = `${env.SEALING_KEYS ?? ""}|${env.SEALING_KEY_CURRENT ?? ""}`;
  if (cached?.sig !== sig) cached = { sig, ring: keyringFromEnv(env) };
  return cached.ring;
}

const additional = (kid: string, aad?: string) => Buffer.from(`v2.${kid}\0${aad ?? ""}`, "utf8");

/** Seals `plain` with the ring's current key. Pass the same `aad` to open it. */
export function sealWith(ring: Keyring, plain: string, aad?: string): string {
  const kid = ring.current;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.keys.get(kid)!, iv);
  c.setAAD(additional(kid, aad));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v2.${kid}.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

/** The key a sealed value was made with, or null when it isn't a sealed value. */
export function sealedKid(sealed: string): string | null {
  const p = sealed.split(".");
  return p[0] === "v2" && p.length === 5 && KID.test(p[1]) ? p[1] : null;
}

function decrypt(key: Buffer, iv: string, tag: string, body: string, aad: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAAD(aad);
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** Opens a sealed value. Throws when the key is gone, the value was changed, or `aad` doesn't match. */
export function openWith(ring: Keyring, sealed: string, aad?: string): string {
  const kid = sealedKid(sealed);
  if (!kid) throw new Error("Unknown sealed format");
  const key = ring.keys.get(kid);
  if (!key) throw new Error(`Sealing key ${kid} is not configured`);
  const p = sealed.split(".");
  return decrypt(key, p[2], p[3], p[4], additional(kid, aad));
}

/** A value re-sealed with the current key, or null when it already uses it. For key rotation. */
export function resealWith(ring: Keyring, sealed: string, aad?: string): string | null {
  if (sealedKid(sealed) === ring.current) return null;
  return sealWith(ring, openWith(ring, sealed, aad), aad);
}

/** Seal and open with the keys in this process's environment. */
export const seal = (plain: string, aad?: string): string => sealWith(envKeyring(), plain, aad);
export const open = (sealed: string, aad?: string): string => openWith(envKeyring(), sealed, aad);
