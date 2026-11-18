// Checks on the SQL text itself. These run everywhere, with no database.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const dir = new URL("../supabase/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const sql = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n").replace(/--.*$/gm, "");

const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)].map((m) => ({ name: m[1], body: m[2] }));
// A table with RLS policies is a customer table. A table with RLS on and no policies is server-only (CLAUDE.md).
const withPolicies = new Set([...sql.matchAll(/create policy "[^"]+" on public\.(\w+)/g)].map((m) => m[1]));
// The workspace itself is keyed by id, not workspace_id.
const NOT_CUSTOMER = new Set(["workspaces", ...tables.filter((t) => !withPolicies.has(t.name)).map((t) => t.name)]);

test("found the tables", () => {
  assert.ok(tables.length >= 3, `only found ${tables.length} tables`);
});

test("every table has row level security on", () => {
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t.name} enable row level security`), `${t.name} has no RLS`);
  }
});

test("every customer table has workspace_id", () => {
  for (const t of tables) {
    if (NOT_CUSTOMER.has(t.name)) continue;
    assert.match(t.body, /\bworkspace_id\b/, `${t.name} has no workspace_id`);
  }
});

test("policies check roles through has_role or the signed-in user", () => {
  const policies = [...sql.matchAll(/create policy "[^"]+" on public\.(\w+)[\s\S]*?;/g)].map((m) => m[0]);
  assert.ok(policies.length > 0);
  for (const p of policies) assert.match(p, /has_role\(|auth\.uid\(\)/, `policy without a role check:\n${p}`);
});

test("server-only tables have no policies", () => {
  for (const t of ["stripe_events", "services", "jobs", "webhook_events", "ai_usage"]) {
    assert.ok(tables.some((x) => x.name === t), `${t} not found`);
    assert.doesNotMatch(sql, new RegExp(`create policy "[^"]+" on public\\.${t}\\b`), `${t} is server-only but has a policy`);
  }
});

test("security definer functions pin search_path", () => {
  for (const m of sql.matchAll(/create (?:or replace )?function ([\w.]+)\([\s\S]*?\$\$/g)) {
    if (/security definer/.test(m[0])) assert.match(m[0], /set search_path = ''/, `${m[1]} is security definer without search_path`);
  }
});

test("members can't edit plan or billing columns", () => {
  assert.match(sql, /revoke insert, update on public\.workspaces from authenticated, anon;/);
  const grant = sql.match(/grant update \(([^)]+)\) on public\.workspaces to authenticated/);
  assert.ok(grant, "no column grant on workspaces");
  const cols = grant[1].split(",").map((c) => c.trim());
  for (const c of ["plan", "status", "trial_ends_at", "stripe_customer_id", "stripe_subscription_id"]) assert.ok(!cols.includes(c), `${c} is editable`);
});
