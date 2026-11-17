// User-facing text rule from CLAUDE.md: no em dashes or en dashes. Checks every screen, route, email and SQL message.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function files(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : /\.(tsx?|sql)$/.test(e.name) ? [new URL(e.name, dir)] : [],
  );
}

test("no em dashes or en dashes in the app's text", () => {
  const all = [...files(new URL("../src/", import.meta.url)), ...files(new URL("../supabase/", import.meta.url))];
  assert.ok(all.length > 5);
  const bad = all.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /[–—]/.test(line))
      .map(({ line, n }) => `${f.pathname.split("/web/")[1]}:${n}: ${line.trim()}`),
  );
  assert.deepEqual(bad, [], "Use a period, comma or colon instead of a dash");
});
