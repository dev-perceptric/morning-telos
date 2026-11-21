// The deploy's migration runner (scripts/migrate.mjs): order, what is still to run, and real runs on a throwaway
// database. Uses TEST_DATABASE_URL only (default: local mt/mt), never DATABASE_URL. The database tests skip when no
// database answers.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";
// @ts-expect-error plain .mjs script, no types
import { migrate, migrationOrder, pendingMigrations, SQL_DIR } from "../scripts/migrate.mjs";

test("schema.sql runs first, then the numbered files in number order", () => {
  assert.deepEqual(migrationOrder(["010_b.sql", "README", "002_a.sql", "schema.sql", "100_c.sql", "011_x.sql"]), ["schema.sql", "002_a.sql", "010_b.sql", "011_x.sql", "100_c.sql"]);
});

test("only what hasn't run is left, and an existing schema counts as done", () => {
  const all = ["schema.sql", "002_a.sql", "003_b.sql"];
  assert.deepEqual(pendingMigrations(all, [], false), all);
  assert.deepEqual(pendingMigrations(all, [], true), ["002_a.sql", "003_b.sql"]);
  assert.deepEqual(pendingMigrations(all, ["schema.sql", "002_a.sql"], true), ["003_b.sql"]);
  assert.deepEqual(pendingMigrations(all, all, true), []);
});

const BASE = process.env.TEST_DATABASE_URL || "postgres://mt:mt@localhost:5432/mt";
const names = [1, 2].map((i) => `mt_migrate_${i}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
let admin: pg.Client | null = null;
const open: pg.Client[] = [];
const shim = readFileSync(new URL("./sql/supabase-shim.sql", import.meta.url), "utf8");

async function connect(url: string) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  await c.connect();
  return c;
}
async function fresh(name: string) {
  await admin!.query(`create database ${name}`);
  const url = new URL(BASE);
  url.pathname = `/${name}`;
  const c = await connect(url.toString());
  open.push(c);
  await c.query(shim);
  return c;
}

before(async () => {
  try {
    admin = await connect(BASE);
  } catch {
    admin = null;
  }
});
after(async () => {
  for (const c of open) await c.end();
  if (admin) {
    for (const n of names) await admin.query(`drop database if exists ${n}`);
    await admin.end();
  }
});

const silent = { log: () => {} };
const all = () => migrationOrder(readdirSync(SQL_DIR));

test("a new database gets everything, and a second run does nothing", async (t) => {
  if (!admin) return t.skip("no test database");
  const db = await fresh(names[0]);
  assert.deepEqual(await migrate(db, silent), all());
  assert.equal((await db.query("select to_regclass('public.brand_kits') is not null as ok")).rows[0].ok, true);
  assert.deepEqual(await migrate(db, silent), []);
  assert.equal((await db.query("select count(*)::int as n from public.schema_migrations")).rows[0].n, all().length);
});

test("a database made by hand, before the runner, runs every migration again safely and skips schema.sql", async (t) => {
  if (!admin) return t.skip("no test database");
  const db = await fresh(names[1]);
  // The live database: schema.sql and only the first migrations, run by hand, with no record of them.
  const [schema, ...rest] = all();
  for (const f of [schema, ...rest.slice(0, 5)]) await db.query(readFileSync(new URL(f, SQL_DIR), "utf8"));
  assert.deepEqual(await migrate(db, { dryRun: true }), rest);
  assert.deepEqual(await migrate(db, silent), rest);
  assert.equal((await db.query("select to_regclass('public.goals') is not null as ok")).rows[0].ok, true);
  assert.deepEqual(await migrate(db, silent), []);
});

test("the ledger is server only: people signed in can't read it", async (t) => {
  if (!admin) return t.skip("no test database");
  const db = open[0];
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await assert.rejects(db.query("select * from public.schema_migrations"), /permission denied/);
  } finally {
    await db.query("rollback");
  }
});
