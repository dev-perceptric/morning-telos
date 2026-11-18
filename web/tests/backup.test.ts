import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_PREFIX,
  backupName,
  backupPrefix,
  backupProblems,
  emptyKeyTables,
  isCheckDay,
  KEY_TABLES,
  MAX_AGE_HOURS,
  nextBackupAt,
  backupNameOf,
  backupsToDelete,
  backupTime,
  compareRows,
  completeBackups,
  decryptBackup,
  dumpKey,
  encryptBackup,
  generateBackupKeys,
  manifestKey,
  parseListObjects,
  parseRowCounts,
  pgEnv,
  publicKeyOf,
  r2Creds,
  s3Client,
  sha256Hex,
  signS3,
} from "../src/lib/backup.ts";

const DAY = 86_400_000;
const filesFor = (name: string) => [dumpKey(name), manifestKey(name)];

// ---- File naming ----

test("names a backup by its UTC time, to the minute", () => {
  assert.equal(backupName(new Date("2026-11-17T03:17:42.123Z")), "morningtelos-2026-11-17T0317Z");
  assert.equal(dumpKey("morningtelos-2026-11-17T0317Z"), "db/daily/morningtelos-2026-11-17T0317Z.dump.mtb");
  assert.equal(manifestKey("morningtelos-2026-11-17T0317Z"), "db/daily/morningtelos-2026-11-17T0317Z.manifest.json");
});

test("reads the time back from a name", () => {
  assert.equal(backupTime("morningtelos-2026-11-17T0317Z")?.toISOString(), "2026-11-17T03:17:00.000Z");
  assert.equal(backupNameOf("db/daily/morningtelos-2026-11-17T0317Z.dump.mtb"), "morningtelos-2026-11-17T0317Z");
  assert.equal(backupNameOf("db/daily/morningtelos-2026-11-17T0317Z.manifest.json"), "morningtelos-2026-11-17T0317Z");
});

test("names sort in time order", () => {
  const times = ["2026-01-02T00:00:00Z", "2025-12-31T23:59:00Z", "2026-01-01T09:05:00Z"];
  const names = times.map((t) => backupName(new Date(t)));
  assert.deepEqual([...names].sort(), [names[1], names[2], names[0]]);
});

test("ignores names that aren't ours or aren't real dates", () => {
  for (const n of ["capybaroar-2026-11-17T0317Z", "morningtelos-2026-02-30T0317Z", "morningtelos-2026-11-17T2517Z", "morningtelos-2026-11-17", "mt-2026-11-17T03-17-00-000Z"]) {
    assert.equal(backupTime(n), null, n);
  }
  assert.equal(backupNameOf("db/daily/morningtelos-2026-11-17T0317Z.sql"), null);
  assert.equal(backupNameOf("db/daily/notes.txt"), null);
});

// ---- The 30-day cleanup rule ----

test("deletes both files of every backup older than 30 days", () => {
  const now = new Date("2026-11-17T03:30:00Z");
  const names = Array.from({ length: 40 }, (_, i) => backupName(new Date(now.getTime() - i * DAY)));
  const del = backupsToDelete(names.flatMap(filesFor), now);
  // Day 0 to day 30 stay (31 backups; day 30 is exactly 30 days old). Days 31 to 39 go.
  const gone = new Set(del.map((k) => backupNameOf(k)));
  assert.equal(gone.size, 9);
  for (let i = 0; i < 40; i++) assert.equal(gone.has(names[i]), i > 30, `day ${i}`);
  assert.equal(del.length, 18);
});

test("keeps a backup made exactly 30 days ago", () => {
  const now = new Date("2026-11-17T03:17:00Z");
  const name = backupName(new Date(now.getTime() - 30 * DAY));
  const keys = [...filesFor(name), ...Array.from({ length: 7 }, (_, i) => filesFor(backupName(new Date(now.getTime() - i * 3600_000)))).flat()];
  assert.deepEqual(backupsToDelete(keys, now), []);
  assert.deepEqual(backupsToDelete(keys, new Date(now.getTime() + 60_000)), filesFor(name).sort());
});

test("always keeps the newest 7, however old, so a long outage can't empty the bucket", () => {
  const now = new Date("2026-11-17T03:17:00Z");
  const names = Array.from({ length: 10 }, (_, i) => backupName(new Date(now.getTime() - (100 + i) * DAY)));
  const del = backupsToDelete(names.flatMap(filesFor), now);
  assert.deepEqual([...new Set(del.map((k) => backupNameOf(k)))].sort(), names.slice(7).sort());
});

test("never touches files that aren't backups or are outside db/daily/", () => {
  const now = new Date("2026-11-17T03:17:00Z");
  const old = backupName(new Date(now.getTime() - 90 * DAY));
  const keys = [
    `db/monthly/${old}.dump.mtb`,
    `${BACKUP_PREFIX}README.txt`,
    `${BACKUP_PREFIX}${old}.sql.gz`,
    `mt-2026-01-01T00-00-00-000Z.dump.enc`,
    `db/mt-2026-01-01T00-00-00-000Z.dump.enc`,
  ];
  assert.deepEqual(backupsToDelete(keys, now, 30, 0), []);
});

test("an empty bucket deletes nothing", () => {
  assert.deepEqual(backupsToDelete([], new Date()), []);
});

test("lists complete backups newest first and skips half-uploaded ones", () => {
  const a = "morningtelos-2026-11-15T0317Z";
  const b = "morningtelos-2026-11-16T0317Z";
  const c = "morningtelos-2026-11-17T0317Z";
  assert.deepEqual(completeBackups([...filesFor(a), ...filesFor(b), dumpKey(c), "db/daily/other.txt"]), [b, a]);
});

// ---- Settings ----

test("turns a database URL into libpq settings", () => {
  assert.deepEqual(pgEnv("postgres://postgres:p%40ss%2Fword@db.example.com:6543/postgres?sslmode=require"), {
    PGHOST: "db.example.com",
    PGPORT: "6543",
    PGUSER: "postgres",
    PGPASSWORD: "p@ss/word",
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
  });
  assert.deepEqual(pgEnv("postgresql://u@localhost"), { PGHOST: "localhost", PGPORT: "5432", PGUSER: "u", PGDATABASE: "postgres" });
});

test("rejects a bad database URL without repeating it", () => {
  for (const url of ["mysql://u:secret123@h/db", "not a url secret123", "postgres://:secret123@/db"]) {
    assert.throws(
      () => pgEnv(url, "BACKUP_DATABASE_URL"),
      (e: Error) => e.message.startsWith("BACKUP_DATABASE_URL") && !e.message.includes("secret123"),
    );
  }
});

test("reads the R2 settings and names the missing ones", () => {
  assert.deepEqual(r2Creds({ R2_ENDPOINT: "https://x.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: " " }).missing, ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
  const { creds } = r2Creds({ R2_ENDPOINT: "https://x.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret" });
  assert.equal(creds?.bucket, "morningtelos-backups");
});

// ---- Signing (the examples from AWS's Signature V4 docs for S3) ----

const AWS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const AWS_NOW = new Date("2013-05-24T00:00:00Z");
const EMPTY = sha256Hex("");
const sigOf = (h: Record<string, string>) => /Signature=([0-9a-f]+)/.exec(h.authorization)?.[1];

test("signs AWS's GET Object example", () => {
  const h = signS3({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), payloadHash: EMPTY, now: AWS_NOW, headers: { Range: "bytes=0-9" } }, AWS);
  assert.equal(sigOf(h), "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, /);
  assert.equal(h.host, undefined);
});

test("signs AWS's PUT Object example", () => {
  const body = "Welcome to Amazon S3.";
  const h = signS3(
    {
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test%24file.text"),
      payloadHash: sha256Hex(body),
      now: AWS_NOW,
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    },
    AWS,
  );
  assert.equal(sigOf(h), "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
});

test("signs AWS's list examples, with the query sorted and encoded", () => {
  const lifecycle = signS3({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?lifecycle"), payloadHash: EMPTY, now: AWS_NOW }, AWS);
  assert.equal(sigOf(lifecycle), "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  const list = signS3({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2"), payloadHash: EMPTY, now: AWS_NOW }, AWS);
  assert.equal(sigOf(list), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("reads keys and the next page from a list answer", () => {
  const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>db/daily/a&amp;b.dump.mtb</Key></Contents><Contents><Key>db/daily/c</Key></Contents><NextContinuationToken>tok/1=</NextContinuationToken></ListBucketResult>`;
  assert.deepEqual(parseListObjects(xml), { keys: ["db/daily/a&b.dump.mtb", "db/daily/c"], next: "tok/1=" });
  assert.deepEqual(parseListObjects("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"), { keys: [], next: null });
});

// ---- The R2 client, against a fake fetch (no real bucket) ----

function fakeBucket() {
  const objects = new Map<string, Buffer>();
  const calls: { method: string; url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = async (url: URL, init: { method: string; headers: Record<string, string>; body?: Uint8Array }) => {
    calls.push({ method: init.method, url, headers: init.headers });
    assert.equal(url.host, "acct.r2.cloudflarestorage.com");
    assert.match(init.headers.authorization, /Credential=id\/\d{8}\/auto\/s3\/aws4_request/);
    assert.equal(init.headers["x-amz-content-sha256"], sha256Hex(init.body ?? ""));
    const key = decodeURIComponent(url.pathname.replace(/^\/morningtelos-backups\/?/, ""));
    if (init.method === "PUT") {
      objects.set(key, Buffer.from(init.body!));
      return new Response(null, { status: 200 });
    }
    if (init.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (init.method === "HEAD") {
      const o = objects.get(key);
      return o ? new Response(null, { status: 200, headers: { "content-length": String(o.length) } }) : new Response(null, { status: 404 });
    }
    if (!key) {
      // Two keys per page, to prove paging works.
      const all = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get("prefix") ?? "")).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      const xml = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    const o = objects.get(key);
    return o ? new Response(new Uint8Array(o), { status: 200 }) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
  };
  const creds = { endpoint: "https://acct.r2.cloudflarestorage.com/", bucket: "morningtelos-backups", accessKeyId: "id", secretAccessKey: "secret" };
  return { objects, calls, client: s3Client(creds, fetchImpl, () => new Date("2026-11-17T03:17:00Z")) };
}

test("puts, sizes, reads, lists and deletes through signed requests", async () => {
  const { client, objects, calls } = fakeBucket();
  for (let i = 0; i < 5; i++) await client.put(`db/daily/f${i}`, Buffer.from(`body ${i}`));
  await client.put("other/x", Buffer.from("x"));
  assert.equal(objects.size, 6);
  assert.equal(await client.size("db/daily/f1"), 6);
  assert.equal(await client.size("db/daily/missing"), null);
  assert.equal((await client.get("db/daily/f2")).toString(), "body 2");
  assert.deepEqual(await client.list("db/daily/"), ["db/daily/f0", "db/daily/f1", "db/daily/f2", "db/daily/f3", "db/daily/f4"]);
  await client.delete("db/daily/f0");
  assert.equal(objects.has("db/daily/f0"), false);
  assert.equal(calls[0].url.pathname, "/morningtelos-backups/db/daily/f0");
  assert.ok(calls.every((c) => c.headers["x-amz-date"] === "20261117T031700Z"));
});

test("an R2 error fails with the status", async () => {
  const { client } = fakeBucket();
  await assert.rejects(client.get("db/daily/nope"), /R2 GET db\/daily\/nope failed \(404\)/);
});

// ---- Encryption ----

test("a backup decrypts with the private key and not without it", () => {
  const keys = generateBackupKeys();
  const plain = Buffer.from("PGDMP fake dump ".repeat(100));
  const file = encryptBackup(plain, keys.publicKey);
  assert.equal(file.subarray(0, 4).toString(), "MTB2");
  assert.equal(file.includes(Buffer.from("fake dump")), false);
  assert.deepEqual(decryptBackup(file, keys.privateKey), plain);
  assert.equal(publicKeyOf(keys.privateKey), keys.publicKey);
  assert.throws(() => decryptBackup(file, generateBackupKeys().privateKey), /private key is wrong/);
});

test("two backups of the same data differ, and a changed byte is caught", () => {
  const keys = generateBackupKeys();
  const plain = Buffer.from("same data");
  const a = encryptBackup(plain, keys.publicKey);
  assert.notDeepEqual(a, encryptBackup(plain, keys.publicKey));
  const bad = Buffer.from(a);
  bad[bad.length - 20] ^= 1;
  assert.throws(() => decryptBackup(bad, keys.privateKey), /damaged/);
  assert.throws(() => decryptBackup(Buffer.from("MTB1 old app backup with more bytes than the header"), keys.privateKey), /not a Morning Telos backup/);
});

test("rejects a key that isn't from keygen", () => {
  assert.throws(() => encryptBackup(Buffer.from("x"), "short"), /BACKUP_PUBLIC_KEY should be the 43-character key/);
});

// ---- Row counts ----

test("reads psql row counts", () => {
  assert.deepEqual(parseRowCounts("public.workspaces 3\nauth.users 12\n\nnoise\n"), { "public.workspaces": 3, "auth.users": 12 });
});

test("a restore fails only when our tables or auth.users differ", () => {
  const expected = { "public.workspaces": 3, "auth.users": 12, "auth.schema_migrations": 50 };
  assert.deepEqual(compareRows(expected, { ...expected }), { bad: [], other: [] });
  const r = compareRows(expected, { "public.workspaces": 3, "auth.users": 11, "auth.schema_migrations": 61 });
  assert.deepEqual(r.bad, ["auth.users: 12 in the backup, 11 restored"]);
  assert.equal(r.other.length, 1);
  assert.deepEqual(compareRows(expected, { "auth.users": 12, "auth.schema_migrations": 50 }).bad, ["public.workspaces: 3 in the backup, missing restored"]);
});

// ---- The bucket folder (BACKUP_PREFIX), for a bucket shared with another product ----

const SHARED = "morningtelos/db/daily/";

test("reads BACKUP_PREFIX, adds the closing slash, and falls back to db/daily/", () => {
  assert.equal(backupPrefix({}), "db/daily/");
  assert.equal(backupPrefix({ BACKUP_PREFIX: "  " }), "db/daily/");
  assert.equal(backupPrefix({ BACKUP_PREFIX: SHARED }), SHARED);
  assert.equal(backupPrefix({ BACKUP_PREFIX: " morningtelos/db/daily " }), SHARED);
});

test("refuses a BACKUP_PREFIX that could reach outside its own folder", () => {
  for (const p of ["/", "/morningtelos/db/", "morningtelos//daily/", "../omniscient/", "morningtelos/../x/", "./", "a b/", "morningtelos/*/"]) {
    assert.throws(() => backupPrefix({ BACKUP_PREFIX: p }), /BACKUP_PREFIX should be a folder/, p);
  }
});

test("keys follow the prefix", () => {
  assert.equal(dumpKey("morningtelos-2026-11-17T0317Z", SHARED), "morningtelos/db/daily/morningtelos-2026-11-17T0317Z.dump.mtb");
  assert.equal(manifestKey("morningtelos-2026-11-17T0317Z", SHARED), "morningtelos/db/daily/morningtelos-2026-11-17T0317Z.manifest.json");
});

test("in a shared bucket, pruning only ever picks our own backups directly in the prefix", () => {
  const now = new Date("2026-11-17T03:17:00Z");
  const old = backupName(new Date(now.getTime() - 90 * DAY));
  const ours = [dumpKey(old, SHARED), manifestKey(old, SHARED)];
  const others = [
    // The default folder and other products' folders, with names that look like ours.
    dumpKey(old),
    manifestKey(old),
    `omniscient/db/daily/${old}.dump.mtb`,
    `omniscient/${old}.manifest.json`,
    `x${SHARED}${old}.dump.mtb`,
    `${SHARED.slice(0, -1)}${old}.dump.mtb`,
    // A folder inside ours, and other files in ours.
    `${SHARED}old/${old}.dump.mtb`,
    `${SHARED}${old}.dump.mtb.bak`,
    `${SHARED}capybaroar-2026-01-01T0317Z.dump.mtb`,
    `${SHARED}notes.txt`,
    `${old}.dump.mtb`,
    `content/uploads/${old}.dump.mtb`,
  ];
  assert.deepEqual(backupsToDelete([...ours, ...others], now, 30, 0, SHARED), [...ours].sort());
  assert.deepEqual(backupsToDelete(others, now, 30, 0, SHARED), []);
  // With the default folder, the shared folder's files are just as safe.
  assert.deepEqual(backupsToDelete(ours, now, 30, 0), []);
});

test("listing in a shared bucket only counts our own backups in the prefix", () => {
  const a = "morningtelos-2026-11-16T0317Z";
  const b = "morningtelos-2026-11-17T0317Z";
  const keys = [dumpKey(a, SHARED), manifestKey(a, SHARED), dumpKey(b), manifestKey(b), `${SHARED}sub/${b}.dump.mtb`, `${SHARED}sub/${b}.manifest.json`];
  assert.deepEqual(completeBackups(keys, SHARED), [a]);
  assert.deepEqual(completeBackups(keys), [b]);
});

// ---- Schedule ----

test("the next backup is the next 03:17 UTC, strictly after now", () => {
  const next = (t: string) => nextBackupAt(new Date(t)).toISOString();
  assert.equal(next("2026-11-17T03:16:59.999Z"), "2026-11-17T03:17:00.000Z");
  assert.equal(next("2026-11-17T03:17:00.000Z"), "2026-11-18T03:17:00.000Z");
  assert.equal(next("2026-11-17T03:40:00.000Z"), "2026-11-18T03:17:00.000Z");
  assert.equal(next("2026-11-17T00:00:00.000Z"), "2026-11-17T03:17:00.000Z");
  assert.equal(next("2026-11-30T23:59:00.000Z"), "2026-12-01T03:17:00.000Z");
  assert.equal(next("2026-12-31T22:00:00.000Z"), "2027-01-01T03:17:00.000Z");
  assert.equal(next("2028-02-28T04:00:00.000Z"), "2028-02-29T03:17:00.000Z");
  assert.equal(nextBackupAt(new Date("2026-11-17T05:00:00Z"), { hour: 5, minute: 43 }).toISOString(), "2026-11-17T05:43:00.000Z");
});

test("a night of backups runs every day, never twice in one", () => {
  let t = new Date("2026-11-01T12:00:00Z");
  const runs: string[] = [];
  for (let i = 0; i < 40; i++) {
    t = nextBackupAt(t);
    runs.push(t.toISOString().slice(0, 10));
    t = new Date(t.getTime() + 20 * 60_000); // the backup takes a while
  }
  assert.equal(new Set(runs).size, 40);
  assert.equal(runs[0], "2026-11-02");
  assert.equal(runs[39], "2026-12-11");
});

test("the weekly check runs on Sundays, UTC", () => {
  assert.equal(isCheckDay(new Date("2026-11-22T03:17:00Z")), true);
  assert.equal(isCheckDay(new Date("2026-11-21T03:17:00Z")), false);
  assert.equal(isCheckDay(new Date("2026-11-23T03:17:00Z")), false);
  let t = new Date("2026-11-01T00:00:00Z");
  let sundays = 0;
  for (let i = 0; i < 28; i++) {
    t = nextBackupAt(t);
    if (isCheckDay(t)) sundays++;
  }
  assert.equal(sundays, 4);
});

// ---- The weekly check of the newest backup ----

const ROWS = { "public.workspaces": 3, "public.workspace_members": 4, "public.jobs": 9, "auth.users": 5, "public.threads": 0 };

function goodCheck(overrides: Partial<Parameters<typeof backupProblems>[0]> = {}) {
  const name = "morningtelos-2026-11-22T0317Z";
  const file = encryptBackup(Buffer.from("PGDMP ".repeat(500)), generateBackupKeys().publicKey);
  const manifest = { name, dump_bytes: file.length, dump_sha256: sha256Hex(file), rows: ROWS };
  return { name, now: new Date("2026-11-22T03:40:00Z"), manifest, file, previousBytes: file.length - 10, ...overrides };
}

test("a fresh, whole backup passes the check", () => {
  assert.deepEqual(backupProblems(goodCheck()), []);
  assert.deepEqual(backupProblems(goodCheck({ previousBytes: null })), []);
});

test("the check fails when there is no backup or it is too old", () => {
  assert.deepEqual(backupProblems(goodCheck({ name: null })), ["there are no complete backups"]);
  const at = new Date("2026-11-22T03:17:00Z").getTime();
  assert.deepEqual(backupProblems(goodCheck({ now: new Date(at + MAX_AGE_HOURS * 3_600_000) })), []);
  const late = backupProblems(goodCheck({ now: new Date(at + (MAX_AGE_HOURS * 60 + 1) * 60_000) }));
  assert.deepEqual(late, ["the newest backup, morningtelos-2026-11-22T0317Z, is 26 hours old (the limit is 26)"]);
  assert.match(backupProblems(goodCheck({ now: new Date(at + 3 * DAY) }))[0], /72 hours old/);
});

test("the check fails when the file doesn't match its manifest", () => {
  const c = goodCheck();
  const bad = Buffer.from(c.file);
  bad[bad.length - 1] ^= 1;
  assert.deepEqual(backupProblems({ ...c, file: bad }), ["the checksum does not match the manifest"]);
  const cut = c.file.subarray(0, c.file.length - 100);
  const cutProblems = backupProblems({ ...c, file: cut });
  assert.ok(cutProblems.some((p) => p.includes("but the manifest says")));
  assert.ok(cutProblems.includes("the checksum does not match the manifest"));
  assert.deepEqual(backupProblems({ ...c, manifest: { ...c.manifest, name: "morningtelos-2026-11-21T0317Z" } }), [
    "the manifest is for morningtelos-2026-11-21T0317Z, not morningtelos-2026-11-22T0317Z",
  ]);
  assert.deepEqual(backupProblems({ ...c, manifest: null }), ["the manifest could not be read"]);
  assert.deepEqual(backupProblems({ ...c, file: null }), ["the backup file could not be read"]);
});

test("the check fails on a file that is tiny, not encrypted, or far smaller than the last one", () => {
  const tiny = Buffer.from("MTB2 short");
  const tinyProblems = backupProblems(goodCheck({ file: tiny, manifest: { name: "morningtelos-2026-11-22T0317Z", dump_bytes: tiny.length, dump_sha256: sha256Hex(tiny), rows: ROWS }, previousBytes: null }));
  assert.deepEqual(tinyProblems, [`the file is only ${tiny.length} bytes`]);
  const plain = Buffer.from("PGDMP ".repeat(500));
  assert.deepEqual(backupProblems(goodCheck({ file: plain, manifest: { name: "morningtelos-2026-11-22T0317Z", dump_bytes: plain.length, dump_sha256: sha256Hex(plain), rows: ROWS }, previousBytes: null })), [
    "the file is not an encrypted Morning Telos backup (MTB2)",
  ]);
  const c = goodCheck();
  assert.deepEqual(backupProblems({ ...c, previousBytes: c.file.length * 2 }), []);
  assert.match(backupProblems({ ...c, previousBytes: c.file.length * 2 + 1 })[0], /less than half of the one before/);
});

test("the check fails when a key table has no rows", () => {
  const c = goodCheck();
  assert.deepEqual(backupProblems({ ...c, manifest: { ...c.manifest, rows: { ...ROWS, "public.workspaces": 0 } } }), ["no rows in public.workspaces"]);
  assert.deepEqual(backupProblems({ ...c, manifest: { ...c.manifest, rows: {} } }), [`no rows in ${KEY_TABLES.join(", ")}`]);
});

test("key tables: workspaces, members, jobs and sign-ins must have rows", () => {
  assert.deepEqual(KEY_TABLES, ["public.workspaces", "public.workspace_members", "public.jobs", "auth.users"]);
  assert.deepEqual(emptyKeyTables(ROWS), []);
  assert.deepEqual(emptyKeyTables({ ...ROWS, "public.jobs": 0, "auth.users": undefined as unknown as number }), ["public.jobs", "auth.users"]);
});
