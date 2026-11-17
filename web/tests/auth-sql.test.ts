// Login security SQL (supabase/003_auth_security.sql) in a throwaway Postgres database.
// Uses TEST_DATABASE_URL only (default: local mt/mt), never DATABASE_URL. Skips when no database answers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL || "postgres://mt:mt@localhost:5432/mt";
const dbName = `mt_auth_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let admin: pg.Client | null = null;
let db: pg.Client | null = null;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

before(async () => {
  try {
    admin = new pg.Client({ connectionString: BASE, connectionTimeoutMillis: 2000 });
    await admin.connect();
  } catch {
    admin = null;
    return;
  }
  await admin.query(`create database ${dbName}`);
  const url = new URL(BASE);
  url.pathname = `/${dbName}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(read("./sql/supabase-shim.sql"));
  await db.query(read("../supabase/schema.sql"));
  await db.query(read("../supabase/003_auth_security.sql"));
});

after(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  }
});

const hook = async (user: string, valid: boolean) =>
  (await db!.query("select public.hook_password_verification_attempt($1::jsonb) r", [JSON.stringify({ user_id: user, valid })])).rows[0].r as { decision: string; message?: string };

test("5 wrong passwords lock the account; a right one before that clears the count", async (t) => {
  if (!db) return t.skip("no test database");
  const u = randomUUID();
  for (let i = 0; i < 4; i++) assert.equal((await hook(u, false)).decision, "continue");
  assert.equal((await hook(u, true)).decision, "continue"); // right password: count resets
  for (let i = 0; i < 5; i++) assert.equal((await hook(u, false)).decision, "continue");
  const r = await hook(u, true); // even the right password is refused while locked
  assert.equal(r.decision, "reject");
  assert.match(r.message ?? "", /Wait 15 minutes/);
});

test("the lock wears off after 15 minutes", async (t) => {
  if (!db) return t.skip("no test database");
  const u = randomUUID();
  for (let i = 0; i < 5; i++) await hook(u, false);
  await db.query("update auth_failures set at = at - interval '16 minutes' where user_id = $1", [u]);
  assert.equal((await hook(u, true)).decision, "continue");
});

test("one person's wrong tries don't lock anyone else", async (t) => {
  if (!db) return t.skip("no test database");
  const a = randomUUID(), b = randomUUID();
  for (let i = 0; i < 5; i++) await hook(a, false);
  assert.equal((await hook(b, true)).decision, "continue");
});

test("signed-in users can't read or call the login security pieces", async (t) => {
  if (!db) return t.skip("no test database");
  for (const sql of [
    "select * from auth_attempts",
    "select * from auth_failures",
    `select public.hook_password_verification_attempt('{"user_id":"${randomUUID()}","valid":true}'::jsonb)`,
    `select public.auth_attempt_decision('${randomUUID()}', 'password', true)`,
  ]) {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: randomUUID() })]);
      const r = await db.query(sql).then((x) => x.rowCount, (e: Error) => e.message);
      assert.ok(r === 0 || /permission denied/.test(String(r)), `${sql} → ${r}`);
    } finally {
      await db.query("rollback");
    }
  }
});
