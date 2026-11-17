// Morning Telos app server (chat.morningtelos.com). Each customer business is a workspace.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q, one, all, migrate, setSetting, log } from "./lib/db.js";
import { hashPassword, checkPassword, encrypt, decrypt, token } from "./lib/util.js";
import { AGENTS, ORDER, APPS, SERVICES, runTurn, executeApproval, getConn, spendSince, canRun } from "./lib/agents.js";
import * as mcp from "./lib/mcp.js";
import * as billing from "./lib/billing.js";
import crypto from "node:crypto";
import { sendEmail, layout } from "./lib/email.js";
import { noteFailure } from "./lib/alerts.js";
import { runBackup, backupStatus, r2Put } from "./lib/backup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const IMGDIR = path.join(here, "..", "site", "img");
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === "production";
const ORIGIN = process.env.APP_ORIGIN || (PROD ? "https://chat.morningtelos.com" : `http://localhost:${PORT}`);

// ---------- helpers ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const SEC = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
if (PROD) SEC["Strict-Transport-Security"] = "max-age=31536000";
function send(res, code, body, headers = {}) {
  const json = typeof body !== "string";
  res.writeHead(code, { ...SEC, "Content-Type": json ? "application/json" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
const fail = (res, code, error) => send(res, code, { error });
async function readRaw(req, max = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("Too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}
async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Bad JSON"), { status: 400 }); }
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const sessionCookie = (value, maxAge) => `mt_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${PROD ? "; Secure" : ""}`;
async function startSession(userId) {
  const t = token();
  await q("insert into sessions(token,user_id,expires_at) values($1,$2,now()+interval '30 days')", [t, userId]);
  return sessionCookie(t, 30 * 24 * 3600);
}
async function auth(req) {
  const t = cookies(req).mt_session;
  if (!t) return {};
  const user = await one("select u.id, u.email, u.name, u.role, u.is_admin, u.workspace_id, (u.email_verified_at is not null) as email_verified from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>now()", [t]);
  if (!user) return {};
  return { user, ws: await one("select * from workspaces where id=$1", [user.workspace_id]) };
}
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now); hits.set(key, list);
  return list.length > max;
}
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
const cleanUrl = (u) => String(u || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").slice(0, 200);
const validTz = (z) => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return !!z; } catch { return false; } };

// ---------- email tokens ----------
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
async function makeToken(userId, kind, minutes) {
  const t = token(32);
  await q("delete from email_tokens where user_id=$1 and kind=$2 and used_at is null", [userId, kind]);
  await q("insert into email_tokens(token_hash,user_id,kind,expires_at) values($1,$2,$3,now()+make_interval(mins => $4))", [hashToken(t), userId, kind, minutes]);
  return t;
}
async function useToken(t, kind) {
  return one("update email_tokens set used_at=now() where token_hash=$1 and kind=$2 and used_at is null and expires_at>now() returning user_id", [hashToken(t), kind]);
}
async function sendVerify(userId, email, name) {
  const url = `${ORIGIN}/#verify=${await makeToken(userId, "verify", 60 * 48)}`;
  return sendEmail({ to: email, subject: "Verify your email for Morning Telos",
    text: `Hi ${name || "there"}, confirm your email for Morning Telos: ${url}`,
    html: layout({ title: `Welcome${name ? ", " + name.split(" ")[0] : ""}`, intro: "Confirm your email so we can reach you about your AI team and your account.", button: "Verify my email", url, outro: "This link works for 48 hours." }) });
}

// ---------- static ----------
function serveFile(res, file, cache = "no-cache") {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, { ...SEC, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache, "Content-Length": st.size });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(root, p) {
  let rel; try { rel = decodeURIComponent(p); } catch { return null; }
  const full = path.resolve(root, "." + path.posix.normalize("/" + rel));
  return full.startsWith(root + path.sep) ? full : null;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler, ...opts });

route("GET", "/api/state", async (req, res, { user }) => send(res, 200, { me: user || null }), { open: true });

route("POST", "/api/signup", async (req, res) => {
  if (limited("signup:" + ipOf(req), 5, 60 * 60 * 1000)) return fail(res, 429, "Too many sign-ups from here. Try again later.");
  const b = await readJson(req);
  const email = cleanEmail(b.email), business = String(b.business || "").trim().slice(0, 120), name = String(b.name || "").trim().slice(0, 80);
  if (!name) return fail(res, 400, "Enter your name.");
  if (!business) return fail(res, 400, "Enter your business name.");
  if (!validEmail(email)) return fail(res, 400, "Enter a real email address.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  if (await one("select 1 from users where email=$1", [email])) return fail(res, 400, "That email already has an account. Log in instead.");
  const site = cleanUrl(b.website);
  const ws = await one("insert into workspaces(name,website,timezone,hook_token) values($1,$2,$3,$4) returning id", [business, site, validTz(b.timezone) ? b.timezone : "America/Chicago", token(18)]);
  const u = await one("insert into users(email,name,pass_hash,role,workspace_id) values($1,$2,$3,'owner',$4) returning id", [email, name, hashPassword(b.password), ws.id]);
  await q("insert into knowledge(workspace_id,title,body,created_by) values($1,$2,$3,$4)", [ws.id, `About ${business}`, `${business}${site ? ` (${site})` : ""}.\n\nWhat we sell:\nWho our customers are:\nWhere we work:\nHow we sound:`, u.id]);
  await log(ws.id, "chief", "set up your workspace. Your 14-day free trial has started");
  sendVerify(u.id, email, name).catch(() => {});
  send(res, 200, { ok: true }, { "Set-Cookie": await startSession(u.id) });
}, { open: true });

route("POST", "/api/login", async (req, res) => {
  if (limited("login:" + ipOf(req), 10, 15 * 60 * 1000)) return fail(res, 429, "Too many tries. Wait 15 minutes.");
  const b = await readJson(req);
  const u = await one("select id, pass_hash from users where email=$1", [cleanEmail(b.email)]);
  if (!u || !checkPassword(String(b.password || ""), u.pass_hash)) return fail(res, 401, "Email or password is wrong.");
  send(res, 200, { ok: true }, { "Set-Cookie": await startSession(u.id) });
}, { open: true });

route("POST", "/api/logout", async (req, res) => {
  const t = cookies(req).mt_session;
  if (t) await q("delete from sessions where token=$1", [t]);
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
});

route("POST", "/api/verify", async (req, res) => {
  const b = await readJson(req);
  const r = b.token ? await useToken(b.token, "verify") : null;
  if (!r) return fail(res, 400, "That link has expired or was already used. Send a new one from the app.");
  await q("update users set email_verified_at=coalesce(email_verified_at, now()) where id=$1", [r.user_id]);
  send(res, 200, { ok: true });
}, { open: true });
route("POST", "/api/verify/resend", async (req, res, { user }) => {
  if (user.email_verified) return send(res, 200, { ok: true, already: true });
  if (limited("verify:" + user.id, 3, 60 * 60 * 1000)) return fail(res, 429, "We already sent a few. Check your inbox and spam folder.");
  await sendVerify(user.id, user.email, user.name);
  send(res, 200, { ok: true });
});
route("POST", "/api/password/forgot", async (req, res) => {
  const b = await readJson(req), email = cleanEmail(b.email);
  if (limited("forgot:" + ipOf(req), 5, 60 * 60 * 1000) || limited("forgot:" + email, 3, 60 * 60 * 1000)) return fail(res, 429, "Too many requests. Try again in an hour.");
  const u = validEmail(email) ? await one("select id, name from users where email=$1", [email]) : null;
  if (u) {
    const url = `${ORIGIN}/#reset=${await makeToken(u.id, "reset", 60)}`;
    await sendEmail({ to: email, subject: "Reset your Morning Telos password", text: `Reset your password: ${url} (works for 1 hour). If you didn't ask for this, ignore this email.`,
      html: layout({ title: "Reset your password", intro: "Someone asked to reset the password for your Morning Telos account. If it was you, use the button below.", button: "Choose a new password", url, outro: "This link works for 1 hour. If you didn't ask for this, you can ignore this email." }) });
  }
  send(res, 200, { ok: true });
}, { open: true });
route("POST", "/api/password/reset", async (req, res) => {
  if (limited("reset:" + ipOf(req), 10, 60 * 60 * 1000)) return fail(res, 429, "Too many tries. Try again later.");
  const b = await readJson(req);
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  const r = b.token ? await useToken(b.token, "reset") : null;
  if (!r) return fail(res, 400, "That link has expired or was already used. Ask for a new one.");
  await q("update users set pass_hash=$2, email_verified_at=coalesce(email_verified_at, now()) where id=$1", [r.user_id, hashPassword(b.password)]);
  await q("delete from sessions where user_id=$1", [r.user_id]);
  send(res, 200, { ok: true }, { "Set-Cookie": await startSession(r.user_id) });
}, { open: true });
route("DELETE", "/api/workspace", async (req, res, { user, ws }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can delete the workspace.");
  const b = await readJson(req);
  if (String(b.name || "").trim() !== ws.name) return fail(res, 400, "Type the workspace name exactly to confirm.");
  const u = await one("select pass_hash from users where id=$1", [user.id]);
  if (!checkPassword(String(b.password || ""), u.pass_hash)) return fail(res, 400, "Your password is wrong.");
  if (await one("select 1 from users where workspace_id=$1 and is_admin", [ws.id])) return fail(res, 400, "The Morning Telos admin workspace can't be deleted here.");
  if (ws.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(ws.status)) {
    try { await billing.stripe(`subscriptions/${ws.stripe_subscription_id}`, null, null, "DELETE"); }
    catch (e) { return fail(res, 400, "We couldn't cancel your subscription automatically. Cancel it in Billing first, then try again."); }
  }
  await q("delete from workspaces where id=$1", [ws.id]);
  sendEmail({ to: user.email, subject: "Your Morning Telos workspace was deleted", text: `Your workspace "${ws.name}" and its data were deleted. Backups clear within 30 days.`,
    html: layout({ title: "Your workspace was deleted", intro: `"${ws.name}" and its chats, knowledge, approvals and routines were deleted. Copies in our encrypted backups are cleared within 30 days. Thanks for trying Morning Telos.` }) }).catch(() => {});
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
});

async function servicesFor(ws) {
  const conns = Object.fromEntries((await all("select tool, status from connections")).map((r) => [r.tool, r.status]));
  return Object.fromEntries(Object.entries(SERVICES).map(([k, s]) => [k, { label: s.label, setup: !!ws[s.field], ready: !!ws[s.field] && conns[k] === "ok" }]));
}
async function agentsFor(ws) {
  const prefs = Object.fromEntries((await all("select * from agent_prefs where workspace_id=$1", [ws.id])).map((r) => [r.agent, r]));
  const svc = await servicesFor(ws);
  return ORDER.map((k) => {
    const a = AGENTS[k], need = a.apps.includes("*") ? [] : a.apps;
    const missing = need.filter((s) => !svc[s]?.ready).map((s) => SERVICES[s].label);
    return { key: k, god: a.god, name: a.name, job: a.job, out: a.out, soon: !!a.soon, services: a.apps.includes("*") ? Object.keys(SERVICES) : a.apps,
      enabled: prefs[k]?.enabled ?? true, trust: prefs[k]?.trust ?? 0, ready: !a.soon && !missing.length, missing };
  });
}
const wsPublic = (ws) => ({ id: ws.id, name: ws.name, website: ws.website, timezone: ws.timezone, plan: ws.plan, status: ws.status, trial_ends_at: ws.trial_ends_at, setup_note: ws.setup_note });

route("GET", "/api/bootstrap", async (req, res, { user, ws }) => {
  const [agents, threads, services, blocked] = await Promise.all([
    agentsFor(ws), all("select id, title, updated_at from threads where workspace_id=$1 order by updated_at desc limit 8", [ws.id]), servicesFor(ws), canRun(ws)]);
  send(res, 200, { me: user, ws: wsPublic(ws), agents, threads, services, blocked });
});

route("GET", "/api/home", async (req, res, { ws }) => {
  const [runs, done, activity, spend] = await Promise.all([
    one("select count(*)::int n from messages m join threads t on t.id=m.thread_id where t.workspace_id=$1 and m.role='agent' and m.created_at > now()-interval '7 days'", [ws.id]),
    one("select count(*)::int n from approvals where workspace_id=$1 and status='done' and decided_at > now()-interval '7 days'", [ws.id]),
    all("select agent, text, thread_id, created_at from activity where workspace_id=$1 order by id desc limit 8", [ws.id]),
    spendSince(ws.id, new Date(Date.now() - 7 * 864e5)),
  ]);
  send(res, 200, { replies: runs.n, changesDone: done.n, activity, spend });
});

route("GET", "/api/threads/:id", async (req, res, { ws, params }) => {
  const t = await one("select id, title from threads where id=$1 and workspace_id=$2", [params.id, ws.id]);
  if (!t) return fail(res, 404, "Not found");
  const messages = await all("select id, role, agent, content, meta, created_at from messages where thread_id=$1 order by id", [t.id]);
  const approvals = await all("select id, agent, title, status from approvals where thread_id=$1 order by id", [t.id]);
  send(res, 200, { ...t, messages, approvals });
});

route("POST", "/api/chat", async (req, res, { user, ws }) => {
  if (limited("chat:" + ws.id, 60, 60 * 60 * 1000)) return fail(res, 429, "That's a lot of messages this hour. Try again soon.");
  const b = await readJson(req);
  const text = String(b.text || "").trim().slice(0, 8000);
  if (!text) return fail(res, 400, "Type a message.");
  const forced = AGENTS[b.agent] ? b.agent : null;
  let threadId = Number(b.threadId) || null;
  if (threadId && !(await one("select id from threads where id=$1 and workspace_id=$2", [threadId, ws.id]))) threadId = null;
  if (!threadId) threadId = (await one("insert into threads(workspace_id,title,user_id) values($1,$2,$3) returning id", [ws.id, text.replace(/\s+/g, " ").slice(0, 70), user.id])).id;
  await q("insert into messages(thread_id,role,content,meta) values($1,'user',$2,$3)", [threadId, text, JSON.stringify({ user: user.name || user.email })]);
  res.writeHead(200, { ...SEC, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  let open = true;
  req.on("close", () => { open = false; });
  const emit = (ev) => { if (open) res.write(JSON.stringify(ev) + "\n"); };
  emit({ type: "thread", id: threadId });
  try { await runTurn({ ws, threadId, text, forced, model: ["auto", "opus", "sonnet", "haiku"].includes(b.model) ? b.model : "auto", emit }); }
  catch (e) { console.error(e); emit({ type: "message", agent: "chief", text: "Something went wrong. Try again.", error: true }); }
  emit({ type: "done" });
  if (open) res.end();
});

route("GET", "/api/approvals", async (req, res, { ws }) => {
  const status = new URL(req.url, "http://x").searchParams.get("status") || "pending";
  send(res, 200, await all("select id, thread_id, agent, server, tool, input, title, why, status, result, created_at from approvals where workspace_id=$1 and status=$2 order by id desc limit 100", [ws.id, status]));
});
route("POST", "/api/approvals/:id", async (req, res, { user, ws, params }) => {
  const b = await readJson(req);
  const ap = await one("select * from approvals where id=$1 and workspace_id=$2", [params.id, ws.id]);
  if (!ap) return fail(res, 404, "Not found");
  if (ap.status !== "pending") return fail(res, 409, "Already handled.");
  if (b.action === "skip") {
    await q("update approvals set status='skipped', decided_by=$2, decided_at=now() where id=$1", [ap.id, user.id]);
    await log(ws.id, ap.agent, `skipped: ${ap.title}`, ap.thread_id);
    return send(res, 200, { status: "skipped" });
  }
  if (b.action !== "approve") return fail(res, 400, "Unknown action.");
  let input = ap.input;
  if (b.input !== undefined) {
    if (typeof b.input !== "object" || !b.input || Array.isArray(b.input)) return fail(res, 400, "Edited details must be a JSON object.");
    input = b.input;
  }
  const claimed = await one("update approvals set status='running', input=$2, decided_by=$3, decided_at=now() where id=$1 and status='pending' returning id", [ap.id, JSON.stringify(input), user.id]);
  if (!claimed) return fail(res, 409, "Already handled.");
  let status = "failed", result = "";
  try { const r = await executeApproval(ws, ap, input); status = r.isError ? "failed" : "done"; result = r.text || ""; }
  catch (e) { result = e.message; }
  await q("update approvals set status=$2, result=$3 where id=$1", [ap.id, status, result.slice(0, 20000)]);
  await log(ws.id, ap.agent, `${status === "done" ? "finished" : "failed"}: ${ap.title}`, ap.thread_id);
  if (ap.thread_id) await q("insert into messages(thread_id,role,agent,content,meta) values($1,'event',$2,$3,$4)", [ap.thread_id, ap.agent, `${status === "done" ? "Approved and done" : "Approved, but it failed"}: ${ap.title}`, JSON.stringify({ approval: ap.id })]);
  send(res, 200, { status, result: result.slice(0, 4000) });
});

route("GET", "/api/knowledge", async (req, res, { ws }) => send(res, 200, await all("select id, title, body, agent, updated_at from knowledge where workspace_id=$1 order by id desc", [ws.id])));
route("POST", "/api/knowledge", async (req, res, { user, ws }) => {
  const b = await readJson(req), title = String(b.title || "").trim().slice(0, 200);
  if (!title) return fail(res, 400, "Give it a title.");
  if ((await one("select count(*)::int n from knowledge where workspace_id=$1", [ws.id])).n >= 200) return fail(res, 400, "You can have up to 200 docs.");
  const r = await one("insert into knowledge(workspace_id,title,body,agent,created_by) values($1,$2,$3,$4,$5) returning id", [ws.id, title, String(b.body || "").slice(0, 20000), AGENTS[b.agent] ? b.agent : null, user.id]);
  send(res, 200, { id: r.id });
});
route("PUT", "/api/knowledge/:id", async (req, res, { ws, params }) => {
  const b = await readJson(req);
  await q("update knowledge set title=$3, body=$4, agent=$5, updated_at=now() where id=$1 and workspace_id=$2", [params.id, ws.id, String(b.title || "").slice(0, 200) || "Untitled", String(b.body || "").slice(0, 20000), AGENTS[b.agent] ? b.agent : null]);
  send(res, 200, { ok: true });
});
route("DELETE", "/api/knowledge/:id", async (req, res, { ws, params }) => { await q("delete from knowledge where id=$1 and workspace_id=$2", [params.id, ws.id]); send(res, 200, { ok: true }); });

route("POST", "/api/agents/:key", async (req, res, { ws, params }) => {
  if (!AGENTS[params.key]) return fail(res, 404, "Unknown teammate");
  const b = await readJson(req);
  const cur = (await one("select * from agent_prefs where workspace_id=$1 and agent=$2", [ws.id, params.key])) || { enabled: true, trust: 0 };
  const enabled = typeof b.enabled === "boolean" ? b.enabled : cur.enabled, trust = [0, 2].includes(b.trust) ? b.trust : cur.trust;
  await q("insert into agent_prefs(workspace_id,agent,enabled,trust) values($1,$2,$3,$4) on conflict(workspace_id,agent) do update set enabled=$3, trust=$4", [ws.id, params.key, enabled, trust]);
  send(res, 200, { enabled, trust });
});
route("GET", "/api/agents/:key/stats", async (req, res, { ws, params }) => {
  const k = params.key;
  const [replies, done, recent] = await Promise.all([
    one("select count(*)::int n from messages m join threads t on t.id=m.thread_id where t.workspace_id=$1 and m.role='agent' and m.agent=$2 and m.created_at > now()-interval '7 days'", [ws.id, k]),
    one("select count(*)::int n from approvals where workspace_id=$1 and agent=$2 and status='done' and decided_at > now()-interval '7 days'", [ws.id, k]),
    all("select text, created_at from activity where workspace_id=$1 and agent=$2 order by id desc limit 8", [ws.id, k]),
  ]);
  send(res, 200, { replies: replies.n, done: done.n, recent });
});

route("GET", "/api/routines", async (req, res, { ws }) => send(res, 200, await all("select * from routines where workspace_id=$1 order by id", [ws.id])));
route("POST", "/api/routines", async (req, res, { ws }) => {
  const b = await readJson(req);
  if (!AGENTS[b.agent] || AGENTS[b.agent].soon) return fail(res, 400, "Pick a teammate.");
  const title = String(b.title || "").trim().slice(0, 120), instruction = String(b.instruction || "").trim().slice(0, 4000);
  if (!title || !instruction) return fail(res, 400, "Add a name and what to do.");
  if ((await one("select count(*)::int n from routines where workspace_id=$1", [ws.id])).n >= 25) return fail(res, 400, "You can have up to 25 routines.");
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
  const r = await one("insert into routines(workspace_id,agent,title,instruction,days,at_time) values($1,$2,$3,$4,$5,$6) returning id", [ws.id, b.agent, title, instruction, days.length ? days : [1, 2, 3, 4, 5], /^\d{2}:\d{2}$/.test(b.at_time) ? b.at_time : "08:00"]);
  send(res, 200, { id: r.id });
});
route("PUT", "/api/routines/:id", async (req, res, { ws, params }) => { const b = await readJson(req); if (typeof b.enabled === "boolean") await q("update routines set enabled=$3 where id=$1 and workspace_id=$2", [params.id, ws.id, b.enabled]); send(res, 200, { ok: true }); });
route("DELETE", "/api/routines/:id", async (req, res, { ws, params }) => { await q("delete from routines where id=$1 and workspace_id=$2", [params.id, ws.id]); send(res, 200, { ok: true }); });
route("POST", "/api/routines/:id/run", async (req, res, { ws, params }) => {
  const r = await one("select * from routines where id=$1 and workspace_id=$2", [params.id, ws.id]);
  if (!r) return fail(res, 404, "Not found");
  send(res, 200, { threadId: await runRoutine(ws, r) });
});

route("GET", "/api/settings", async (req, res, { user, ws }) => send(res, 200, { ws: wsPublic(ws), me: user, users: await all("select id, email, name, role from users where workspace_id=$1 order by id", [ws.id]) }));
route("POST", "/api/settings", async (req, res, { user, ws }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can change this.");
  const b = await readJson(req);
  if (b.timezone && !validTz(b.timezone)) return fail(res, 400, "Unknown time zone.");
  await q("update workspaces set name=$2, website=$3, timezone=$4 where id=$1", [ws.id, String(b.name ?? ws.name).trim().slice(0, 120) || ws.name, b.website !== undefined ? cleanUrl(b.website) : ws.website, b.timezone || ws.timezone]);
  send(res, 200, { ok: true });
});
route("POST", "/api/users", async (req, res, { user, ws }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can add people.");
  const b = await readJson(req), email = cleanEmail(b.email);
  if (!validEmail(email)) return fail(res, 400, "Enter a real email address.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  if ((await one("select count(*)::int n from users where workspace_id=$1", [ws.id])).n >= 10) return fail(res, 400, "You can have up to 10 people.");
  try { await q("insert into users(email,name,pass_hash,workspace_id) values($1,$2,$3,$4)", [email, String(b.name || "").slice(0, 80), hashPassword(b.password), ws.id]); }
  catch { return fail(res, 400, "That email already has an account."); }
  send(res, 200, { ok: true });
});
route("DELETE", "/api/users/:id", async (req, res, { user, ws, params }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can remove people.");
  if (Number(params.id) === user.id) return fail(res, 400, "You can't remove yourself.");
  await q("delete from users where id=$1 and workspace_id=$2 and role<>'owner'", [params.id, ws.id]);
  send(res, 200, { ok: true });
});
route("POST", "/api/me/password", async (req, res, { user }) => {
  const b = await readJson(req);
  const u = await one("select pass_hash from users where id=$1", [user.id]);
  if (!checkPassword(String(b.current || ""), u.pass_hash)) return fail(res, 400, "Your current password is wrong.");
  if (String(b.password || "").length < 10) return fail(res, 400, "Use a password with at least 10 characters.");
  await q("update users set pass_hash=$2 where id=$1", [user.id, hashPassword(b.password)]);
  await q("delete from sessions where user_id=$1 and token<>$2", [user.id, cookies(req).mt_session]);
  send(res, 200, { ok: true });
});

// ---------- billing ----------
route("GET", "/api/billing", async (req, res, { ws }) => {
  const plans = await all("select key, name, price_label, ai_budget_usd, (coalesce(stripe_price_id,'')<>'') buyable from plans where active order by sort");
  const cur = plans.find((p) => p.key === ws.plan);
  send(res, 200, { ws: wsPublic(ws), plans: plans.filter((p) => p.key !== "trial"), budget: Number(cur?.ai_budget_usd ?? 0),
    used: await spendSince(ws.id, ws.plan === "trial" ? ws.created_at : ws.period_start), hasBilling: !!ws.stripe_customer_id, stripe: await billing.stripeReady() });
});
route("POST", "/api/billing/checkout", async (req, res, { user, ws }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can change the plan.");
  if (!user.email_verified) return fail(res, 400, "Verify your email first. Check your inbox, or resend it from Home.");
  const b = await readJson(req);
  const plan = await one("select * from plans where key=$1 and active and coalesce(stripe_price_id,'')<>''", [b.plan]);
  if (!plan) return fail(res, 400, "That plan isn't available.");
  try { send(res, 200, { url: await billing.checkoutUrl(ws, user, plan, ORIGIN) }); } catch (e) { fail(res, 400, e.message); }
});
route("POST", "/api/billing/portal", async (req, res, { user, ws }) => {
  if (user.role !== "owner") return fail(res, 403, "Only the owner can manage billing.");
  try { send(res, 200, { url: await billing.portalUrl(ws, ORIGIN) }); } catch (e) { fail(res, 400, e.message); }
});
route("POST", "/hooks/stripe", async (req, res) => {
  const raw = await readRaw(req, 2_000_000);
  if (!(await billing.verifyWebhook(raw, req.headers["stripe-signature"]))) return fail(res, 400, "Bad signature");
  try { await billing.handleEvent(JSON.parse(raw)); } catch (e) { console.error("stripe hook", e); return fail(res, 500, "Error"); }
  send(res, 200, { received: true });
}, { open: true, hook: true });

// ---------- admin (Morning Telos team only) ----------
const ADMIN = { admin: true };
async function appsState() {
  const by = Object.fromEntries((await all("select * from connections")).map((r) => [r.tool, r]));
  return Object.entries(APPS).map(([k, a]) => {
    const r = by[k];
    // A key saved under an older APP_SECRET can't be unlocked anymore. Ask for it again.
    const lost = r?.secret_enc && decrypt(r.secret_enc) == null;
    return { key: k, name: a.name, kind: a.kind, help: a.help, url: r?.url || a.url || "", hasKey: !!r?.secret_enc && !lost, status: lost ? "error" : r?.status || "off", toolCount: r?.tool_count || 0, error: lost ? "The saved key can't be read anymore. Paste it again." : r?.error || null };
  });
}
route("GET", "/api/admin/overview", async (req, res) => {
  const wss = await all(`select w.id, w.name, w.website, w.plan, w.status, w.trial_ends_at, w.arrowsterr_brand, w.capybaroar_brand_id, w.setup_note, w.created_at,
    (select count(*)::int from users u where u.workspace_id=w.id) users, (select email from users u where u.workspace_id=w.id and u.role='owner' order by id limit 1) owner_email
    from workspaces w order by w.id desc limit 500`);
  for (const w of wss) w.spend30 = await spendSince(w.id, new Date(Date.now() - 30 * 864e5));
  send(res, 200, { workspaces: wss, plans: await all("select * from plans order by sort"), apps: await appsState(), hookUrl: `${ORIGIN}/hooks/stripe` });
}, ADMIN);
route("POST", "/api/admin/workspaces/:id", async (req, res, { params }) => {
  const b = await readJson(req), w = await one("select * from workspaces where id=$1", [params.id]);
  if (!w) return fail(res, 404, "Not found");
  const pick = (k) => (b[k] !== undefined ? (String(b[k]).trim() || null) : w[k]);
  const trial = Number(b.extend_trial_days) > 0 ? new Date(Math.max(Date.now(), new Date(w.trial_ends_at).getTime()) + Number(b.extend_trial_days) * 864e5) : w.trial_ends_at;
  await q("update workspaces set arrowsterr_brand=$2, capybaroar_brand_id=$3, plan=$4, status=$5, trial_ends_at=$6, setup_note=$7 where id=$1",
    [w.id, pick("arrowsterr_brand"), pick("capybaroar_brand_id"), pick("plan") || w.plan, pick("status") || w.status, trial, b.setup_note !== undefined ? String(b.setup_note).slice(0, 300) : w.setup_note]);
  send(res, 200, { ok: true });
}, ADMIN);
route("GET", "/api/admin/backup", async (req, res) => send(res, 200, { status: await backupStatus() }), ADMIN);
route("POST", "/api/admin/backup", async (req, res) => send(res, 200, { status: await runBackup() }), ADMIN);
route("POST", "/api/admin/plans", async (req, res) => {
  const b = await readJson(req);
  for (const p of Array.isArray(b.plans) ? b.plans : []) {
    await q("update plans set name=$2, price_label=$3, stripe_price_id=$4, ai_budget_usd=$5, active=$6 where key=$1",
      [p.key, String(p.name || p.key).slice(0, 60), String(p.price_label || "").slice(0, 60), String(p.stripe_price_id || "").trim() || null, Math.max(0, Number(p.ai_budget_usd) || 0), p.active !== false]);
  }
  send(res, 200, { ok: true });
}, ADMIN);
route("POST", "/api/admin/apps/:tool", async (req, res, { params }) => {
  const app = APPS[params.tool];
  if (!app) return fail(res, 404, "Unknown app");
  const b = await readJson(req), prev = await getConn(params.tool);
  let key = b.key ? String(b.key).trim() : prev?.key;
  const url = app.kind === "mcp" ? String(b.url ?? prev?.url ?? app.url ?? "").trim() : null;
  if (app.kind === "mcp" && url && !(PROD ? /^https:\/\/\S+$/ : /^https?:\/\/\S+$/).test(url)) return fail(res, 400, "The address must start with https://");
  if (!key) return fail(res, 400, "Paste the key.");
  let status = "ok", error = null, count = 0;
  try {
    if (app.kind === "key") {
      const r = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/models?limit=1`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status === 401 ? "Claude rejected this key." : `Claude answered ${r.status}.`);
    } else if (app.kind === "stripe") {
      await billing.stripe("balance", null, key);
      if (b.webhook_secret) await setSetting("stripe_webhook_secret", encrypt(String(b.webhook_secret).trim()));
    } else if (app.kind === "r2") {
      const prevR2 = (() => { try { return JSON.parse(prev?.key || "{}"); } catch { return {}; } })();
      const creds = { id: b.key ? String(b.key).trim() : prevR2.id, secret: b.secret2 ? String(b.secret2).trim() : prevR2.secret };
      if (!creds.id || !creds.secret) throw new Error("Paste both the Access Key ID and the Secret Access Key.");
      if (!process.env.R2_ENDPOINT) throw new Error("The server has no R2 address yet.");
      await r2Put({ ...creds, endpoint: process.env.R2_ENDPOINT, bucket: process.env.R2_BUCKET || "morningtelos-backups" }, "healthcheck/ping.txt", Buffer.from(new Date().toISOString()));
      b.key = JSON.stringify(creds);
    } else {
      if (!url) throw new Error("Paste the MCP address.");
      mcp.forget(url); await mcp.initialize(url, key);
      count = (await mcp.listTools(url, key, { fresh: true })).length;
    }
  } catch (e) { status = "error"; error = e.message.slice(0, 300); }
  if (app.kind === "r2" && b.key && b.key.startsWith("{")) key = b.key;
  await q(`insert into connections(tool,url,secret_enc,status,tool_count,error,updated_at) values($1,$2,$3,$4,$5,$6,now())
    on conflict(tool) do update set url=excluded.url, secret_enc=excluded.secret_enc, status=excluded.status, tool_count=excluded.tool_count, error=excluded.error, updated_at=now()`,
    [params.tool, url, encrypt(key), status, count, error]);
  send(res, 200, { status, error, toolCount: count });
}, ADMIN);
route("DELETE", "/api/admin/apps/:tool", async (req, res, { params }) => {
  const c = await getConn(params.tool);
  if (c?.url) mcp.forget(c.url);
  await q("delete from connections where tool=$1", [params.tool]);
  send(res, 200, { ok: true });
}, ADMIN);

// ---------- routines scheduler ----------
async function runRoutine(ws, r) {
  const threadId = (await one("insert into threads(workspace_id,title,routine_id) values($1,$2,$3) returning id", [ws.id, `Routine: ${r.title}`, r.id])).id;
  await q("insert into messages(thread_id,role,content,meta) values($1,'user',$2,'{\"routine\":true}')", [threadId, r.instruction]);
  await q("update routines set last_run_at=now() where id=$1", [r.id]);
  await log(ws.id, r.agent, `started the routine "${r.title}"`, threadId);
  runTurn({ ws, threadId, text: r.instruction, forced: r.agent, model: "auto", emit: () => {} }).catch((e) => console.error("routine", e));
  return threadId;
}
let lastBackupDay = null;
async function tick() {
  const now = new Date(), day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === 3 && now.getUTCMinutes() >= 15 && lastBackupDay !== day) {
    lastBackupDay = day;
    const st = await backupStatus().catch(() => null);
    if (!st || Date.now() - new Date(st.at).getTime() > 20 * 3600 * 1000) runBackup().catch((e) => console.error("backup", e));
  }
  try {
    const due = await all("select r.*, w.timezone from routines r join workspaces w on w.id=r.workspace_id where r.enabled and (r.last_run_at is null or r.last_run_at < now() - interval '5 minutes')");
    for (const r of due) {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: r.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      if (r.at_time === `${p.hour}:${p.minute}` && r.days.includes(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday))) {
        await runRoutine(await one("select * from workspaces where id=$1", [r.workspace_id]), r);
      }
    }
  } catch (e) { console.error("tick", e); }
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  try {
    if (p.startsWith("/api/") || p.startsWith("/hooks/")) {
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) return fail(res, 404, "Not found");
      if (req.method !== "GET" && !r.hook && req.headers["x-mt"] !== "1") return fail(res, 403, "Blocked");
      const { user, ws } = r.hook ? {} : await auth(req);
      if (!r.open && !user) return fail(res, 401, "Log in first.");
      if (r.admin && !user.is_admin) return fail(res, 404, "Not found");
      return await r.handler(req, res, { user, ws, params: r.re.exec(p).groups || {} });
    }
    if (p === "/healthz") { try { await q("select 1"); return send(res, 200, "ok"); } catch { return send(res, 503, "database down"); } }
    if (p.startsWith("/img/")) { const f = safeJoin(IMGDIR, p.slice(5)); return f ? serveFile(res, f, "public, max-age=86400") : send(res, 404, "Not found"); }
    const f = p === "/" ? null : safeJoin(PUBLIC, p.slice(1));
    if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return serveFile(res, f);
    return serveFile(res, path.join(PUBLIC, "index.html"));
  } catch (e) {
    console.error(e);
    if (!e.status) noteFailure("server", "The app is returning server errors", `${req.method} ${p}: ${String(e.message).slice(0, 300)}`, 5, 10 * 60 * 1000);
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : "Server error"); else res.end();
  }
});

await migrate();
await q("delete from sessions where expires_at < now()");
await q("update approvals set status='failed', result='Stopped by a server restart. Check before trying again.' where status='running'");
await q("update workspaces set hook_token=md5(random()::text || id::text) where hook_token is null");
server.requestTimeout = 0;
server.listen(PORT, () => console.log(`Morning Telos app on :${PORT}`));
setInterval(tick, 60 * 1000);
process.on("SIGTERM", () => { server.close(); pool.end().finally(() => process.exit(0)); });
