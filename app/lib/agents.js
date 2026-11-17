// The AI team: roster, the tool gateway (keeps each customer inside their own brand), and the agent loop.
import Anthropic from "@anthropic-ai/sdk";
import { q, one, all, log } from "./db.js";
import { decrypt, clip } from "./util.js";
import * as mcp from "./mcp.js";

// ---------- platform apps (Morning Telos's own accounts) ----------
export const APPS = {
  anthropic: { name: "Claude", kind: "key", help: "Morning Telos's Claude API key (console.anthropic.com). Pays for every workspace's AI." },
  arrowsterr: { name: "Arrowsterr", kind: "mcp", url: "https://app.arrowsterr.com/api/mcp", help: "Morning Telos's Arrowsterr workspace key (Settings → Workspace → Slack, API and MCP)." },
  capybaroar: { name: "Capybaroar", kind: "mcp", url: "", help: "Morning Telos's Capybaroar MCP address and key." },
  claritia: { name: "Claritia", kind: "mcp", url: "", help: "Morning Telos's Claritia MCP address and key (not wired to agents yet)." },
  stripe: { name: "Stripe", kind: "stripe", help: "Secret key (sk_live_ or sk_test_) and the webhook signing secret (whsec_)." },
};

// What each customer gets from each app, and where their brand id is stored on the workspace.
export const SERVICES = {
  arrowsterr: { label: "SEO and AI visibility", field: "arrowsterr_brand" },
  capybaroar: { label: "Social media", field: "capybaroar_brand_id" },
};

// ---------- the team ----------
export const AGENTS = {
  chief: { god: "Athena", name: "Chief of Staff", apps: ["*"], readOnly: true,
    job: "Runs the owner's day. Answers questions about the business using every connected service, and hands work to the right teammate.",
    out: ["Answers with real numbers", "Hands tasks to the right teammate", "Plans your week with you"] },
  sales: { god: "Hermes", name: "Sales Rep", apps: [], soon: true,
    job: "Replies to new leads fast, books the call and follows up every quote until it's a yes or no.",
    out: ["Replies to leads in seconds", "Every quote followed up", "CRM always up to date"] },
  support: { god: "Hestia", name: "Customer Support", apps: [], soon: true,
    job: "Answers customers on every channel from your knowledge, and hands the hard ones to a person.",
    out: ["Answers on every channel 24/7", "Escalates the hard ones", "Turns repeat questions into help articles"] },
  forms: { god: "Hora", name: "Forms + Scheduling", apps: [], soon: true,
    job: "Builds forms and booking pages, routes every lead and keeps your calendar full.",
    out: ["Forms built from one sentence", "Booking links and reminders", "Every submission routed"] },
  email: { god: "Iris", name: "Email Marketing", apps: [], soon: true,
    job: "Plans and writes email campaigns, welcome flows and win-backs.",
    out: ["Campaigns written in your voice", "Welcome and win-back flows", "Results explained"] },
  social: { god: "Aphrodite", name: "Social Media", apps: ["capybaroar"],
    job: "Plans, writes and schedules your social posts, and reports what works.",
    out: ["A full calendar every week", "Posts in your voice", "Results explained"] },
  seo: { god: "Artemis", name: "SEO Specialist", apps: ["arrowsterr"],
    job: "Gets you found on Google and in AI answers: keywords, content plan, rankings and AI visibility.",
    out: ["AI visibility tracked", "Content plan built for you", "Knows what to write next"] },
  web: { god: "Hephaestus", name: "Website Builder", apps: ["arrowsterr"],
    job: "Plans and writes website pages people search for, with clear calls to book.",
    out: ["New pages from a message", "Copy that targets real searches", "Clear calls to book"] },
};
export const ORDER = ["chief", "sales", "support", "forms", "email", "social", "seo", "web"];
const BY_GOD = Object.fromEntries(ORDER.map((k) => [AGENTS[k].god.toLowerCase(), k]));

export const MODELS = { auto: "claude-opus-5-5", opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
const PRICE = { "claude-opus-5-5": [4, 20, 0.2], "claude-sonnet-5-5": [2, 10, 0.1], "claude-haiku-5-5": [0.1, 0.5, 0.01] };
export function costOf(u) {
  const p = PRICE[u.model] || PRICE["claude-opus-5-5"];
  return (u.input_tokens * p[0] + u.output_tokens * p[1] + u.cache_read * p[2] + u.cache_write * p[0] * 1.25) / 1e6;
}
export async function spendSince(wsId, since) {
  const rows = await all("select model, sum(input_tokens)::int input_tokens, sum(output_tokens)::int output_tokens, sum(cache_read)::int cache_read, sum(cache_write)::int cache_write from usage where workspace_id=$1 and created_at >= $2 group by model", [wsId, since]);
  return rows.reduce((s, u) => s + costOf(u), 0);
}

export async function getConn(tool) {
  const c = await one("select * from connections where tool=$1", [tool]);
  return c ? { ...c, key: decrypt(c.secret_enc) } : null;
}

// ---------- the gateway ----------
function stripProps(schema, hide) {
  if (!hide?.length) return schema;
  const s = JSON.parse(JSON.stringify(schema));
  for (const h of hide) delete s.properties?.[h];
  if (Array.isArray(s.required)) s.required = s.required.filter((r) => !hide.includes(r));
  return s;
}
const channelCache = new Map(); // workspace id -> {ids:Set, at}
function collectIds(text) {
  const ids = new Set();
  try {
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (typeof v.id === "string" || typeof v.id === "number") ids.add(String(v.id)); Object.values(v).forEach(walk); } };
    walk(JSON.parse(text));
  } catch {
    for (const m of String(text).matchAll(/"id"\s*:\s*"?([\w-]+)"?/g)) ids.add(m[1]);
  }
  return ids;
}
async function allowedChannels(ws, conn) {
  const c = channelCache.get(ws.id);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.ids;
  const r = await mcp.callTool(conn.url, conn.key, "list_channels", { brand_id: ws.capybaroar_brand_id });
  const ids = r.isError ? new Set() : collectIds(r.text);
  ids.delete(String(ws.capybaroar_brand_id));
  channelCache.set(ws.id, { ids, at: Date.now() });
  return ids;
}
const deny = (msg) => { throw Object.assign(new Error(msg), { gateway: true }); };
// For each app: which tools a customer may use, what we hide from the model, and how each call is locked to their brand.
// Tools not listed here stay hidden, because they could read across every brand in Morning Telos's account.
const SCOPE = {
  arrowsterr: (t) => {
    if (t.name === "list_brands") return null;
    if (t.inputSchema?.properties?.brand) return { hide: ["brand"], prep: async (input, ws) => ({ ...input, brand: ws.arrowsterr_brand }) };
    if (t.name === "keyword_research") return { hide: [], prep: async (input) => input };
    return null;
  },
  capybaroar: (t) => {
    switch (t.name) {
      case "list_channels": case "list_posts": return { hide: ["brand_id"], prep: async (input, ws) => ({ ...input, brand_id: ws.capybaroar_brand_id }) };
      case "upload_media": return { hide: [], prep: async (input) => input };
      case "get_analytics": return { hide: [], prep: async (input, ws, conn) => {
        const ok = await allowedChannels(ws, conn);
        if (!input.channel_id || !ok.has(String(input.channel_id))) deny("Pass one of this business's channel ids (call list_channels first).");
        return input;
      } };
      case "create_posts": return { hide: [], prep: async (input, ws, conn) => {
        const ok = await allowedChannels(ws, conn);
        const posts = (input.posts || []).map((p) => {
          if (!Array.isArray(p.channel_ids) || !p.channel_ids.length || !p.channel_ids.every((c) => ok.has(String(c)))) deny("Every post must use this business's own channel ids from list_channels.");
          if (p.mode === "queue") deny("Use draft or schedule with a publish_at time instead of the queue.");
          return { ...p, campaign_id: null };
        });
        return { ...input, posts };
      } };
      default: return null;
    }
  },
};

const WRITE_VERBS = new Set(["create", "add", "update", "delete", "remove", "publish", "schedule", "send", "set", "upload", "cancel", "post", "enroll", "import", "archive", "move", "book", "invite", "merge", "replace", "reply", "approve", "test", "edit", "write", "submit", "unsubscribe", "pause", "resume", "duplicate", "connect", "disconnect", "save", "start", "stop", "trigger", "fire", "run"]);
export function isWrite(tool) {
  const ann = tool.annotations || {};
  if (ann.readOnlyHint === true) return false;
  if (ann.destructiveHint === true) return true;
  return WRITE_VERBS.has(String(tool.name).split(/[_\-.\s]/)[0].toLowerCase());
}

async function buildTools(ws, agentKey) {
  const a = AGENTS[agentKey];
  const want = a.apps.includes("*") ? Object.keys(SERVICES) : a.apps;
  const tools = [], map = new Map(), missing = [];
  for (const server of want) {
    const svc = SERVICES[server];
    if (!ws[svc.field]) { missing.push(`${svc.label} (Morning Telos is still setting this up for the business)`); continue; }
    const conn = await getConn(server);
    if (!conn?.url || conn.status !== "ok") { missing.push(`${svc.label} (temporarily unavailable)`); continue; }
    let list;
    try { list = await mcp.listTools(conn.url, conn.key); } catch { missing.push(`${svc.label} (temporarily unavailable)`); continue; }
    for (const t of list) {
      const scope = SCOPE[server]?.(t);
      if (!scope) continue;
      const write = isWrite(t);
      if (write && a.readOnly) continue;
      const n = `${server}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      map.set(n, { server, conn, name: t.name, write, title: t.title || t.name, scope });
      const schema = t.inputSchema && t.inputSchema.type === "object" ? stripProps(t.inputSchema, scope.hide) : { type: "object", properties: {} };
      tools.push({ name: n, description: `[${svc.label}${write ? " · needs owner approval" : ""}] ${(t.description || t.title || t.name).slice(0, 1000)}`, input_schema: schema });
    }
  }
  tools.sort((x, y) => x.name.localeCompare(y.name));
  tools.push({
    name: "handoff",
    description: "Hand the next part of the job to a teammate. The teammate runs right after your reply.",
    input_schema: { type: "object", properties: {
      teammate: { type: "string", enum: ORDER.filter((k) => k !== agentKey && !AGENTS[k].soon).map((k) => AGENTS[k].god) },
      note: { type: "string", description: "What they should do, with the details they need." } }, required: ["teammate", "note"] },
  });
  return { tools, map, missing };
}

async function systemPrompt(ws, agentKey, missing) {
  const a = AGENTS[agentKey];
  const docs = await all("select title, body, agent from knowledge where workspace_id=$1 and (agent is null or agent=$2) order by id", [ws.id, agentKey]);
  const team = ORDER.filter((k) => k !== agentKey).map((k) => `- ${AGENTS[k].god}: ${AGENTS[k].name}.${AGENTS[k].soon ? " (Coming soon, can't take work yet.)" : ` ${AGENTS[k].job}`}`).join("\n");
  const know = docs.length
    ? docs.map((d) => `<doc title="${d.title.replace(/"/g, "'")}"${d.agent ? ` for="${AGENTS[d.agent]?.god || d.agent}"` : ""}>\n${d.body}\n</doc>`).join("\n")
    : "(Nothing added yet. Ask for the details you need, and suggest adding them in Knowledge.)";
  return `You are ${a.god}, the ${a.name} on the AI team of ${ws.name}${ws.website ? ` (${ws.website})` : ""}. ${a.job}
You work only for ${ws.name}. Your tools are already limited to this business's own data.

Your teammates:
${team}

How you work:
- Tools that only read run right away. Tools that change something (create, schedule, publish, send, delete) are saved for the owner's approval instead of running. Give complete, final inputs so the owner can approve in one click. Never call the same change twice.
- After a change is saved for approval, say in one or two lines what you prepared.
- If part of the job belongs to a teammate who can take work, call handoff with their name and a clear note.
- Use real numbers from tools. Never invent data, prices, results or quotes. If you don't know, say so.
- ${missing.length ? `Not available right now: ${missing.join("; ")}. If the job needs it, say so plainly.` : "All your services are ready."}
- Write in plain English at a 9th grade level. Short sentences. No em dashes. Keep replies short and easy to skim.

What you know about ${ws.name}:
<knowledge>
${know}
</knowledge>`;
}

function historyFor(rows) {
  const msgs = [];
  for (const m of rows) {
    if (!m.content?.trim()) continue;
    if (m.role === "user" || m.role === "note") msgs.push({ role: "user", content: m.content });
    else if (m.role === "agent") msgs.push({ role: "assistant", content: `${AGENTS[m.agent]?.god || "Teammate"}: ${m.content}` });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs.slice(-30);
}
export function parseMentions(text) {
  const out = [];
  for (const m of String(text).matchAll(/@(\w+)/g)) { const k = BY_GOD[m[1].toLowerCase()]; if (k && !out.includes(k)) out.push(k); }
  return out;
}

async function runAgent({ ws, threadId, agentKey, model, emit, client }) {
  const say = async (text) => {
    await q("insert into messages(thread_id,role,agent,content) values($1,'agent',$2,$3)", [threadId, agentKey, text]);
    emit({ type: "message", agent: agentKey, text });
  };
  if (AGENTS[agentKey].soon) { await say(`${AGENTS[agentKey].god} is coming soon. For now, ask Athena, Artemis, Aphrodite or Hephaestus.`); return []; }
  const pref = await one("select enabled, trust from agent_prefs where workspace_id=$1 and agent=$2", [ws.id, agentKey]);
  if (pref && pref.enabled === false) { await say(`${AGENTS[agentKey].god} is paused. Turn them back on in Team.`); return []; }
  const autopilot = (pref?.trust || 0) >= 2;
  const { tools, map, missing } = await buildTools(ws, agentKey);
  const system = [{ type: "text", text: await systemPrompt(ws, agentKey, missing), cache_control: { type: "ephemeral" } }];
  const messages = historyFor(await all("select role, agent, content from messages where thread_id=$1 order by id", [threadId]));
  const modelId = MODELS[model] || MODELS.auto;
  const handoffs = [];
  let finalText = "";

  for (let step = 0; step < 12; step++) {
    emit({ type: "status", agent: agentKey, text: step === 0 ? "Thinking" : "Working" });
    const params = { model: modelId, max_tokens: 16000, system, tools, messages, output_config: { effort: "medium" } };
    if (modelId !== MODELS.haiku) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
    const res = await client.beta.messages.create(params);
    const u = res.usage || {};
    await q("insert into usage(workspace_id,agent,model,input_tokens,output_tokens,cache_read,cache_write) values($1,$2,$3,$4,$5,$6,$7)",
      [ws.id, agentKey, res.model || modelId, u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0]);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) finalText = text;
    if (res.stop_reason === "refusal") { finalText = finalText || "I can't help with that request."; break; }
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) break;
    if (res.stop_reason === "max_tokens") { finalText = finalText || "That got too long. Try a smaller request."; break; }
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(uses.map(async (tu) => {
      const R = (content, is_error = false) => ({ type: "tool_result", tool_use_id: tu.id, content, is_error });
      if (tu.name === "handoff") {
        const k = BY_GOD[String(tu.input?.teammate || "").toLowerCase()];
        if (!k || AGENTS[k].soon) return R("That teammate can't take work yet.", true);
        handoffs.push({ agent: k, note: String(tu.input?.note || "") });
        return R(`${AGENTS[k].god} will take it from here after your reply.`);
      }
      const t = map.get(tu.name);
      if (!t) return R("That tool isn't available.", true);
      const label = `${SERVICES[t.server].label}: ${t.title.replace(/_/g, " ")}`;
      try {
        if (t.write && !autopilot) {
          await t.scope.prep(tu.input || {}, ws, t.conn); // reject it now if it reaches outside this business
          const nice = t.title.replace(/_/g, " "), title = `${nice[0].toUpperCase()}${nice.slice(1)} (${SERVICES[t.server].label})`;
          const ap = await one("insert into approvals(workspace_id,thread_id,agent,server,tool,input,title,why) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
            [ws.id, threadId, agentKey, t.server, t.name, JSON.stringify(tu.input || {}), title, `This changes something in your ${SERVICES[t.server].label.toLowerCase()}.`]);
          emit({ type: "approval", agent: agentKey, id: ap.id, title });
          await log(ws.id, agentKey, `prepared "${title}" for your approval`, threadId);
          return R(`Saved for the owner's approval as #${ap.id}. It has not run yet. Do not call it again.`);
        }
        emit({ type: "tool", agent: agentKey, text: label + (t.write ? " (autopilot)" : "") });
        const r = await mcp.callTool(t.conn.url, t.conn.key, t.name, await t.scope.prep(tu.input || {}, ws, t.conn));
        if (t.write) await log(ws.id, agentKey, `ran "${t.title.replace(/_/g, " ")}" on autopilot`, threadId);
        return R(clip(r.text || "(empty)"), r.isError);
      } catch (e) {
        return R(e.gateway ? e.message : `Tool failed: ${e.message.slice(0, 300)}`, true);
      }
    }));
    messages.push({ role: "user", content: results });
  }
  await say(finalText || "Done.");
  return handoffs;
}

// Returns a reason the workspace can't run agents right now, or null.
export async function canRun(ws) {
  if (ws.plan === "internal") return null;
  if (["canceled", "past_due", "unpaid", "incomplete_expired"].includes(ws.status)) return "Your plan isn't active. Update it in Billing to keep your team working.";
  if (ws.plan === "trial" && new Date(ws.trial_ends_at) < new Date()) return "Your free trial has ended. Pick a plan in Billing to keep your team working.";
  const plan = await one("select ai_budget_usd from plans where key=$1", [ws.plan]);
  const since = ws.plan === "trial" ? ws.created_at : ws.period_start;
  if ((await spendSince(ws.id, since)) >= Number(plan?.ai_budget_usd ?? 10)) return "Your team has used this period's AI allowance. Upgrade in Billing for more.";
  return null;
}

export async function runTurn({ ws, threadId, text, forced, model, emit }) {
  const stop = async (msg) => {
    await q("insert into messages(thread_id,role,agent,content) values($1,'agent','chief',$2)", [threadId, msg]);
    emit({ type: "message", agent: "chief", text: msg });
  };
  const blocked = await canRun(ws);
  if (blocked) return stop(blocked);
  const ak = await getConn("anthropic");
  if (!ak?.key) return stop("Your AI team is starting up. Please try again in a few minutes.");
  const client = new Anthropic({ apiKey: ak.key, maxRetries: 2, timeout: 10 * 60 * 1000 });
  const mentioned = parseMentions(text);
  const queue = forced ? [forced, ...mentioned.filter((k) => k !== forced)] : mentioned.length ? mentioned : ["chief"];
  const seen = new Set();
  let runs = 0;
  while (queue.length && runs < 4) {
    const k = queue.shift();
    if (seen.has(k)) continue;
    seen.add(k); runs++;
    try {
      const hs = await runAgent({ ws, threadId, agentKey: k, model, emit, client });
      for (const h of hs) {
        if (seen.has(h.agent)) continue;
        await q("insert into messages(thread_id,role,agent,content,meta) values($1,'note',$2,$3,$4)", [threadId, k, `${AGENTS[k].god} handed this to ${AGENTS[h.agent].god}: ${h.note}`, JSON.stringify({ to: h.agent })]);
        emit({ type: "handoff", from: k, to: h.agent, note: h.note });
        queue.push(h.agent);
      }
    } catch (e) {
      const msg = e instanceof Anthropic.RateLimitError ? "The AI is busy right now. Try again in a minute." : "Something went wrong. Try again in a moment.";
      console.error("agent error", ws.id, k, e?.status || "", e?.message || e);
      await q("insert into messages(thread_id,role,agent,content,meta) values($1,'agent',$2,$3,'{\"error\":true}')", [threadId, k, msg]);
      emit({ type: "message", agent: k, text: msg, error: true });
    }
  }
  await q("update threads set updated_at=now() where id=$1", [threadId]);
}

// Runs an approved change, through the same brand checks.
export async function executeApproval(ws, ap, input) {
  const svc = SERVICES[ap.server];
  if (!svc || !ws[svc.field]) throw new Error("This service isn't set up for your business yet.");
  const conn = await getConn(ap.server);
  if (!conn?.url || conn.status !== "ok") throw new Error("This service is temporarily unavailable.");
  const t = (await mcp.listTools(conn.url, conn.key)).find((x) => x.name === ap.tool);
  const scope = t && SCOPE[ap.server]?.(t);
  if (!scope) throw new Error("This action isn't allowed.");
  return mcp.callTool(conn.url, conn.key, ap.tool, await scope.prep(input || {}, ws, conn));
}
