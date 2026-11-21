// Errors people may read: our own short lines pass, anything technical becomes one plain line.
// And the guard: no screen or route shows a raw error again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isTechnical, plainError } from "../src/lib/plainError.ts";
import { routeErrorText } from "../src/lib/routeError.ts";

const quiet = <T,>(fn: () => T): T => {
  const was = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = was;
  }
};

test("database, setup and network messages never reach people", () => {
  for (const m of [
    "Could not find the table 'public.brand_kits' in the schema cache",
    'new row violates row-level security policy for table "agent_prefs"',
    'duplicate key value violates unique constraint "agent_prefs_pkey"',
    'relation "public.goals" does not exist',
    "PGRST204: column missing",
    "TypeError: Failed to fetch",
    "Request failed with status code 500",
    "Add SUPABASE_SECRET_KEY to the server's settings.",
    "Run supabase/006_jobs.sql in Supabase.",
    '{"code":"42501","message":"permission denied for table approvals"}',
    "x".repeat(400),
  ]) {
    assert.ok(isTechnical(m), m);
    assert.equal(quiet(() => plainError(m)), "Something went wrong. Try again.");
    assert.equal(routeErrorText(new Error(m), "We couldn't save that."), "We couldn't save that.");
  }
});

test("our own short lines pass as they are", () => {
  for (const m of [
    "That didn't save. Try again.",
    "Only admins and the owner can change the brand.",
    "Pick a plan first.",
    "Skills aren't set up yet. Try again soon.",
    "Couldn't reach the server. Check your connection and try again.",
    "We sent an invite to ann@example.com.",
  ]) {
    assert.equal(isTechnical(m), false, m);
    assert.equal(plainError(m), m);
    assert.equal(plainError(new Error(m)), m);
  }
});

test("an empty error gets the fallback, and any shape of error works", () => {
  assert.equal(plainError(""), "Something went wrong. Try again.");
  assert.equal(plainError(null, "Try again."), "Try again.");
  assert.equal(plainError({ message: "Pick a plan first." }), "Pick a plan first.");
  assert.equal(quiet(() => plainError({ message: "PGRST116" }, "No luck.")), "No luck.");
});

test("a technical message is logged once, then stays quiet", () => {
  const seen: unknown[] = [];
  const was = console.warn;
  console.warn = (m: unknown) => seen.push(m);
  try {
    plainError("syntax error at or near once_only_marker");
    plainError("syntax error at or near once_only_marker");
  } finally {
    console.warn = was;
  }
  assert.equal(seen.length, 1);
});

const SRC = new URL("../src/", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

test("ErrorText, callApi and getApi clean every message", () => {
  const ui = readFileSync(join(SRC, "components/ui.tsx"), "utf8");
  assert.match(ui, /function ErrorText[\s\S]{0,300}plainError\(children\)/);
  const nav = readFileSync(join(SRC, "components/nav.ts"), "utf8");
  assert.equal((nav.match(/throw new Error\(plainError\(out\.error\)\)/g) ?? []).length, 2);
});

test("no route answers with a raw error message", () => {
  const bad: string[] = [];
  // The Stripe webhook and the worker answer machines (Stripe, the cron), never a person, so they keep the detail.
  for (const f of files(join(SRC, "app/api")).filter((f) => !/billing\/webhook|api\/worker\//.test(f))) {
    const s = readFileSync(f, "utf8");
    // Response.json({ error: e.message ... }) or { error: error.message } sends the database's words to the browser.
    for (const m of s.matchAll(/Response\.json\(\s*\{\s*error:\s*([^}]*)\}/g)) {
      if (/\b(e|err|error|dupe)\??\.message\b|String\(e\)/.test(m[1])) bad.push(`${f.replace(SRC, "")}: ${m[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, [], "Use routeError(e, area, fallback) from src/lib/routeError.ts");
});

test("no screen hides a failed load behind an empty message", () => {
  const bad: string[] = [];
  for (const f of files(join(SRC, "components"))) {
    const s = readFileSync(f, "utf8");
    // setError(/table/.test(error.message) ? "" : ...) makes a failed load look like an empty, dead screen.
    if (/\.test\([^)]*\.message\)\s*\?\s*""/.test(s)) bad.push(f.replace(SRC, ""));
  }
  assert.deepEqual(bad, []);
});
