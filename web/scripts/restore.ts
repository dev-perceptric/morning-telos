// Restores a backup made by scripts/backup.ts. Run it on your own computer, where the private key is.
//
// Once, before the first backup:
//   npm run restore -- keygen
//     Prints a new key pair. Put BACKUP_PUBLIC_KEY in the server's environment. Keep BACKUP_PRIVATE_KEY in the
//     password manager and one offline copy. It is the only way to read the backups. Never put it on the server.
//
// Settings, from the environment (the same R2 settings as the backup; a read-only R2 token is enough):
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (morningtelos-backups)
//   BACKUP_PREFIX          the bucket folder (db/daily/). Production: morningtelos/db/daily/
//   BACKUP_PRIVATE_KEY     the private key from keygen
//   RESTORE_DATABASE_URL   postgres:// URL of the database to load into (load only)
//   RESTORE_DIR            where files are saved (./restore). Decrypted dumps hold customer data: delete them after.
//
// Commands:
//   npm run restore -- list                   backups in the bucket, newest first
//   npm run restore -- check [NAME|latest]    with no private key: the backup is there, under 26 hours old, matches its
//                                             manifest's size and checksum, isn't much smaller than the one before, and
//                                             its key tables have rows. The server runs it every Sunday.
//   npm run restore -- fetch [NAME|latest]    download, check the checksum, decrypt to RESTORE_DIR/NAME.dump
//   npm run restore -- decrypt FILE.dump.mtb  decrypt a file you downloaded from the R2 dashboard
//   npm run restore -- load [NAME|latest]     fetch, then pg_restore into RESTORE_DATABASE_URL and compare row
//                                             counts with the backup's manifest. The key tables (workspaces,
//                                             members, jobs, auth.users) must have rows. Needs CONFIRM=yes.
// NAME looks like morningtelos-2026-11-17T0317Z. "latest" (the default) is the newest one.
//
// To restore production after a disaster:
//   1. Make a fresh Supabase database (new project, or a new empty self-hosted one). Don't load into a database
//      that has data: the load adds rows, it doesn't replace them.
//   2. CONFIRM=yes RESTORE_DATABASE_URL=postgres://postgres:...@new-host:5432/postgres npm run restore -- load
//      "already exists" errors are expected, since Supabase makes its own schemas first. The row counts of every
//      public table and auth.users must match, or the command fails.
//   3. Point the app's Supabase keys at the new database and restart it.
//
// GitHub Actions runs check and load every Sunday (.github/workflows/restore-test.yml). By hand:
//   docker run -d --name mt-restore-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
//   CONFIRM=yes RESTORE_DATABASE_URL=postgres://postgres:test@localhost:54329/postgres npm run restore -- load
//   docker rm -f mt-restore-test && rm -rf restore
// A plain Postgres lacks Supabase's roles and extensions, so many statements fail there, but our public tables
// and auth.users still load and their row counts are checked.
import fs from "node:fs";
import path from "node:path";
import { backupPrefix, backupProblems, compareRows, completeBackups, decryptBackup, dumpKey, emptyKeyTables, generateBackupKeys, type Manifest, manifestKey, parseRowCounts, pgEnv, publicKeyOf, r2Creds, ROW_COUNTS_SQL, s3Client, sha256Hex } from "../src/lib/backup.ts";
import { log, mustRun, run } from "./shell.ts";

const say = (msg: string) => log("restore", msg);
const dir = path.resolve(process.env.RESTORE_DIR || "restore");

function need(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function bucket() {
  const { creds, missing } = r2Creds(process.env);
  if (!creds) throw new Error(`${missing.join(", ")} not set`);
  return s3Client(creds);
}

const prefix = () => backupPrefix(process.env);

async function pick(r2: ReturnType<typeof s3Client>, want = "latest"): Promise<string> {
  if (want !== "latest") return want;
  const names = completeBackups(await r2.list(prefix()), prefix());
  if (!names.length) throw new Error(`no backups in ${prefix()}`);
  return names[0];
}

/** Checks a backup without decrypting it, so it runs on the server, which has no private key. */
async function check(want = "latest") {
  const r2 = bucket();
  const p = prefix();
  const names = completeBackups(await r2.list(p), p);
  const name = want === "latest" ? (names[0] ?? null) : names.includes(want) ? want : null;
  if (want !== "latest" && !name) throw new Error(`${want} is not a complete backup in ${p}`);
  const readManifest = async (n: string) => {
    try {
      return JSON.parse((await r2.get(manifestKey(n, p))).toString()) as Partial<Manifest>;
    } catch {
      return null;
    }
  };
  const manifest = name ? await readManifest(name) : null;
  const file = name ? await r2.get(dumpKey(name, p)) : null;
  const before = name ? names[names.indexOf(name) + 1] : undefined;
  const previousBytes = before ? ((await readManifest(before))?.dump_bytes ?? null) : null;
  const problems = backupProblems({ name, now: new Date(), manifest, file, previousBytes });
  if (problems.length) {
    for (const l of problems) console.error(`  ${l}`);
    throw new Error(`the check of ${name ?? p} found ${problems.length} problem${problems.length > 1 ? "s" : ""}`);
  }
  say(`ok: ${name}, ${file!.byteLength} bytes, checksum matches, ${Object.keys(manifest!.rows ?? {}).length} tables`);
}

/** Downloads a backup, checks it against its manifest, decrypts it. Returns the dump's path and the manifest. */
async function fetchBackup(want?: string): Promise<{ dumpPath: string; manifest: Manifest }> {
  const privateKey = need("BACKUP_PRIVATE_KEY");
  const r2 = bucket();
  const name = await pick(r2, want);
  say(`downloading ${name}`);
  const manifest = JSON.parse((await r2.get(manifestKey(name, prefix()))).toString()) as Manifest;
  if (manifest.public_key && manifest.public_key !== publicKeyOf(privateKey)) throw new Error("BACKUP_PRIVATE_KEY does not match the key this backup was made for");
  const file = await r2.get(dumpKey(name, prefix()));
  if (sha256Hex(file) !== manifest.dump_sha256) throw new Error("the checksum does not match the manifest: the file is damaged or incomplete");
  const dump = decryptBackup(file, privateKey);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dumpPath = path.join(dir, `${name}.dump`);
  fs.writeFileSync(dumpPath, dump, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + "\n");
  say(`ok: ${dumpPath}`);
  return { dumpPath, manifest };
}

async function load(want?: string) {
  if (process.env.CONFIRM !== "yes") throw new Error("this writes into RESTORE_DATABASE_URL; run again with CONFIRM=yes");
  const pg = pgEnv(need("RESTORE_DATABASE_URL"), "RESTORE_DATABASE_URL");
  const { dumpPath, manifest } = await fetchBackup(want);
  say(`loading ${manifest.name} into ${pg.PGDATABASE} on ${pg.PGHOST}`);
  const r = await run("pg_restore", ["--no-owner", "--no-privileges", `--dbname=${pg.PGDATABASE}`, dumpPath], pg);
  const errors = r.stderr.split("\n").filter((l) => l.includes("error:"));
  fs.writeFileSync(path.join(dir, `${manifest.name}.load.log`), r.stderr);
  if (errors.length) {
    say(`${errors.length} statements failed (log: ${path.join(dir, `${manifest.name}.load.log`)}). The first ones:`);
    for (const l of [...new Set(errors)].slice(0, 15)) console.error(`  ${l.slice(0, 200)}`);
  }
  const restored = parseRowCounts((await mustRun("psql", ["-X", "-At", "-F", " ", "-v", "ON_ERROR_STOP=1", "-c", ROW_COUNTS_SQL], pg)).toString());
  const { bad, other } = compareRows(manifest.rows, restored);
  for (const l of other) say(`Supabase table differs (fine): ${l}`);
  if (bad.length) {
    for (const l of bad) console.error(`  ${l}`);
    throw new Error(`row counts differ for ${bad.length} of our tables`);
  }
  const empty = emptyKeyTables(restored);
  if (empty.length) throw new Error(`no rows restored in ${empty.join(", ")}`);
  say(`restored ${manifest.name}: row counts match for ${Object.keys(manifest.rows).length - other.length} tables`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "keygen": {
      const k = generateBackupKeys();
      console.log(`BACKUP_PUBLIC_KEY=${k.publicKey}\nBACKUP_PRIVATE_KEY=${k.privateKey}`);
      console.error("Put BACKUP_PUBLIC_KEY on the server. Keep BACKUP_PRIVATE_KEY in the password manager, never on the server.");
      return;
    }
    case "list": {
      const names = completeBackups(await bucket().list(prefix()), prefix());
      for (const n of names) console.log(n);
      if (!names.length) say("no backups yet");
      return;
    }
    case "check":
      await check(arg);
      return;
    case "fetch":
      await fetchBackup(arg);
      return;
    case "decrypt": {
      if (!arg) throw new Error("name the file: npm run restore -- decrypt FILE.dump.mtb");
      const out = arg.replace(/\.mtb$/, "") === arg ? `${arg}.dump` : arg.replace(/\.mtb$/, "");
      fs.writeFileSync(out, decryptBackup(fs.readFileSync(arg), need("BACKUP_PRIVATE_KEY")), { mode: 0o600 });
      say(`ok: ${out}`);
      return;
    }
    case "load":
      await load(arg);
      return;
    default:
      console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("\nimport ")[0].replace(/^\/\/ ?/gm, ""));
      process.exit(2);
  }
}

main().catch((e: Error) => {
  console.error(`restore: FAILED: ${e.message}`);
  process.exit(1);
});
