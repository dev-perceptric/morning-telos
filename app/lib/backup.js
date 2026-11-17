// Nightly encrypted database backups: kept on the server (last 7) and copied to Cloudflare R2.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { one, getSetting, setSetting } from "./db.js";
import { platformConn } from "./platform.js";
import { alert } from "./alerts.js";

const DIR = process.env.BACKUP_DIR || "/backups";
const KEEP_LOCAL = 7;
const KEY = crypto.createHash("sha256").update("mt-backup:" + (process.env.APP_SECRET || "dev-only-secret-change-me")).digest();

function dump() {
  return new Promise((resolve, reject) => {
    const p = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", process.env.DATABASE_URL]);
    const out = [], err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().slice(0, 300) || `pg_dump exited ${code}`))));
  });
}
export function encryptBackup(buf) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("MTB1"), iv, c.getAuthTag(), data]);
}
export function decryptBackup(buf) {
  if (buf.subarray(0, 4).toString() !== "MTB1") throw new Error("Not a Morning Telos backup");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

// ---- R2 (S3 API, Signature V4) ----
const sha = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
export async function r2Creds() {
  const c = platformConn("r2");
  if (c.status !== "ok") return null;
  return { id: c.key, secret: c.key2, endpoint: process.env.R2_ENDPOINT, bucket: process.env.R2_BUCKET || "morningtelos-backups" };
}
export async function r2Put(creds, key, body) {
  const url = new URL(`${creds.endpoint.replace(/\/$/, "")}/${creds.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amzDate.slice(0, 8);
  const hash = sha(body), signed = "host;x-amz-content-sha256;x-amz-date";
  const canon = `PUT\n${url.pathname}\n\nhost:${url.host}\nx-amz-content-sha256:${hash}\nx-amz-date:${amzDate}\n\n${signed}\n${hash}`;
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha(canon)}`;
  const kSig = hmac(hmac(hmac(hmac("AWS4" + creds.secret, day), "auto"), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSig).update(toSign).digest("hex");
  const r = await fetch(url, { method: "PUT", body, signal: AbortSignal.timeout(120000), headers: {
    "x-amz-content-sha256": hash, "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${signed}, Signature=${sig}` } });
  if (!r.ok) throw new Error(`R2 upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

export async function runBackup() {
  const status = { at: new Date().toISOString(), ok: false, size: 0, local: false, offsite: false, error: null };
  try {
    const enc = encryptBackup(await dump());
    status.size = enc.length;
    const name = `mt-${status.at.replace(/[:.]/g, "-")}.dump.enc`;
    if (fs.existsSync(DIR)) {
      fs.writeFileSync(path.join(DIR, name), enc);
      status.local = true;
      const old = fs.readdirSync(DIR).filter((f) => f.startsWith("mt-") && f.endsWith(".dump.enc")).sort().reverse().slice(KEEP_LOCAL);
      for (const f of old) fs.unlinkSync(path.join(DIR, f));
    }
    const creds = await r2Creds();
    if (creds) { await r2Put(creds, `db/${name}`, enc); status.offsite = true; }
    status.ok = status.local || status.offsite;
    if (!creds) status.error = "Off-site copy skipped: add the R2 keys in Admin.";
  } catch (e) {
    status.error = e.message;
  }
  await setSetting("backup_status", JSON.stringify(status));
  if (!status.ok || (!status.offsite && (await r2Creds()))) await alert("backup", "Database backup failed", status.error || "Unknown error");
  return status;
}
export async function backupStatus() {
  try { return JSON.parse((await getSetting("backup_status")) || "null"); } catch { return null; }
}
