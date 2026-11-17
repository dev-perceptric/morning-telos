// Restores a backup made by scripts/backup.ts. Run it on your own computer, where the private key is.
//
// Once, before the first backup:
//   npm run restore -- keygen
//     Prints a new key pair. Put BACKUP_PUBLIC_KEY in the server's environment. Keep BACKUP_PRIVATE_KEY in the
//     password manager and one offline copy. It is the only way to read the backups. Never put it on the server.
//
// Settings, from the environment (the same R2 settings as the backup; a read-only R2 token is enough):
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (morningtelos-backups)
//   BACKUP_PRIVATE_KEY     the private key from keygen
//   RESTORE_DATABASE_URL   postgres:// URL of the database to load into (load only)
//   RESTORE_DIR            where files are saved (./restore). Decrypted dumps hold customer data: delete them after.
//
// Commands:
//   npm run restore -- list                   backups in the bucket, newest first
//   npm run restore -- fetch [NAME|latest]    download, check the checksum, decrypt to RESTORE_DIR/NAME.dump
//   npm run restore -- decrypt FILE.dump.mtb  decrypt a file you downloaded from the R2 dashboard
//   npm run restore -- load [NAME|latest]     fetch, then pg_restore into RESTORE_DATABASE_URL and compare row
//                                             counts with the backup's manifest. Needs CONFIRM=yes.
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
// Test a restore once a month, so we know backups work (the plan's "restore test"):
//   docker run -d --name mt-restore-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
//   CONFIRM=yes RESTORE_DATABASE_URL=postgres://postgres:test@localhost:54329/postgres npm run restore -- load
//   docker rm -f mt-restore-test && rm -rf restore
// A plain Postgres lacks Supabase's roles and extensions, so many statements fail there, but our public tables
// and auth.users still load and their row counts are checked.
import fs from "node:fs";
import path from "node:path";
import { BACKUP_PREFIX, compareRows, completeBackups, decryptBackup, dumpKey, generateBackupKeys, type Manifest, manifestKey, parseRowCounts, pgEnv, publicKeyOf, r2Creds, ROW_COUNTS_SQL, s3Client, sha256Hex } from "../src/lib/backup.ts";
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

async function pick(r2: ReturnType<typeof s3Client>, want = "latest"): Promise<string> {
  if (want !== "latest") return want;
  const names = completeBackups(await r2.list(BACKUP_PREFIX));
  if (!names.length) throw new Error(`no backups in ${BACKUP_PREFIX}`);
  return names[0];
}

/** Downloads a backup, checks it against its manifest, decrypts it. Returns the dump's path and the manifest. */
async function fetchBackup(want?: string): Promise<{ dumpPath: string; manifest: Manifest }> {
  const privateKey = need("BACKUP_PRIVATE_KEY");
  const r2 = bucket();
  const name = await pick(r2, want);
  say(`downloading ${name}`);
  const manifest = JSON.parse((await r2.get(manifestKey(name))).toString()) as Manifest;
  if (manifest.public_key && manifest.public_key !== publicKeyOf(privateKey)) throw new Error("BACKUP_PRIVATE_KEY does not match the key this backup was made for");
  const file = await r2.get(dumpKey(name));
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
      const names = completeBackups(await bucket().list(BACKUP_PREFIX));
      for (const n of names) console.log(n);
      if (!names.length) say("no backups yet");
      return;
    }
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
