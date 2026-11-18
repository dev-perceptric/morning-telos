// Nightly backup of the Morning Telos Supabase database to the morningtelos-backups R2 bucket.
// Restore with scripts/restore.ts (its header says how). Copied from Capybaroar's ops/backup.sh, in Node.
//
//   cd web && npm run backup
//
// 1. pg_dump of the whole database (every schema: public, auth, storage), custom format, compressed.
// 2. Row counts of every table in public and auth, for a restore test to compare against.
// 3. Encrypted to BACKUP_PUBLIC_KEY (X25519 + AES-256-GCM). The server has no key that can read a backup.
// 4. Uploads <BACKUP_PREFIX><name>.dump.mtb and <name>.manifest.json (size, checksum, row counts), then checks the size.
// 5. Deletes backups older than 30 days, but always keeps the newest 7 (src/lib/backup.ts, backupsToDelete). Only our
//    own backup files directly in BACKUP_PREFIX are ever deleted, so the bucket can be shared with another product.
// 6. Calls BACKUP_PING_URL when all of that worked, or BACKUP_PING_URL/fail when it didn't, so a heartbeat
//    monitor (Healthchecks.io, Better Stack) emails us about a failed or missed night.
//
// Settings, from the environment:
//   BACKUP_DATABASE_URL   required. postgres:// URL of the Supabase database, as a superuser (postgres).
//   BACKUP_PUBLIC_KEY     required. From "npm run restore -- keygen". The private key stays off the server.
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   required. R2 token for the bucket only.
//   R2_BUCKET             optional (morningtelos-backups).
//   BACKUP_PREFIX         optional. The bucket folder (db/daily/). Production shares a bucket: morningtelos/db/daily/.
//   BACKUP_PING_URL       optional heartbeat URL.
// Needs pg_dump and psql at least as new as the server's Postgres (postgresql-client-17 for Postgres 17).
// Exits 1 with a line starting "backup: FAILED" when anything goes wrong.
import { backupName, backupPrefix, backupsToDelete, dumpKey, encryptBackup, KEEP_DAYS, type Manifest, manifestKey, MIN_KEEP, parseRowCounts, pgEnv, r2Creds, ROW_COUNTS_SQL, s3Client, sha256Hex } from "../src/lib/backup.ts";
import { log, mustRun } from "./shell.ts";

const say = (msg: string) => log("backup", msg);

function need(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function ping(suffix = "") {
  const url = (process.env.BACKUP_PING_URL ?? "").trim();
  if (!url) return;
  try {
    await fetch(url.replace(/\/+$/, "") + suffix, { signal: AbortSignal.timeout(10_000) });
  } catch {
    say("could not reach BACKUP_PING_URL");
  }
}

async function main() {
  const pg = pgEnv(need("BACKUP_DATABASE_URL"), "BACKUP_DATABASE_URL");
  const publicKey = need("BACKUP_PUBLIC_KEY");
  const { creds, missing } = r2Creds(process.env);
  if (!creds) throw new Error(`${missing.join(", ")} not set`);
  const r2 = s3Client(creds);
  const prefix = backupPrefix(process.env);

  const now = new Date();
  const name = backupName(now);
  say(`dumping ${pg.PGDATABASE} on ${pg.PGHOST}`);
  const dump = await mustRun("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-privileges"], pg);
  if (dump.subarray(0, 5).toString() !== "PGDMP" || dump.length < 1024) throw new Error(`the dump is only ${dump.length} bytes`);
  const version = (await mustRun("pg_dump", ["--version"])).toString().trim();

  say("counting rows for the manifest");
  const rows = parseRowCounts((await mustRun("psql", ["-X", "-At", "-F", " ", "-v", "ON_ERROR_STOP=1", "-c", ROW_COUNTS_SQL], pg)).toString());
  if (!Object.keys(rows).length) throw new Error("no tables found in public or auth");

  const file = encryptBackup(dump, publicKey);
  const manifest: Manifest = {
    name,
    created_at: now.toISOString(),
    dump_bytes: file.length,
    dump_sha256: sha256Hex(file),
    pg_dump: version,
    encryption: "MTB2: X25519 + AES-256-GCM",
    public_key: publicKey,
    rows,
  };

  say(`uploading ${name} (${file.length} bytes) to ${creds.bucket}/${prefix}`);
  await r2.put(dumpKey(name, prefix), file);
  await r2.put(manifestKey(name, prefix), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), "application/json");
  const got = await r2.size(dumpKey(name, prefix));
  if (got !== file.length) throw new Error(`the uploaded size ${got ?? "none"} is not ${file.length}`);

  const old = backupsToDelete(await r2.list(prefix), now, KEEP_DAYS, MIN_KEEP, prefix);
  for (const key of old) {
    say(`deleting ${key}`);
    await r2.delete(key);
  }

  await ping();
  say(`done: ${name}, ${file.length} bytes, ${Object.keys(rows).length} tables`);
}

main().catch(async (e: Error) => {
  console.error(`backup: FAILED: ${e.message}`);
  await ping("/fail");
  process.exit(1);
});
