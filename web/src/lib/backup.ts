// Nightly database backups: the parts scripts/backup.ts and scripts/restore.ts share, kept pure so tests can run
// them with no database and no bucket. The approach is Capybaroar's ops/backup.sh: the dump is encrypted to a public
// key, so the server that makes backups holds no key that can read them, and old backups are pruned after a good run.
import crypto from "node:crypto";

export const BACKUP_BUCKET = "morningtelos-backups";
/** The bucket folder backups go in when BACKUP_PREFIX isn't set. A shared bucket sets its own (morningtelos/db/daily/). */
export const BACKUP_PREFIX = "db/daily/";
/** Backups older than this many days are deleted after each good run. */
export const KEEP_DAYS = 30;
/** The newest backups that are never deleted, however old, so a stopped clock or a long outage can't empty the bucket. */
export const MIN_KEEP = 7;

const DAY_MS = 86_400_000;
const NAME_RE = /^morningtelos-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})Z$/;
const SUFFIX_RE = /\.(dump\.mtb|manifest\.json)$/;

// ---- Names ----

/** The backup's name for a time, in UTC: morningtelos-2026-11-17T0317Z. Names sort by time. */
export function backupName(at: Date): string {
  const iso = at.toISOString();
  return `morningtelos-${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

export const dumpKey = (name: string, prefix = BACKUP_PREFIX) => `${prefix}${name}.dump.mtb`;
export const manifestKey = (name: string, prefix = BACKUP_PREFIX) => `${prefix}${name}.manifest.json`;

const PREFIX_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/$/;

/**
 * The bucket folder from BACKUP_PREFIX, ending in "/", or db/daily/ when it isn't set. The bucket can be shared with
 * another product, so a folder that could reach outside its own (the bucket root, "..", "//") is refused.
 */
export function backupPrefix(env: Record<string, string | undefined>): string {
  const raw = (env.BACKUP_PREFIX ?? "").trim();
  if (!raw) return BACKUP_PREFIX;
  const p = raw.endsWith("/") ? raw : `${raw}/`;
  if (!PREFIX_RE.test(p) || p.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("BACKUP_PREFIX should be a folder like morningtelos/db/daily/ (letters, digits, . _ - and /)");
  }
  return p;
}

/** The backup a key belongs to when it sits directly in the prefix folder, or null for any other key. */
function nameUnder(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix) || key.slice(prefix.length).includes("/")) return null;
  const name = backupNameOf(key);
  return name && (key === dumpKey(name, prefix) || key === manifestKey(name, prefix)) ? name : null;
}

/** The backup name a bucket key belongs to, or null for any other file. */
export function backupNameOf(key: string): string | null {
  const base = key.slice(key.lastIndexOf("/") + 1);
  if (!SUFFIX_RE.test(base)) return null;
  const name = base.replace(SUFFIX_RE, "");
  return backupTime(name) ? name : null;
}

/** When a backup was made, from its name. Null for names that aren't ours or aren't real dates. */
export function backupTime(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return backupName(at) === name ? at : null;
}

/** Backup names found in a bucket listing, newest first. Only names with both files count as complete. */
export function completeBackups(keys: string[], prefix = BACKUP_PREFIX): string[] {
  const files = new Map<string, Set<string>>();
  for (const k of keys) {
    const name = nameUnder(k, prefix);
    if (!name) continue;
    if (!files.has(name)) files.set(name, new Set());
    files.get(name)!.add(k);
  }
  return [...files]
    .filter(([name, set]) => set.has(dumpKey(name, prefix)) && set.has(manifestKey(name, prefix)))
    .map(([name]) => name)
    .sort()
    .reverse();
}

/**
 * The keys to delete so the bucket keeps 30 days: every file of a backup made more than keepDays before now,
 * except the newest minKeep backups. Only our own backup files directly in the prefix folder are ever picked:
 * anything else in the bucket (another product's files, other folders, other names) is never touched.
 */
export function backupsToDelete(keys: string[], now: Date, keepDays = KEEP_DAYS, minKeep = MIN_KEEP, prefix = BACKUP_PREFIX): string[] {
  const byName = new Map<string, string[]>();
  for (const k of keys) {
    const name = nameUnder(k, prefix);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), k]);
  }
  const cutoff = now.getTime() - keepDays * DAY_MS;
  return [...byName.keys()]
    .sort()
    .reverse()
    .slice(minKeep)
    .filter((name) => backupTime(name)!.getTime() < cutoff)
    .flatMap((name) => byName.get(name)!)
    .sort();
}

// ---- Settings ----

/**
 * libpq settings (PGHOST, PGUSER, ...) for a postgres:// URL, so pg_dump and pg_restore get the password in their
 * environment and never on a command line where `ps` would show it. Errors never repeat the URL.
 */
export function pgEnv(databaseUrl: string, label = "The database URL"): Record<string, string> {
  let u: URL;
  try {
    u = new URL(databaseUrl.trim());
  } catch {
    throw new Error(`${label} is not a valid URL. It should look like postgres://user:password@host:5432/postgres`);
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error(`${label} should start with postgres://`);
  if (!u.hostname) throw new Error(`${label} has no host`);
  const env: Record<string, string> = {
    PGHOST: decodeURIComponent(u.hostname).replace(/^\[(.*)\]$/, "$1"),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)) || "postgres",
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  for (const k of Object.keys(env)) if (!env[k]) delete env[k];
  return env;
}

export type S3Creds = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string };

/** The R2 settings from the environment, or the names of the ones that are missing. */
export function r2Creds(env: Record<string, string | undefined>): { creds: S3Creds | null; missing: string[] } {
  const get = (k: string) => (env[k] ?? "").trim();
  const missing = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((k) => !get(k));
  if (missing.length) return { creds: null, missing };
  return {
    creds: { endpoint: get("R2_ENDPOINT"), bucket: get("R2_BUCKET") || BACKUP_BUCKET, accessKeyId: get("R2_ACCESS_KEY_ID"), secretAccessKey: get("R2_SECRET_ACCESS_KEY") },
    missing: [],
  };
}

// ---- R2 (S3 API, Signature V4), as in app/lib/backup.js ----

export const sha256Hex = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();

/** URI encoding the way Signature V4 wants it: everything but A-Z a-z 0-9 - _ . ~ */
export const encodeRfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signs one S3 request. Returns the headers to send, Authorization included (Host is left to fetch). */
export function signS3(
  req: { method: string; url: URL; payloadHash: string; now: Date; headers?: Record<string, string> },
  creds: Pick<S3Creds, "accessKeyId" | "secretAccessKey" | "region">,
): Record<string, string> {
  const amzDate = req.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const region = creds.region ?? "auto";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = req.url.host;
  headers["x-amz-content-sha256"] = req.payloadHash;
  headers["x-amz-date"] = amzDate;
  const names = Object.keys(headers).sort();
  const canonHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signed = names.join(";");
  const query = [...req.url.searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canon = [req.method, req.url.pathname, query, canonHeaders, signed, req.payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canon)].join("\n");
  const kSig = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSig).update(toSign).digest("hex");
  delete headers.host;
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${sig}`;
  return headers;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Keys and the next page token from a ListObjectsV2 answer. */
export function parseListObjects(xml: string): { keys: string[]; next: string | null } {
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => unescapeXml(m[1]));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
  return { keys, next: truncated && token ? unescapeXml(token[1]) : null };
}

type FetchLike = (url: URL, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) => Promise<Response>;

/** A tiny S3 client for one bucket: enough to put, read, list and delete backups. fetch is passed in for tests. */
export function s3Client(creds: S3Creds, fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit), clock = () => new Date()) {
  const urlFor = (key: string, query: Record<string, string> = {}) => {
    const path = key ? `/${encodeRfc3986(creds.bucket)}/${key.split("/").map(encodeRfc3986).join("/")}` : `/${encodeRfc3986(creds.bucket)}`;
    const url = new URL(creds.endpoint.replace(/\/+$/, "") + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  };
  const send = async (method: string, key: string, opts: { query?: Record<string, string>; body?: Uint8Array; headers?: Record<string, string> } = {}) => {
    const url = urlFor(key, opts.query);
    const payloadHash = sha256Hex(opts.body ?? "");
    const headers = signS3({ method, url, payloadHash, now: clock(), headers: opts.headers }, creds);
    let r: Response;
    try {
      r = await fetchImpl(url, { method, headers, body: opts.body, signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      const cause = (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
      throw new Error(`R2 ${method} ${key || creds.bucket} could not connect: ${cause}`);
    }
    if (!r.ok && !(method === "HEAD" && r.status === 404)) {
      const text = method === "HEAD" ? "" : (await r.text()).slice(0, 200);
      throw new Error(`R2 ${method} ${key || creds.bucket} failed (${r.status}) ${text}`.trim());
    }
    return r;
  };
  return {
    async put(key: string, body: Uint8Array, contentType = "application/octet-stream") {
      await send("PUT", key, { body, headers: { "content-type": contentType } });
    },
    /** The stored size in bytes, or null when the key isn't there. */
    async size(key: string): Promise<number | null> {
      const r = await send("HEAD", key);
      return r.status === 404 ? null : Number(r.headers.get("content-length"));
    },
    async get(key: string): Promise<Buffer> {
      const r = await send("GET", key);
      return Buffer.from(await r.arrayBuffer());
    },
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let next: string | null = null;
      do {
        const query: Record<string, string> = { "list-type": "2", prefix };
        if (next) query["continuation-token"] = next;
        const page = parseListObjects(await (await send("GET", "", { query })).text());
        keys.push(...page.keys);
        next = page.next;
      } while (next);
      return keys;
    },
    async delete(key: string) {
      await send("DELETE", key);
    },
  };
}

// ---- Encryption ----
// X25519 to the backup public key, then AES-256-GCM, with only Node's own crypto. A file is
// "MTB2" | the one-time public key (32 bytes) | IV (12) | ciphertext | GCM tag (16).
// The old app's MTB1 files use one shared secret instead; app/tools/decrypt-backup.js still reads those.

const MAGIC = Buffer.from("MTB2");
const INFO = Buffer.from("morningtelos-backup-v2");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const HEADER = MAGIC.length + 32 + 12;

const rawPublic = (k: crypto.KeyObject) => (k.export({ type: "spki", format: "der" }) as Buffer).subarray(-32);
const rawPrivate = (k: crypto.KeyObject) => (k.export({ type: "pkcs8", format: "der" }) as Buffer).subarray(-32);

function decodeKey(value: string, name: string): Buffer {
  const raw = Buffer.from(value.trim(), "base64url");
  if (raw.length !== 32) throw new Error(`${name} should be the 43-character key from "npm run restore -- keygen"`);
  return raw;
}
const publicKeyFrom = (raw: Buffer) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
const privateKeyFrom = (raw: Buffer) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });

function fileKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
}

/** A new key pair. The public key goes on the server as BACKUP_PUBLIC_KEY; the private key never does. */
export function generateBackupKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { publicKey: rawPublic(publicKey).toString("base64url"), privateKey: rawPrivate(privateKey).toString("base64url") };
}

/** The public key that belongs to a private key, to check you hold the right one. */
export function publicKeyOf(privateKey: string): string {
  return rawPublic(crypto.createPublicKey(privateKeyFrom(decodeKey(privateKey, "BACKUP_PRIVATE_KEY")))).toString("base64url");
}

export function encryptBackup(plain: Uint8Array, publicKey: string): Buffer {
  const recipient = decodeKey(publicKey, "BACKUP_PUBLIC_KEY");
  const eph = crypto.generateKeyPairSync("x25519");
  const ephRaw = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: publicKeyFrom(recipient) });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", fileKey(shared, ephRaw, recipient), iv);
  cipher.setAAD(Buffer.concat([MAGIC, ephRaw]));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, ephRaw, iv, data, cipher.getAuthTag()]);
}

export function decryptBackup(file: Uint8Array, privateKey: string): Buffer {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < HEADER + 16 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("This is not a Morning Telos backup (MTB2)");
  const key = privateKeyFrom(decodeKey(privateKey, "BACKUP_PRIVATE_KEY"));
  const recipient = rawPublic(crypto.createPublicKey(key));
  const ephRaw = buf.subarray(4, 36);
  const shared = crypto.diffieHellman({ privateKey: key, publicKey: publicKeyFrom(Buffer.from(ephRaw)) });
  const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey(shared, ephRaw, recipient), buf.subarray(36, HEADER));
  decipher.setAAD(buf.subarray(0, 36));
  decipher.setAuthTag(buf.subarray(-16));
  try {
    return Buffer.concat([decipher.update(buf.subarray(HEADER, -16)), decipher.final()]);
  } catch {
    throw new Error("Could not decrypt: the private key is wrong or the file is damaged");
  }
}

// ---- Manifest and row counts ----

export type Manifest = {
  name: string;
  created_at: string;
  dump_bytes: number;
  dump_sha256: string;
  pg_dump: string;
  encryption: string;
  public_key: string;
  rows: Record<string, number>;
};

/** One line per table in public and auth: "schema.table count". Run with psql -XAt -F ' '. */
export const ROW_COUNTS_SQL = `select n.nspname || '.' || c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth')
order by 1`;

export function parseRowCounts(text: string): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^(\S+) (\d+)$/.exec(line.trim());
    if (m) rows[m[1]] = Number(m[2]);
  }
  return rows;
}

/** Tables whose row counts must match after a restore: our own (public) and the sign-ins (auth.users). */
const mustMatch = (table: string) => table.startsWith("public.") || table === "auth.users";

/** Compares a restore with the manifest. `bad` lists our tables that differ; `other` lists Supabase's own. */
export function compareRows(expected: Record<string, number>, restored: Record<string, number>): { bad: string[]; other: string[] } {
  const bad: string[] = [];
  const other: string[] = [];
  for (const table of [...new Set([...Object.keys(expected), ...Object.keys(restored)])].sort()) {
    if (expected[table] === restored[table]) continue;
    const line = `${table}: ${expected[table] ?? "missing"} in the backup, ${restored[table] ?? "missing"} restored`;
    (mustMatch(table) ? bad : other).push(line);
  }
  return { bad, other };
}

// ---- Schedule (scripts/backup-cron.ts, the backup service in deploy/web-compose.yml) ----

/** The nightly backup runs at this time, in UTC. */
export const BACKUP_AT = { hour: 3, minute: 17 };

/** The next backup time strictly after now, in UTC. */
export function nextBackupAt(now: Date, at = BACKUP_AT): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), at.hour, at.minute));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Sundays (UTC), after the backup, the server also checks the newest backup (restore.ts check). */
export const isCheckDay = (at: Date) => at.getUTCDay() === 0;

// ---- The weekly check of the newest backup, with no private key (restore.ts check) ----

/** The newest backup must be younger than this. One night, plus room for a slow run. */
export const MAX_AGE_HOURS = 26;
/** A backup file smaller than this is no real dump. */
export const MIN_BACKUP_BYTES = 1024;
/** A backup less than this share of the one before it means data went missing or the dump stopped early. */
export const MIN_SIZE_RATIO = 0.5;
/** Tables a real Morning Telos database always has rows in. A backup or a restore where one is empty fails. */
export const KEY_TABLES = ["public.workspaces", "public.workspace_members", "public.jobs", "auth.users"];

/** The key tables that are missing or empty in a set of row counts. */
export function emptyKeyTables(rows: Record<string, number>, tables = KEY_TABLES): string[] {
  return tables.filter((t) => !(rows[t] > 0));
}

export type BackupCheck = {
  /** The newest complete backup, or null when there is none. */
  name: string | null;
  now: Date;
  manifest: Partial<Manifest> | null;
  /** The backup file as downloaded. */
  file: Uint8Array | null;
  /** The size of the backup before this one, from its manifest, or null for the first one. */
  previousBytes: number | null;
  maxAgeHours?: number;
};

/** What is wrong with the newest backup: none, recent, checksum, size, our tables. An empty list means it passed. */
export function backupProblems(c: BackupCheck): string[] {
  if (!c.name) return ["there are no complete backups"];
  const at = backupTime(c.name);
  if (!at) return [`${c.name} is not a backup name`];
  const problems: string[] = [];
  const maxAge = c.maxAgeHours ?? MAX_AGE_HOURS;
  const hours = (c.now.getTime() - at.getTime()) / 3_600_000;
  if (hours > maxAge) problems.push(`the newest backup, ${c.name}, is ${Math.floor(hours)} hours old (the limit is ${maxAge})`);
  const m = c.manifest;
  if (!m) return [...problems, "the manifest could not be read"];
  if (m.name !== c.name) problems.push(`the manifest is for ${m.name ?? "no name"}, not ${c.name}`);
  if (!c.file) return [...problems, "the backup file could not be read"];
  const bytes = c.file.byteLength;
  if (m.dump_bytes !== bytes) problems.push(`the file is ${bytes} bytes but the manifest says ${m.dump_bytes ?? "nothing"}`);
  if (m.dump_sha256 !== sha256Hex(c.file)) problems.push("the checksum does not match the manifest");
  if (Buffer.from(c.file.subarray(0, 4)).toString() !== "MTB2") problems.push("the file is not an encrypted Morning Telos backup (MTB2)");
  if (bytes < MIN_BACKUP_BYTES) problems.push(`the file is only ${bytes} bytes`);
  if (c.previousBytes && bytes < c.previousBytes * MIN_SIZE_RATIO) problems.push(`the file is ${bytes} bytes, less than half of the one before (${c.previousBytes})`);
  const empty = emptyKeyTables(m.rows ?? {});
  if (empty.length) problems.push(`no rows in ${empty.join(", ")}`);
  return problems;
}
