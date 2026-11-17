// The AI team: roster, tool access, and the agent loop.
import Anthropic from "@anthropic-ai/sdk";
import { q, one, all, getSetting, log } from "./db.js";
import { decrypt, clip } from "./util.js";
import * as mcp from "./mcp.js";

// ---------- apps an agent can use ----------
export const APPS = {
  anthropic: { name: "Claude", kind: "key", help: "API key from console.anthropic.com → API keys. Starts with sk-ant-." },
  arrowsterr: { name: "Arrowsterr", kind: "mcp", url: "https://app.arrowsterr.com/api/mcp", help: "Arrowsterr → Settings → Workspace → Slack, API and MCP. Key starts with aw_live_." },
  capybaroar: { name: "Capybaroar", kind: "mcp", url: "", help: "Paste Capybaroar's MCP address and an API key from your Capybaroar workspace." },
  claritia: { name: "Claritia", kind: "mcp", url: "", help: "Paste Claritia's MCP address and an API key from your Claritia workspace." },
  omniscient: { name: "Omniscient", kind: "mcp", url: "", help: "Paste Omniscient's MCP address and an API key." },
  magpiereply: { name: "MagpieReply", kind: "mcp", url: "", help: "Paste MagpieReply's MCP address and an API key." },
};

// ---------- the team ----------
export const AGENTS = {
  chief: { god: "Athena", name: "Chief of Staff", apps: ["*"], readOnly: true,
    job: "Runs the owner's day. Answers questions about the business using every connected app, briefs the owner, and hands work to the right teammate.",
    out: ["Briefings with real numbers", "Hands tasks to the right teammate", "Weekly report written for you"] },
  sales: { god: "Hermes", name: "Sales Rep", apps: ["omniscient", "claritia"],
    job: "Replies to new leads fast, books the call or visit, and follows up every quote until it's a yes or no.",
    out: ["Replies to leads in seconds", "Every quote followed up", "CRM always up to date"] },
  support: { god: "Hestia", name: "Customer Support", apps: ["magpiereply"],
    job: "Answers customers on every channel from the business's own knowledge, and hands the hard ones to a person.",
    out: ["Answers on every channel 24/7", "Escalates the hard ones", "Turns repeat questions into help articles"] },
  forms: { god: "Hora", name: "Forms + Scheduling", apps: ["claritia"],
    job: "Builds forms and booking pages in Claritia, routes every lead and keeps the calendar full.",
    out: ["Forms built from one sentence", "Booking links and reminders", "Every submission routed"] },
  email: { god: "Iris", name: "Email Marketing", apps: ["claritia"],
    job: "Plans and writes email campaigns, welcome flows and win-backs, and sends them through Claritia.",
    out: ["Campaigns written in your voice", "Welcome and win-back flows", "Results explained"] },
  social: { god: "Aphrodite", name: "Social Media", apps: ["capybaroar"],
    job: "Plans, writes and schedules social posts in Capybaroar, and answers comments.",
    out: ["A full calendar every week", "Posts in your voice", "Comments answered"] },
  seo: { god: "Artemis", name: "SEO Specialist", apps: ["arrowsterr"],
    job: "Gets the business found on Google and in AI answers using Arrowsterr: keywords, content plan, rankings and AI visibility.",
    out: ["Weekly rankings and AI visibility", "Content plan built for you", "Knows what to write next"] },
  web: { god: "Hephaestus", name: "Website Builder", apps: ["arrowsterr"],
    job: "Plans and writes website pages that people search for, with forms and booking built in.",
    out: ["New pages from a message", "Copy that targets real searches", "Forms on every page"] },
};
export const ORDER = ["chief", "sales", "support", "forms", "email", "social", "seo", "web"];
const BY_GOD = Object.fromEntries(ORDER.map((k) => [AGENTS[k].god.toLowerCase(), k]));

export const MODELS = {
  auto: "claude-opus-5-5",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};
const PRICE = { // $ per 1M tokens: input, output, cache read
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};
export function costOf(u) {
  const p = PRICE[u.model] || PRICE["claude-opus-5-5"];
  return (u.input_tokens * p[0] + u.output_tokens * p[1] + u.cache_read * p[2] + u.cache_write * p[0] * 1.25) / 1e6;
}

// ---------- connections ----------
export async function getConn(tool) {
  const c = await one("select * from connections where tool=$1", [tool]);
  if (!c) return null;
  return { ...c, key: decrypt(c.secret_enc) };
}

async function agentApps(agentKey) {
  const a = AGENTS[agentKey];
  const want = a.apps.includes("*") ? Object.keys(APPS).filter((t) => APPS[t].kind === "mcp") : a.apps;
  const out = [];
  for (const t of want) {
    const c = await getConn(t);
    if (c && c.url && c.status === "ok") out.push({ tool: t, url: c.url, key: c.key });
  }
  return out;
}

// A tool changes something if the server says so, or if its name starts with a write verb.
const WRITE_VERBS = new Set(["create", "add", "update", "delete", "remove", "publish", "schedule", "send", "set", "upload", "cancel", "post", "enroll", "import", "archive", "move", "book", "invite", "merge", "replace", "reply", "approve", "test", "edit", "write", "submit", "unsubscribe", "pause", "resume", "duplicate", "connect", "disconnect", "save", "start", "stop", "trigger", "fire", "run"]);
export function isWrite(tool) {
  const ann = tool.annotations || {};
  if (ann.readOnlyHint === true) return false;
  if (ann.destructiveHint === true) return true;
  const verb = String(tool.name).split(/[_\-.\s]/)[0].toLowerCase();
  return WRITE_VERBS.has(verb);
}
const toolName = (server, name) => `${server}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

async function buildTools(agentKey) {
  const a = AGENTS[agentKey];
  const tools = [];
  const map = new Map(); // anthropic name -> {server, url, key, name, write}
  const missing = [];
  for (const app of await agentApps(agentKey)) {
    let list = [];
    try {
      list = await mcp.listTools(app.url, app.key);
    } catch (e) {
      missing.push(`${APPS[app.tool].name} (could not load tools: ${e.message.slice(0, 120)})`);
      continue;
    }
    for (const t of list) {
      const write = isWrite(t);
      if (write && a.readOnly) continue;
      const n = toolName(app.tool, t.name);
      if (map.has(n)) continue;
      map.set(n, { server: app.tool, url: app.url, key: app.key, name: t.name, write, title: t.title || t.name });
      tools.push({
        name: n,
        description: `[${APPS[app.tool].name}${write ? " · needs owner approval" : ""}] ${(t.description || t.title || t.name).slice(0, 1000)}`,
        input_schema: t.inputSchema && t.inputSchema.type === "object" ? t.inputSchema : { type: "object", properties: {} },
      });
    }
  }
  const connected = new Set([...map.values()].map((v) => v.server));
  const wanted = a.apps.includes("*") ? [] : a.apps;
  for (const t of wanted) if (!connected.has(t) && !missing.some((m) => m.startsWith(APPS[t].name))) missing.push(`${APPS[t].name} (not connected yet)`);
  // Sort for a stable prompt cache.
  tools.sort((x, y) => x.name.localeCompare(y.name));
  tools.push({
    name: "handoff",
    description: "Hand the next part of the job to a teammate. Use when the work belongs to another role. The teammate runs right after you finish this reply.",
    input_schema: {
      type: "object",
      properties: {
        teammate: { type: "string", enum: ORDER.filter((k) => k !== agentKey).map((k) => AGENTS[k].god) },
        note: { type: "string", description: "What they should do, with the details they need." },
      },
      required: ["teammate", "note"],
    },
  });
  return { tools, map, missing };
}

async function systemPrompt(agentKey, missing) {
  const a = AGENTS[agentKey];
  const business = (await getSetting("business_name")) || "Morning Telos";
  const docs = await all("select title, body, scope, agent from knowledge where agent is null or agent=$1 order by id", [agentKey]);
  const team = ORDER.filter((k) => k !== agentKey).map((k) => `- ${AGENTS[k].god}: ${AGENTS[k].name}. ${AGENTS[k].job}`).join("\n");
  const know = docs.length
    ? docs.map((d) => `<doc title="${d.title.replace(/"/g, "'")}"${d.agent ? ` for="${AGENTS[d.agent]?.god || d.agent}"` : ""}>\n${d.body}\n</doc>`).join("\n")
    : "(No knowledge added yet. Ask the owner for details you need, and suggest they add them in Knowledge.)";
  return `You are ${a.god}, the ${a.name} on the AI team of ${business}. ${a.job}

Your teammates:
${team}

How you work:
- You act through your tools. Tools that only read run right away. Tools that change something (create, schedule, publish, send, delete) are held for the owner's approval: calling one saves it as a draft for approval instead of running it. Give complete, final inputs so the owner can approve in one click. Never call the same change twice.
- After a change is saved for approval, tell the owner in one or two lines what you prepared.
- If part of the job belongs to a teammate, call handoff with their name and a clear note.
- Use real numbers from tools. Never invent data, prices, results or quotes. If you don't know, say so.
- ${missing.length ? `Not available to you right now: ${missing.join("; ")}. If the job needs one of these, say so plainly and tell the owner to connect it in Apps.` : "All your apps are connected."}
- Write in plain English, 9th grade level, short sentences. No em dashes. Keep replies short and skimmable.

What you know about ${business}:
<knowledge>
${know}
</knowledge>`;
}

function historyFor(rows) {
  const msgs = [];
  for (const m of rows) {
    if (!m.content?.trim()) continue;
    if (m.role === "user") msgs.push({ role: "user", content: m.content });
    else if (m.role === "agent") msgs.push({ role: "assistant", content: `${AGENTS[m.agent]?.god || "Teammate"}: ${m.content}` });
    else if (m.role === "note") msgs.push({ role: "user", content: m.content });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs.slice(-30);
}

export function parseMentions(text) {
  const out = [];
  for (const m of String(text).matchAll(/@(\w+)/g)) {
    const k = BY_GOD[m[1].toLowerCase()];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

// ---------- the loop ----------
async function runAgent({ threadId, agentKey, model, emit, client }) {
  const st = await one("select enabled, trust from agent_settings where agent=$1", [agentKey]);
  if (st && st.enabled === false) {
    const msg = `${AGENTS[agentKey].god} is paused. Turn them back on in Team to use them.`;
    await q("insert into messages(thread_id,role,agent,content) values($1,'agent',$2,$3)", [threadId, agentKey, msg]);
    emit({ type: "message", agent: agentKey, text: msg });
    return [];
  }
  const autopilot = (st?.trust || 0) >= 2;
  const { tools, map, missing } = await buildTools(agentKey);
  const system = [{ type: "text", text: await systemPrompt(agentKey, missing), cache_control: { type: "ephemeral" } }];
  const rows = await all("select role, agent, content from messages where thread_id=$1 order by id", [threadId]);
  const messages = historyFor(rows);
  const modelId = MODELS[model] || MODELS.auto;
  const handoffs = [];
  let finalText = "";

  for (let step = 0; step < 12; step++) {
    emit({ type: "status", agent: agentKey, text: step === 0 ? "Thinking" : "Working" });
    const params = {
      model: modelId,
      max_tokens: 16000,
      system,
      tools,
      messages,
      output_config: { effort: "medium" },
    };
    if (modelId !== MODELS.haiku) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const res = await client.beta.messages.create(params);
    const u = res.usage || {};
    await q("insert into usage(agent,model,input_tokens,output_tokens,cache_read,cache_write) values($1,$2,$3,$4,$5,$6)",
      [agentKey, modelId, u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0]);

    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) finalText = text;
    if (res.stop_reason === "refusal") { finalText = finalText || "I can't help with that request."; break; }
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) break;
    if (res.stop_reason === "max_tokens") { finalText = finalText || "That got too long. Try a smaller request."; break; }

    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(uses.map(async (tu) => {
      if (tu.name === "handoff") {
        const k = BY_GOD[String(tu.input?.teammate || "").toLowerCase()];
        if (!k) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Unknown teammate." };
        handoffs.push({ agent: k, note: String(tu.input?.note || "") });
        return { type: "tool_result", tool_use_id: tu.id, content: `${AGENTS[k].god} will take it from here after your reply.` };
      }
      const t = map.get(tu.name);
      if (!t) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "That tool isn't available." };
      if (t.write && autopilot) {
        emit({ type: "tool", agent: agentKey, text: `${APPS[t.server].name}: ${t.title.replace(/_/g, " ")} (autopilot)` });
        try {
          const r = await mcp.callTool(t.url, t.key, t.name, tu.input || {});
          await log(agentKey, `ran "${t.title.replace(/_/g, " ")}" in ${APPS[t.server].name} on autopilot`, threadId);
          return { type: "tool_result", tool_use_id: tu.id, is_error: r.isError, content: clip(r.text || "(done)") };
        } catch (e) {
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Tool failed: ${e.message.slice(0, 300)}` };
        }
      }
      if (t.write) {
        const nice = t.title.replace(/_/g, " "); const title = `${nice[0].toUpperCase()}${nice.slice(1)} in ${APPS[t.server].name}`;
        const ap = await one("insert into approvals(thread_id,agent,server,tool,input,title,why) values($1,$2,$3,$4,$5,$6,$7) returning id",
          [threadId, agentKey, t.server, t.name, JSON.stringify(tu.input || {}), title, "This changes something in " + APPS[t.server].name + "."]);
        emit({ type: "approval", agent: agentKey, id: ap.id, title });
        await log(agentKey, `prepared "${title}" for your approval`, threadId);
        return { type: "tool_result", tool_use_id: tu.id, content: `Saved for the owner's approval as #${ap.id}. It has not run yet. Do not call it again.` };
      }
      emit({ type: "tool", agent: agentKey, text: `${APPS[t.server].name}: ${t.title.replace(/_/g, " ")}` });
      try {
        const r = await mcp.callTool(t.url, t.key, t.name, tu.input || {});
        return { type: "tool_result", tool_use_id: tu.id, is_error: r.isError, content: clip(r.text || "(empty)") };
      } catch (e) {
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Tool failed: ${e.message.slice(0, 300)}` };
      }
    }));
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Done.";
  const m = await one("insert into messages(thread_id,role,agent,content) values($1,'agent',$2,$3) returning id, created_at", [threadId, agentKey, finalText]);
  emit({ type: "message", agent: agentKey, id: m.id, text: finalText });
  return handoffs;
}

// Runs one user turn: picks agents (mentions, a forced agent, or Athena), follows handoffs.
export async function runTurn({ threadId, text, forced, model, emit }) {
  const ak = await getConn("anthropic");
  if (!ak?.key) {
    const msg = "Your team needs a Claude API key before it can work. Add it in Apps → Claude.";
    await q("insert into messages(thread_id,role,agent,content) values($1,'agent','chief',$2)", [threadId, msg]);
    emit({ type: "message", agent: "chief", text: msg });
    return;
  }
  const client = new Anthropic({ apiKey: ak.key, maxRetries: 2, timeout: 10 * 60 * 1000 });
  const mentioned = parseMentions(text);
  const queue = forced ? [forced, ...mentioned.filter((k) => k !== forced)] : mentioned.length ? mentioned : ["chief"];
  const seen = new Set();
  let runs = 0;
  while (queue.length && runs < 4) {
    const k = queue.shift();
    if (seen.has(k)) continue;
    seen.add(k);
    runs++;
    try {
      const hs = await runAgent({ threadId, agentKey: k, model, emit, client });
      for (const h of hs) {
        if (seen.has(h.agent)) continue;
        await q("insert into messages(thread_id,role,agent,content,meta) values($1,'note',$2,$3,$4)",
          [threadId, k, `${AGENTS[k].god} handed this to ${AGENTS[h.agent].god}: ${h.note}`, JSON.stringify({ to: h.agent })]);
        emit({ type: "handoff", from: k, to: h.agent, note: h.note });
        queue.push(h.agent);
      }
    } catch (e) {
      let msg = "Something went wrong. Try again in a moment.";
      if (e instanceof Anthropic.AuthenticationError) msg = "Your Claude API key was rejected. Update it in Apps → Claude.";
      else if (e instanceof Anthropic.RateLimitError) msg = "Claude is busy right now (rate limit). Try again in a minute.";
      else if (e instanceof Anthropic.APIError) msg = `Claude returned an error (${e.status}). Try again in a moment.`;
      console.error("agent error", k, e);
      await q("insert into messages(thread_id,role,agent,content,meta) values($1,'agent',$2,$3,'{\"error\":true}')", [threadId, k, msg]);
      emit({ type: "message", agent: k, text: msg, error: true });
    }
  }
  await q("update threads set updated_at=now() where id=$1", [threadId]);
}

// Runs an approved change.
export async function executeApproval(ap, input) {
  const c = await getConn(ap.server);
  if (!c?.url || c.status !== "ok") throw new Error(`${APPS[ap.server].name} isn't connected.`);
  const r = await mcp.callTool(c.url, c.key, ap.tool, input);
  return r;
}
