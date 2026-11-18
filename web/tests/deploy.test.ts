import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const envExample = read("../.env.example");
const compose = read("../../deploy/web-compose.yml");
const workflow = read("../../.github/workflows/build-images.yml");

const exampleKeys = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

test(".env.example lists each key once", () => {
  const seen = new Set<string>();
  for (const k of exampleKeys) {
    assert.ok(!seen.has(k), `${k} is listed twice in .env.example`);
    seen.add(k);
  }
});

test(".env.example lists keys with empty values only", () => {
  assert.ok(exampleKeys.length > 0);
  for (const line of envExample.split("\n")) {
    if (/^[A-Z][A-Z0-9_]*=/.test(line)) assert.match(line, /^[A-Z][A-Z0-9_]*=$/, `${line} must have an empty value`);
  }
});

// Keys for the nightly backup job (web/scripts/backup.ts), which runs outside the web container.
// The web app must never hold the database superuser URL, so these stay out of web-compose.yml on purpose.
const BACKUP_ONLY = new Set(["BACKUP_DATABASE_URL", "BACKUP_PUBLIC_KEY", "BACKUP_PING_URL"]);

test("web-compose.yml passes every key in .env.example from the server environment", () => {
  for (const key of exampleKeys) {
    if (BACKUP_ONLY.has(key)) continue;
    assert.ok(compose.includes(`${key}: \${${key}:-}`), `deploy/web-compose.yml is missing ${key}: \${${key}:-}`);
  }
});

test("web-compose.yml has no key values written in it", () => {
  const values = [...compose.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*(.+)$/gm)];
  const allowed = new Set(["NODE_ENV", "PORT"]);
  for (const [, key, value] of values) {
    if (allowed.has(key)) continue;
    assert.equal(value.trim(), `\${${key}:-}`, `${key} must come from the server environment`);
  }
});

test("build workflow reads browser keys from repo variables, not literal values", () => {
  assert.doesNotMatch(workflow, /phc_[A-Za-z0-9]+/);
  assert.doesNotMatch(workflow, /https:\/\/[a-z0-9]+@[a-z0-9.]*sentry\.io/);
  for (const line of workflow.split("\n").filter((l) => /NEXT_PUBLIC_\w+=/.test(l))) {
    assert.match(line, /NEXT_PUBLIC_(\w+)=\$\{\{ vars\.NEXT_PUBLIC_\1 \}\}\s*$/, `${line.trim()} must use a repo variable`);
  }
});

test("web-compose.yml never gives the web app the backup job's keys", () => {
  for (const key of BACKUP_ONLY) assert.ok(!compose.includes(key), `${key} must not be in deploy/web-compose.yml`);
});

test("web-compose.yml runs the job worker every minute with CRON_SECRET, over the private network", () => {
  const cron = compose.slice(compose.indexOf("\n  cron:"));
  assert.ok(compose.includes("\n  cron:"), "no cron service");
  assert.match(cron, /CRON_SECRET: \$\{CRON_SECRET:-\}/);
  assert.match(cron, /Authorization: Bearer \$\$CRON_SECRET/);
  assert.match(cron, /http:\/\/web-new:3000\/api\/worker/);
  assert.match(cron, /sleep 60/);
});

test("web-compose.yml sends the app's database calls straight to this VPS", () => {
  assert.match(compose, /extra_hosts:\n\s+- "db\.morningtelos\.com:host-gateway"/);
});

