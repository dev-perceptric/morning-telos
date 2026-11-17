// Every server setting the app reads is listed in .env.example, empty, so the server's settings can be checked
// against one file.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
// Set by the build or by Node, not by us.
const NOT_SETTINGS = new Set(["NODE_ENV", "GIT_COMMIT", "NEXT_RUNTIME"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
  });
}

test("every process.env key in src is in .env.example with an empty value", () => {
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const listed = new Map(example.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
  for (const [k, v] of listed) assert.equal(v, "", `${k} must be empty in .env.example`);
  const used = new Set<string>();
  for (const f of [...files(join(ROOT, "src")), join(ROOT, "next.config.ts")]) {
    for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !NOT_SETTINGS.has(k) && !listed.has(k));
  assert.deepEqual(missing, []);
});
