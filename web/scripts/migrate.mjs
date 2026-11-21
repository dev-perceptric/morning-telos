// Brings a database up to date: runs supabase/schema.sql and every numbered migration (002_*.sql, ...) it hasn't had
// yet, in number order, each in its own transaction, and records each one in public.schema_migrations.
// deploy/deploy-web.sh runs it inside the new image before the app restarts, so a new table is there before the code
// that reads it.
//
//   MIGRATE_DATABASE_URL=postgres://... node scripts/migrate.mjs            run what is missing
//   MIGRATE_DATABASE_URL=postgres://... node scripts/migrate.mjs --dry-run  only list it
//
// A database made before this script has no record yet. If it already has the schema (public.workspaces exists),
// schema.sql counts as done and every numbered migration runs again. That is safe: each one only adds what is
// missing (tests/migrate.test.ts runs them all twice).

import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const SQL_DIR = new URL("../supabase/", import.meta.url);

/** schema.sql first, then the numbered migrations in number order. */
export function migrationOrder(files) {
  const numbered = files.filter((f) => /^\d+_.*\.sql$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  return [...(files.includes("schema.sql") ? ["schema.sql"] : []), ...numbered];
}

/** The files still to run, in order. `hasSchema`: the database already has the tables schema.sql makes. */
export function pendingMigrations(all, done, hasSchema) {
  const ran = new Set(done);
  if (hasSchema) ran.add("schema.sql");
  return all.filter((f) => !ran.has(f));
}

const LEDGER = `
create table if not exists public.schema_migrations (
  name text primary key,
  ran_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.schema_migrations from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.schema_migrations from authenticated; end if;
end $$;`;

/** Run what is missing on `client`. Returns the names it ran (or would run, with dryRun). */
export async function migrate(client, { dryRun = false, log = console.log } = {}) {
  // One run at a time, even if two deploys overlap.
  await client.query("select pg_advisory_lock(727001)");
  try {
    const all = migrationOrder(readdirSync(SQL_DIR));
    const hasLedger = (await client.query("select to_regclass('public.schema_migrations') is not null as ok")).rows[0].ok;
    const done = hasLedger ? (await client.query("select name from public.schema_migrations")).rows.map((r) => r.name) : [];
    const hasSchema = (await client.query("select to_regclass('public.workspaces') is not null as ok")).rows[0].ok;
    const todo = pendingMigrations(all, done, hasSchema);
    if (dryRun) return todo;
    await client.query(LEDGER);
    if (hasSchema) await client.query("insert into public.schema_migrations (name) values ('schema.sql') on conflict do nothing");
    for (const f of todo) {
      log(`migrate: ${f}`);
      await client.query("begin");
      try {
        await client.query(readFileSync(new URL(f, SQL_DIR), "utf8"));
        await client.query("insert into public.schema_migrations (name) values ($1) on conflict do nothing", [f]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${f} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return todo;
  } finally {
    await client.query("select pg_advisory_unlock(727001)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = (process.env.MIGRATE_DATABASE_URL ?? "").trim();
  if (!url) {
    console.error("migrate: set MIGRATE_DATABASE_URL first.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const ran = await migrate(client, { dryRun });
    console.log(ran.length ? `migrate: ${dryRun ? "would run" : "ran"} ${ran.length} file(s)${dryRun ? `: ${ran.join(", ")}` : ""}` : "migrate: up to date");
  } catch (e) {
    console.error(`migrate: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
