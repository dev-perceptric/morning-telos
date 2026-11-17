// Small helpers: passwords, secret encryption, ids.
import crypto from "node:crypto";

const SECRET = process.env.APP_SECRET || "dev-only-secret-change-me";
const KEY = crypto.createHash("sha256").update("mt-secrets:" + SECRET).digest();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function checkPassword(pw, stored) {
  const [kind, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(hashHex, "hex");
  return want.length === hash.length && crypto.timingSafeEqual(want, hash);
}

// AES-256-GCM. Stored as iv.tag.data (base64url).
export function encrypt(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(stored) {
  if (!stored) return null;
  try {
    const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const token = (n = 32) => crypto.randomBytes(n).toString("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Show only the last 4 characters of a key.
export const mask = (s) => (s ? "••••" + String(s).slice(-4) : "");

export function clip(s, n = 20000) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n…(cut ${s.length - n} characters)` : s;
}
