// Morning Telos app server: chat.morningtelos.com
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q, one, all, migrate, getSetting, setSetting, log } from "./lib/db.js";
import { hashPassword, checkPassword, encrypt, token, safeEqual } from "./lib/util.js";
import { AGENTS, ORDER, APPS, runTurn, executeApproval, getConn, costOf } from "./lib/agents.js";
import * as mcp from "./lib/mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const IMGDIR = path.join(here, "..", "site", "img");
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === "production";
const SETUP_CODE = process.env.SETUP_CODE || "";

// ---------- helpers ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, code, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC_HEADERS, "Content-Type": isJson ? "application/json" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
const fail = (res, code, error) => send(res, code, { error });
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("bad json"), { status: 400 }); }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
const isHttps = (req) => PROD || req.headers["x-forwarded-proto"] === "https";
function sessionCookie(req, value, maxAge) {
  return `mt_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
}
async function currentUser(req) {
  const t = cookies(req).mt_session;
  if (!t) return null;
  return one("select u.id, u.email, u.name, u.role from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>now()", [t]);
}
async function startSession(req, res, userId) {
  const t = token();
  await q("insert into sessions(token,user_id,expires_at) values($1,$2,now()+interval '30 days')", [t, userId]);
  return sessionCookie(req, t, 30 * 24 * 3600);
}
const attempts = new Map(); // ip -> [timestamps]
function rateLimited(ip, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(ip, list);
  return list.length > max;
}
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- static ----------
function serveFile(res, file, cache = "no-cache") {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache, "Content-Length": st.size });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(root, p) {
  const full = path.join(root, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, ""));
  return full.startsWith(root) ? full : null;
}

// ---------- API ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler, ...opts });

route("GET", "/api/state", async (req, res, { user }) => {
  const users = (await one("select count(*)::int n from users")).n;
  send(res, 200, { needsSetup: users === 0, setupNeedsCode: !!SETUP_CODE || PROD, me: user });
}, { open: true });

route("POST", "/api/setup", async (req, res) => {
  if (rateLimited("setup:" + ipOf(req))) return fail(res, 429, "Too many tries. Wait 15 minutes.");
  const b = await readJson(req);
  if ((await one("select count(*)::int n from users")).n > 0) return fail(res, 400, "Setup is already done. Log in instead.");
  if (SETUP_CODE ? !safeEqual(b.code || "", SETUP_CODE) : PROD) return fail(res, 403, "That setup code isn't right.");
  const email = cleanEmail(b.email);
  if (!validEmail(email)) return fail(res, 400, "Enter a real email address.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  const u = await one("insert into users(email,name,pass_hash,role) values($1,$2,$3,'owner') returning id", [email, String(b.name || "").slice(0, 80), hashPassword(b.password)]);
  await log("chief", "set up the workspace");
  send(res, 200, { ok: true }, { "Set-Cookie": await startSession(req, res, u.id) });
}, { open: true });

route("POST", "/api/login", async (req, res) => {
  if (rateLimited("login:" + ipOf(req))) return fail(res, 429, "Too many tries. Wait 15 minutes.");
  const b = await readJson(req);
  const u = await one("select id, pass_hash from users where email=$1", [cleanEmail(b.email)]);
  if (!u || !checkPassword(String(b.password || ""), u.pass_hash)) return fail(res, 401, "Email or password is wrong.");
  send(res, 200, { ok: true }, { "Set-Cookie": await startSession(req, res, u.id) });
}, { open: true });

route("POST", "/api/logout", async (req, res) => {
  const t = cookies(req).mt_session;
  if (t) await q("delete from sessions where token=$1", [t]);
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
});

async function appsState() {
  const rows = await all("select tool, url, secret_enc, status, tool_count, error, updated_at from connections");
  const by = Object.fromEntries(rows.map((r) => [r.tool, r]));
  return Object.entries(APPS).map(([k, a]) => {
    const r = by[k];
    return { key: k, name: a.name, kind: a.kind, help: a.help, url: r?.url || a.url || "", defaultUrl: a.url, hasKey: !!r?.secret_enc, keyHint: r?.secret_enc ? "saved" : "", status: r?.status || "off", toolCount: r?.tool_count || 0, error: r?.error || null };
  });
}
async function agentsState() {
  const st = Object.fromEntries((await all("select * from agent_settings")).map((r) => [r.agent, r]));
  const conns = Object.fromEntries((await all("select tool, status from connections")).map((r) => [r.tool, r.status]));
  return ORDER.map((k) => {
    const a = AGENTS[k];
    const need = a.apps.includes("*") ? [] : a.apps;
    const ready = a.apps.includes("*") ? Object.values(conns).some((s) => s === "ok") : need.every((t) => conns[t] === "ok");
    return { key: k, god: a.god, name: a.name, job: a.job, out: a.out, apps: a.apps.includes("*") ? ["all"] : a.apps, enabled: st[k]?.enabled ?? true, trust: st[k]?.trust ?? 0, ready, missing: need.filter((t) => conns[t] !== "ok").map((t) => APPS[t].name) };
  });
}

route("GET", "/api/bootstrap", async (req, res, { user }) => {
  const [agents, apps, threads, pending] = await Promise.all([
    agentsState(), appsState(),
    all("select id, title, updated_at from threads order by updated_at desc limit 8"),
    one("select count(*)::int n from approvals where status='pending'"),
  ]);
  send(res, 200, { me: user, agents, apps, threads, pending: pending.n, business: (await getSetting("business_name")) || "Morning Telos", timezone: (await getSetting("timezone")) || "America/Chicago" });
});

route("GET", "/api/home", async (req, res) => {
  const week = "now() - interval '7 days'";
  const [runs, done, spend, activity] = await Promise.all([
    one(`select count(*)::int n from messages where role='agent' and created_at > ${week}`),
    one(`select count(*)::int n from approvals where status='done' and decided_at > ${week}`),
    all(`select model, sum(input_tokens)::int input_tokens, sum(output_tokens)::int output_tokens, sum(cache_read)::int cache_read, sum(cache_write)::int cache_write from usage where created_at > ${week} group by model`),
    all("select agent, text, thread_id, created_at from activity order by id desc limit 8"),
  ]);
  send(res, 200, { replies: runs.n, changesDone: done.n, spend: spend.reduce((s, u) => s + costOf(u), 0), activity });
});

route("GET", "/api/threads", async (req, res) => send(res, 200, await all("select id, title, updated_at from threads order by updated_at desc limit 50")));
route("GET", "/api/threads/:id", async (req, res, { params }) => {
  const t = await one("select id, title from threads where id=$1", [params.id]);
  if (!t) return fail(res, 404, "Not found");
  const msgs = await all("select id, role, agent, content, meta, created_at from messages where thread_id=$1 order by id", [t.id]);
  const aps = await all("select id, agent, title, status from approvals where thread_id=$1 order by id", [t.id]);
  send(res, 200, { ...t, messages: msgs, approvals: aps });
});
route("DELETE", "/api/threads/:id", async (req, res, { params }) => { await q("delete from threads where id=$1", [params.id]); send(res, 200, { ok: true }); });

route("POST", "/api/chat", async (req, res, { user }) => {
  const b = await readJson(req);
  const text = String(b.text || "").trim().slice(0, 8000);
  if (!text) return fail(res, 400, "Type a message.");
  const forced = AGENTS[b.agent] ? b.agent : null;
  let threadId = Number(b.threadId) || null;
  if (threadId && !(await one("select id from threads where id=$1", [threadId]))) threadId = null;
  if (!threadId) {
    const title = text.replace(/\s+/g, " ").slice(0, 70);
    threadId = (await one("insert into threads(title,user_id) values($1,$2) returning id", [title, user.id])).id;
  }
  await q("insert into messages(thread_id,role,content,meta) values($1,'user',$2,$3)", [threadId, text, JSON.stringify({ user: user.name || user.email })]);
  res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  let open = true;
  req.on("close", () => { open = false; });
  const emit = (ev) => { if (open) res.write(JSON.stringify(ev) + "\n"); };
  emit({ type: "thread", id: threadId });
  try {
    await runTurn({ threadId, text, forced, model: ["auto", "opus", "sonnet", "haiku"].includes(b.model) ? b.model : "auto", emit });
  } catch (e) {
    console.error(e);
    emit({ type: "message", agent: "chief", text: "Something went wrong. Try again.", error: true });
  }
  emit({ type: "done" });
  if (open) res.end();
});

route("GET", "/api/approvals", async (req, res) => {
  const status = new URL(req.url, "http://x").searchParams.get("status") || "pending";
  send(res, 200, await all("select id, thread_id, agent, server, tool, input, title, why, status, result, created_at, decided_at from approvals where status=$1 order by id desc limit 100", [status]));
});
route("POST", "/api/approvals/:id", async (req, res, { params, user }) => {
  const b = await readJson(req);
  const ap = await one("select * from approvals where id=$1", [params.id]);
  if (!ap) return fail(res, 404, "Not found");
  if (ap.status !== "pending") return fail(res, 409, "Already handled.");
  if (b.action === "skip") {
    await q("update approvals set status='skipped', decided_by=$2, decided_at=now() where id=$1", [ap.id, user.id]);
    await log(ap.agent, `skipped: ${ap.title}`, ap.thread_id);
    return send(res, 200, { ok: true, status: "skipped" });
  }
  if (b.action !== "approve") return fail(res, 400, "Unknown action.");
  let input = ap.input;
  if (b.input !== undefined) {
    if (typeof b.input !== "object" || b.input === null || Array.isArray(b.input)) return fail(res, 400, "Edited input must be a JSON object.");
    input = b.input;
  }
  // Claim it first so a double click can't run it twice.
  const claimed = await one("update approvals set status='running', input=$2, decided_by=$3, decided_at=now() where id=$1 and status='pending' returning id", [ap.id, JSON.stringify(input), user.id]);
  if (!claimed) return fail(res, 409, "Already handled.");
  try {
    const r = await executeApproval(ap, input);
    const status = r.isError ? "failed" : "done";
    await q("update approvals set status=$2, result=$3 where id=$1", [ap.id, status, (r.text || "").slice(0, 20000)]);
    await log(ap.agent, `${status === "done" ? "finished" : "failed"}: ${ap.title}`, ap.thread_id);
    if (ap.thread_id) await q("insert into messages(thread_id,role,agent,content,meta) values($1,'event',$2,$3,$4)", [ap.thread_id, ap.agent, `${status === "done" ? "Approved and done" : "Approved, but it failed"}: ${ap.title}`, JSON.stringify({ approval: ap.id, result: (r.text || "").slice(0, 2000) })]);
    send(res, 200, { ok: !r.isError, status, result: (r.text || "").slice(0, 4000) });
  } catch (e) {
    await q("update approvals set status='failed', result=$2 where id=$1", [ap.id, e.message]);
    await log(ap.agent, `failed: ${ap.title}`, ap.thread_id);
    send(res, 200, { ok: false, status: "failed", result: e.message });
  }
});

route("GET", "/api/knowledge", async (req, res) => send(res, 200, await all("select id, title, body, scope, agent, updated_at from knowledge order by id desc")));
route("POST", "/api/knowledge", async (req, res, { user }) => {
  const b = await readJson(req);
  const title = String(b.title || "").trim().slice(0, 200), body = String(b.body || "").slice(0, 20000);
  if (!title) return fail(res, 400, "Give it a title.");
  const agent = AGENTS[b.agent] ? b.agent : null;
  const r = await one("insert into knowledge(title,body,scope,agent,created_by) values($1,$2,$3,$4,$5) returning id", [title, body, agent ? "agent" : "company", agent, user.id]);
  send(res, 200, { id: r.id });
});
route("PUT", "/api/knowledge/:id", async (req, res, { params }) => {
  const b = await readJson(req);
  const agent = AGENTS[b.agent] ? b.agent : null;
  await q("update knowledge set title=$2, body=$3, agent=$4, scope=$5, updated_at=now() where id=$1", [params.id, String(b.title || "").slice(0, 200), String(b.body || "").slice(0, 20000), agent, agent ? "agent" : "company"]);
  send(res, 200, { ok: true });
});
route("DELETE", "/api/knowledge/:id", async (req, res, { params }) => { await q("delete from knowledge where id=$1", [params.id]); send(res, 200, { ok: true }); });

route("GET", "/api/apps", async (req, res) => send(res, 200, await appsState()));
route("POST", "/api/apps/:tool", async (req, res, { params }) => {
  const app = APPS[params.tool];
  if (!app) return fail(res, 404, "Unknown app");
  const b = await readJson(req);
  const prev = await getConn(params.tool);
  const key = b.key ? String(b.key).trim() : prev?.key;
  let url = app.kind === "mcp" ? String(b.url ?? prev?.url ?? app.url ?? "").trim() : null;
  if (app.kind === "mcp" && url && !(PROD ? /^https:\/\/\S+$/ : /^https?:\/\/\S+$/).test(url)) return fail(res, 400, "The address must start with https://");
  if (!key) return fail(res, 400, "Paste the API key.");
  let status = "ok", error = null, count = 0;
  try {
    if (app.kind === "key") {
      const r = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/models?limit=1`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 401 || r.status === 403) throw new Error("Claude rejected this key.");
      if (!r.ok) throw new Error(`Claude answered ${r.status}.`);
    } else {
      if (!url) throw new Error("Paste the MCP address.");
      mcp.forget(url);
      await mcp.initialize(url, key);
      count = (await mcp.listTools(url, key, { fresh: true })).length;
    }
  } catch (e) {
    status = "error"; error = e.message.slice(0, 300);
  }
  await q(`insert into connections(tool,url,secret_enc,status,tool_count,error,updated_at) values($1,$2,$3,$4,$5,$6,now())
    on conflict(tool) do update set url=excluded.url, secret_enc=excluded.secret_enc, status=excluded.status, tool_count=excluded.tool_count, error=excluded.error, updated_at=now()`,
    [params.tool, url, encrypt(key), status, count, error]);
  if (status === "ok") await log("chief", `connected ${app.name}${count ? ` (${count} tools)` : ""}`);
  send(res, 200, { status, error, toolCount: count });
});
route("DELETE", "/api/apps/:tool", async (req, res, { params }) => {
  const c = await getConn(params.tool);
  if (c?.url) mcp.forget(c.url);
  await q("delete from connections where tool=$1", [params.tool]);
  send(res, 200, { ok: true });
});

route("POST", "/api/agents/:key", async (req, res, { params }) => {
  if (!AGENTS[params.key]) return fail(res, 404, "Unknown agent");
  const b = await readJson(req);
  const cur = (await one("select * from agent_settings where agent=$1", [params.key])) || { enabled: true, trust: 0 };
  const enabled = typeof b.enabled === "boolean" ? b.enabled : cur.enabled;
  const trust = [0, 2].includes(b.trust) ? b.trust : cur.trust;
  await q("insert into agent_settings(agent,enabled,trust) values($1,$2,$3) on conflict(agent) do update set enabled=$2, trust=$3", [params.key, enabled, trust]);
  send(res, 200, { ok: true, enabled, trust });
});
route("GET", "/api/agents/:key/stats", async (req, res, { params }) => {
  const k = params.key;
  const [replies, done, pending, recent] = await Promise.all([
    one("select count(*)::int n from messages where role='agent' and agent=$1 and created_at > now()-interval '7 days'", [k]),
    one("select count(*)::int n from approvals where agent=$1 and status='done' and decided_at > now()-interval '7 days'", [k]),
    one("select count(*)::int n from approvals where agent=$1 and status='pending'", [k]),
    all("select text, created_at from activity where agent=$1 order by id desc limit 8", [k]),
  ]);
  send(res, 200, { replies: replies.n, done: done.n, pending: pending.n, recent });
});

route("GET", "/api/routines", async (req, res) => send(res, 200, await all("select * from routines order by id")));
route("POST", "/api/routines", async (req, res) => {
  const b = await readJson(req);
  if (!AGENTS[b.agent]) return fail(res, 400, "Pick a teammate.");
  const title = String(b.title || "").trim().slice(0, 120), instruction = String(b.instruction || "").trim().slice(0, 4000);
  if (!title || !instruction) return fail(res, 400, "Add a name and what to do.");
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
  const at = /^\d{2}:\d{2}$/.test(b.at_time) ? b.at_time : "08:00";
  const r = await one("insert into routines(agent,title,instruction,days,at_time) values($1,$2,$3,$4,$5) returning id", [b.agent, title, instruction, days.length ? days : [1, 2, 3, 4, 5], at]);
  send(res, 200, { id: r.id });
});
route("PUT", "/api/routines/:id", async (req, res, { params }) => {
  const b = await readJson(req);
  if (typeof b.enabled === "boolean") await q("update routines set enabled=$2 where id=$1", [params.id, b.enabled]);
  send(res, 200, { ok: true });
});
route("DELETE", "/api/routines/:id", async (req, res, { params }) => { await q("delete from routines where id=$1", [params.id]); send(res, 200, { ok: true }); });
route("POST", "/api/routines/:id/run", async (req, res, { params }) => {
  const r = await one("select * from routines where id=$1", [params.id]);
  if (!r) return fail(res, 404, "Not found");
  const threadId = await runRoutine(r);
  send(res, 200, { threadId });
});

route("GET", "/api/settings", async (req, res, { user }) => {
  send(res, 200, {
    business_name: (await getSetting("business_name")) || "Morning Telos",
    timezone: (await getSetting("timezone")) || "America/Chicago",
    hook_url: `https://chat.morningtelos.com/hooks/claritia/${await hookToken()}`,
    users: await all("select id, email, name, role, created_at from users order by id"),
    me: user,
  });
});
route("POST", "/api/settings", async (req, res) => {
  const b = await readJson(req);
  if (b.business_name !== undefined) await setSetting("business_name", String(b.business_name).trim().slice(0, 120) || "Morning Telos");
  if (b.timezone !== undefined) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: b.timezone }); await setSetting("timezone", b.timezone); } catch { return fail(res, 400, "Unknown time zone."); }
  }
  send(res, 200, { ok: true });
});
route("POST", "/api/users", async (req, res, { user }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can add people.");
  const b = await readJson(req);
  const email = cleanEmail(b.email);
  if (!validEmail(email)) return fail(res, 400, "Enter a real email address.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  try {
    await q("insert into users(email,name,pass_hash) values($1,$2,$3)", [email, String(b.name || "").slice(0, 80), hashPassword(b.password)]);
  } catch { return fail(res, 400, "That email already has an account."); }
  send(res, 200, { ok: true });
});
route("POST", "/api/me/password", async (req, res, { user }) => {
  const b = await readJson(req);
  const u = await one("select pass_hash from users where id=$1", [user.id]);
  if (!checkPassword(String(b.current || ""), u.pass_hash)) return fail(res, 400, "Your current password is wrong.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  await q("update users set pass_hash=$2 where id=$1", [user.id, hashPassword(b.password)]);
  send(res, 200, { ok: true });
});
route("DELETE", "/api/users/:id", async (req, res, { params, user }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can remove people.");
  if (Number(params.id) === user.id) return fail(res, 400, "You can't remove yourself.");
  await q("delete from users where id=$1 and role<>'owner'", [params.id]);
  send(res, 200, { ok: true });
});

// Claritia (or any form tool) can post submissions here.
async function hookToken() {
  let t = await getSetting("hook_token");
  if (!t) { t = token(18); await setSetting("hook_token", t); }
  return t;
}
route("POST", "/hooks/claritia/:token", async (req, res, { params }) => {
  if (!safeEqual(params.token, await hookToken())) return fail(res, 404, "Not found");
  const b = await readJson(req);
  await q("insert into submissions(source,payload) values('claritia',$1)", [JSON.stringify(b)]);
  await log("forms", "got a new form submission from Claritia");
  send(res, 200, { ok: true });
}, { open: true });
route("GET", "/api/submissions", async (req, res) => send(res, 200, await all("select id, source, payload, created_at from submissions order by id desc limit 50")));

// ---------- routines scheduler ----------
async function runRoutine(r) {
  const threadId = (await one("insert into threads(title,routine_id) values($1,$2) returning id", [`Routine: ${r.title}`, r.id])).id;
  await q("insert into messages(thread_id,role,content,meta) values($1,'user',$2,'{\"routine\":true}')", [threadId, r.instruction]);
  await q("update routines set last_run_at=now() where id=$1", [r.id]);
  await log(r.agent, `started the routine "${r.title}"`, threadId);
  runTurn({ threadId, text: r.instruction, forced: r.agent, model: "auto", emit: () => {} }).catch((e) => console.error("routine", e));
  return threadId;
}
async function tick() {
  try {
    const tz = (await getSetting("timezone")) || "America/Chicago";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    const hm = `${parts.hour}:${parts.minute}`;
    const due = await all("select * from routines where enabled and at_time=$1 and $2 = any(days) and (last_run_at is null or last_run_at < now() - interval '5 minutes')", [hm, day]);
    for (const r of due) await runRoutine(r);
  } catch (e) { console.error("tick", e); }
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p.startsWith("/api/") || p.startsWith("/hooks/")) {
      const r = routes.find((r) => r.method === req.method && r.re.test(p));
      if (!r) return fail(res, 404, "Not found");
      // Same-site check: a custom header that cross-site forms can't send.
      if (req.method !== "GET" && !p.startsWith("/hooks/") && req.headers["x-mt"] !== "1") return fail(res, 403, "Blocked");
      const user = await currentUser(req);
      if (!r.open && !user) return fail(res, 401, "Log in first.");
      return await r.handler(req, res, { user, params: r.re.exec(p).groups || {} });
    }
    if (p === "/healthz") return send(res, 200, "ok");
    if (p.startsWith("/img/")) {
      const f = safeJoin(IMGDIR, p.slice(5));
      return f ? serveFile(res, f, "public, max-age=86400") : send(res, 404, "Not found");
    }
    if (p === "/" || p === "/index.html") return serveFile(res, path.join(PUBLIC, "index.html"));
    const f = safeJoin(PUBLIC, p.slice(1));
    if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return serveFile(res, f);
    return serveFile(res, path.join(PUBLIC, "index.html"));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : "Server error");
    else res.end();
  }
});

await migrate();
await q("delete from sessions where expires_at < now()");
await q("update approvals set status='failed', result='Stopped by a server restart. Check the app before trying again.' where status='running'");
server.requestTimeout = 0; // chat responses stream for minutes
server.listen(PORT, () => console.log(`Morning Telos app on :${PORT}`));
setInterval(tick, 60 * 1000);
process.on("SIGTERM", () => { server.close(); pool.end().finally(() => process.exit(0)); });
