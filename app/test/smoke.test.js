// Starts the real server against Postgres and walks through sign-up.
// Uses TEST_DATABASE_URL only, never DATABASE_URL, so it can never touch a real database.
// Skips when no test database is reachable. CI sets one up.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.TEST_DATABASE_URL || "postgres://mt:mt@localhost:5432/mt";
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server, logs = "", dbReady = false;

async function canReachDb() {
  const c = new pg.Client({ connectionString: DB, connectionTimeoutMillis: 2000 });
  try { await c.connect(); await c.end(); return true; } catch (e) { console.log("# database not reachable:", e.message); return false; }
}

before(async () => {
  dbReady = await canReachDb();
  if (!dbReady) return;
  server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(here, ".."),
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, NODE_ENV: "test", ANTHROPIC_API_KEY: "", RESEND_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs}`);
});

after(() => server?.kill("SIGTERM"));

const api = (p, { method = "GET", body, cookie } = {}) => fetch(BASE + p, {
  method,
  headers: { "content-type": "application/json", "x-mt": "1", ...(cookie ? { cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test("health check answers", async (t) => {
  if (!dbReady) return t.skip("no database");
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
});

test("sign up, then load the workspace", async (t) => {
  if (!dbReady) return t.skip("no database");
  const email = `smoke-${Date.now()}@example.com`;
  const r = await api("/api/signup", { method: "POST", body: { name: "Smoke Test", business: "Smoke Co", email, password: "a-long-password-123", timezone: "UTC" } });
  assert.equal(r.status, 200, await r.text());
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie, "no session cookie");

  const boot = await api("/api/bootstrap", { cookie });
  assert.equal(boot.status, 200);
  const b = await boot.json();
  assert.equal(b.ws.name, "Smoke Co");
  assert.ok(Array.isArray(b.agents) && b.agents.length > 0);

  const k = await (await api("/api/knowledge", { cookie })).json();
  assert.ok(k.some((d) => d.title === "About Smoke Co"), "starter knowledge doc missing");

  const home = await api("/api/home", { cookie });
  assert.equal(home.status, 200);
});

test("API routes need a login", async (t) => {
  if (!dbReady) return t.skip("no database");
  assert.equal((await api("/api/bootstrap")).status, 401);
});
