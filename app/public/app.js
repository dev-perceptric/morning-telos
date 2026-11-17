"use strict";
/* Morning Telos app (chat.morningtelos.com). Talks to the API in server.js. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isMobile = () => matchMedia("(max-width:900px)").matches;
const S = { me: null, ws: null, agents: [], services: {}, threads: [], pending: [], blocked: null, model: "auto" };
const AG = {};
const IMG = (k) => `/img/agents/${k}-f.webp`, FULL = (k) => `/img/agents/${k}.webp`;
const APPC = { arrowsterr: ["A", "#d9a441"], capybaroar: ["C", "#c084a7"], claritia: ["C", "#d97757"], anthropic: ["✳", "#141413"], stripe: ["S", "#635bff"] };
const SVC_ICON = { arrowsterr: ["SEO", "#d9a441"], capybaroar: ["Soc", "#c084a7"] };

// ---------- basics ----------
function toast(t) { const el = $("#toast"); el.innerHTML = `<span>${esc(t)}</span>`; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3800); }
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-mt": "1" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/signup")) { showAuth("login"); throw new Error("Log in first."); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function md(text) {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = []; let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.t}>`); list = null; } };
  let para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
  for (const raw of esc(text).split("\n")) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(m[1]); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(m[1]); }
    else if ((m = l.match(/^#{1,4}\s+(.*)/))) { flushP(); flush(); out.push(`<h4>${inline(m[1])}</h4>`); }
    else if (!l.trim()) { flushP(); flush(); }
    else { flush(); para.push(l); }
  }
  flushP(); flush();
  return `<div class="md">${out.join("")}</div>`;
}
const emptyHTML = (t, s) => `<div class="empty"><b>${t}</b>${s}</div>`;
document.addEventListener("click", (e) => { const t = e.target.closest("[data-toast]"); if (t) { e.preventDefault(); toast(t.dataset.toast); } });

// ---------- auth ----------
let authMode = "login";
function showAuth(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  const su = authMode === "signup";
  $("#boot").hidden = true; $("#shell").hidden = true; $("#tabbar").hidden = true; $("#auth").hidden = false;
  $("#authT").textContent = su ? "Start your free trial" : "Log in";
  $("#authS").textContent = su ? "Your AI team, ready in a minute. 14 days free, no card needed." : "Welcome back to your AI team.";
  $$("[data-su]").forEach((e) => (e.hidden = !su));
  $("#authBtn").textContent = su ? "Create my workspace" : "Log in";
  $('#authForm [name="password"]').autocomplete = su ? "new-password" : "current-password";
  $("#authSwitch").innerHTML = su ? 'Already have an account? <a class="link" href="#login" data-auth="login">Log in</a>' : 'New here? <a class="link" href="#signup" data-auth="signup">Start a free trial</a>';
  $("#authErr").textContent = "";
  setTimeout(() => $(su ? '#authForm [name="name"]' : '#authForm [name="email"]').focus(), 50);
}
document.addEventListener("click", (e) => { const a = e.target.closest("[data-auth]"); if (a) { e.preventDefault(); history.replaceState(null, "", "#" + a.dataset.auth); showAuth(a.dataset.auth); } });
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (authMode === "signup") body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $("#authErr").textContent = ""; $("#authBtn").disabled = true;
  try { await api(authMode === "signup" ? "/api/signup" : "/api/login", { method: "POST", body }); location.hash = "home"; await boot(); }
  catch (err) { $("#authErr").textContent = err.message; }
  finally { $("#authBtn").disabled = false; }
});
document.addEventListener("click", async (e) => { if (!e.target.closest("[data-logout]")) return; await api("/api/logout", { method: "POST" }).catch(() => {}); location.hash = ""; location.reload(); });

// ---------- boot ----------
async function init() {
  try {
    const st = await (await fetch("/api/state")).json();
    if (!st.me) return showAuth(location.hash === "#signup" ? "signup" : "login");
    await boot();
  } catch { $("#boot").textContent = "Can't reach the server. Refresh to try again."; }
}
async function refresh() {
  const b = await api("/api/bootstrap");
  Object.assign(S, { me: b.me, ws: b.ws, agents: b.agents, services: b.services, threads: b.threads, blocked: b.blocked });
  S.agents.forEach((a) => (AG[a.key] = a));
  S.pending = await api("/api/approvals?status=pending");
  paintChrome();
}
async function boot() {
  await refresh();
  $("#boot").hidden = true; $("#auth").hidden = true; $("#shell").hidden = false; $("#tabbar").hidden = false;
  if (["#login", "#signup", ""].includes(location.hash)) history.replaceState(null, "", "#home");
  show();
}
function paintChrome() {
  $$("[data-biz]").forEach((e) => (e.textContent = S.ws?.name || "Morning Telos"));
  $$("[data-admin]").forEach((e) => (e.hidden = !S.me?.is_admin));
  const nm = S.me?.name || S.me?.email || "";
  $$("[data-initial]").forEach((e) => (e.textContent = (nm[0] || "·").toUpperCase()));
  $$("[data-myname]").forEach((e) => (e.textContent = nm));
  $$("[data-myrole]").forEach((e) => (e.textContent = S.me?.role === "owner" ? "Owner" : "Teammate"));
  const n = S.pending.length;
  $$("[data-count]").forEach((c) => { c.textContent = n; c.style.display = n ? "" : "none"; });
  $$("[data-count-txt]").forEach((c) => (c.textContent = n || ""));
  $("#recent").innerHTML = S.threads.slice(0, 6).map((t) => `<a class="rc" href="#chat/${t.id}"><span>${esc(t.title)}</span></a>`).join("") || `<span class="rc" style="color:var(--ink-4)">No chats yet</span>`;
}

// ---------- drawer ----------
let lastFocus = null;
function openDrawer(title, html) { lastFocus = document.activeElement; $("#dwT").textContent = title; $("#dwB").innerHTML = html; $("#dw").classList.add("on"); setTimeout(() => $("#dw .dw-h .icon-btn").focus(), 50); }
function closeDrawer() { $("#dw").classList.remove("on"); if (lastFocus) lastFocus.focus(); }
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("#pal").classList.contains("on")) closePal(); else if ($("#dw").classList.contains("on")) closeDrawer(); } });

// ---------- dropdown ----------
const CHEV = '<svg class="ico sm" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>', TICK = '<svg class="ico sm tick" viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>';
function DD(el, o) {
  let hi = 0;
  el.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${o.label}"><span class="dd-l"></span>${CHEV}</button><div class="dd-menu" role="listbox" aria-label="${o.label}"></div>`;
  const btn = el.querySelector(".dd-btn"), menu = el.querySelector(".dd-menu");
  const lab = (it) => `${it.img ? `<img src="${it.img}" alt="">` : ""}${esc(it.t)}`;
  function paint() {
    const items = o.items(), cur = items.find((i) => i.v === o.value) || items[0];
    el.querySelector(".dd-l").innerHTML = cur ? lab(cur) : "";
    menu.innerHTML = items.map((it, i) => `<button type="button" role="option" data-dv="${it.v}" aria-selected="${it.v === o.value}" class="${i === hi ? "hi" : ""}">${it.v === o.value ? TICK : '<span class="tick"></span>'}${lab(it)}${it.n != null ? `<span class="n">${it.n}</span>` : ""}</button>`).join("");
  }
  const close = () => { menu.classList.remove("on"); btn.setAttribute("aria-expanded", false); };
  function open() { $$(".dd-menu.on").forEach((m) => m.classList.remove("on")); hi = Math.max(0, o.items().findIndex((i) => i.v === o.value)); paint(); menu.classList.add("on"); btn.setAttribute("aria-expanded", true); }
  function pick(v) { o.value = v; close(); paint(); o.onChange(v); btn.focus(); }
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.contains("on") ? close() : open(); });
  menu.addEventListener("click", (e) => { const b = e.target.closest("[data-dv]"); if (b) pick(b.dataset.dv); });
  btn.addEventListener("keydown", (e) => {
    const items = o.items();
    if (!menu.classList.contains("on")) { if (["ArrowDown", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); hi = (hi + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hi = (hi - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(items[hi].v); }
    else if (e.key === "Escape" || e.key === "Tab") close();
  });
  document.addEventListener("click", (e) => { if (!el.contains(e.target)) close(); });
  paint();
  return { paint, set: (v) => { o.value = v; paint(); } };
}

// ---------- model picker ----------
const MODELS = [["auto", "Auto", "Opus 5.5 for everything", "Best"], ["opus", "Opus 5.5", "Smartest, for plans and research", "Slower"], ["sonnet", "Sonnet 5.5", "Great writing, quicker", "Fast"], ["haiku", "Haiku 5.5", "Short tasks and quick answers", "Fastest"]];
function renderMP() { $("#mp").innerHTML = `<h5>Choose your AI model</h5>` + MODELS.map((m, i) => `${i === 1 ? "<h6>Claude</h6>" : ""}<button type="button" role="option" aria-selected="${S.model === m[0]}" data-model="${m[0]}"><span class="mi">${i ? "✳" : "✦"}</span><span><b>${m[1]}</b><br><small>${m[2]}</small></span><span class="rt">${m[3]}${S.model === m[0] ? " ✓" : ""}</span></button>`).join(""); }
$("#mpBtn").addEventListener("click", (e) => { e.stopPropagation(); renderMP(); const on = !$("#mp").classList.contains("on"); $("#mp").classList.toggle("on", on); $("#mpBtn").setAttribute("aria-expanded", on); });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-model]");
  if (b) { S.model = b.dataset.model; $("#mpLbl").textContent = MODELS.find((m) => m[0] === S.model)[1]; $("#mp").classList.remove("on"); return; }
  if (!e.target.closest("#mp")) $("#mp").classList.remove("on");
});

// ---------- @mentions ----------
const pop = document.createElement("div"); pop.className = "mpop"; pop.setAttribute("role", "listbox");
let popTA = null, popSel = 0, popItems = [];
function hl(t) { return esc(t).replace(/@(\w+)/g, (m, n) => { const a = S.agents.find((x) => x.god.toLowerCase() === n.toLowerCase()); return a ? `<span class="mention">@${a.god}</span>` : m; }); }
function mq(ta) { const m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)@(\w*)$/); return m ? m[2].toLowerCase() : null; }
function openPop(ta, q) {
  popTA = ta; ta.closest(".composer").appendChild(pop);
  const list = q ? [...S.agents.filter((a) => a.god.toLowerCase().startsWith(q)), ...S.agents.filter((a) => !a.god.toLowerCase().startsWith(q) && a.name.toLowerCase().split(/[^a-z]+/).some((w) => w.startsWith(q)))] : S.agents;
  popItems = list.map((a) => ({ h: a.god, html: `<img src="${IMG(a.key)}" alt=""><span><b>${a.god}</b><small>${a.name}${a.ready ? "" : " · needs " + esc(a.missing.join(", "))}</small></span>` }));
  if (!popItems.length) return closePop();
  popSel = Math.min(popSel, popItems.length - 1);
  pop.innerHTML = "<h5>AI team</h5>" + popItems.map((it, i) => `<button type="button" role="option" aria-selected="${i === popSel}" data-mi="${i}" class="${i === popSel ? "on" : ""}">${it.html}</button>`).join("");
  pop.classList.add("on");
}
function closePop() { pop.classList.remove("on"); popTA = null; popSel = 0; }
function pickMention(i) { const ta = popTA, it = popItems[i]; if (!ta || !it) return; const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@(\w*)$/, "@" + it.h + " "); ta.value = before + ta.value.slice(pos); ta.focus(); ta.selectionStart = ta.selectionEnd = before.length; closePop(); }
pop.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-mi]"); if (b) { e.preventDefault(); pickMention(+b.dataset.mi); } });
$$(".composer textarea").forEach((ta) => {
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 220) + "px"; const q = mq(ta); q === null ? closePop() : openPop(ta, q); });
  ta.addEventListener("keydown", (e) => {
    if (!pop.classList.contains("on") || popTA !== ta) return;
    if (e.key === "ArrowDown") { e.preventDefault(); popSel = (popSel + 1) % popItems.length; openPop(ta, mq(ta)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); popSel = (popSel - 1 + popItems.length) % popItems.length; openPop(ta, mq(ta)); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); pickMention(popSel); }
    else if (e.key === "Escape") { e.stopPropagation(); closePop(); }
  }, true);
  ta.addEventListener("blur", () => setTimeout(() => { if (popTA === ta) closePop(); }, 150));
});
document.addEventListener("click", (e) => { const b = e.target.closest("[data-at]"); if (!b) return; const ta = b.closest(".composer").querySelector("textarea"); const v = ta.value; ta.value = v + (v && !v.endsWith(" ") ? " " : "") + "@"; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; openPop(ta, ""); });

// ---------- chat ----------
function addMsg(box, html) { box.insertAdjacentHTML("beforeend", html); box.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" }); }
const agentMsgHTML = (k, text, cls = "") => `<div class="msg ${cls}"><img class="av" src="${IMG(k)}" alt=""><div class="body"><div class="who">${AG[k]?.god || "Teammate"} <span>· ${AG[k]?.name || ""}</span></div>${md(text)}</div></div>`;
const apInlineHTML = (id, title, status = "pending") => `<div class="ap-inline"><span>${status === "pending" ? "Saved for your approval" : status === "done" ? "Approved and done" : status === "skipped" ? "Skipped" : "Failed"}: <b>${esc(title)}</b></span>${status === "pending" ? `<button class="btn sm primary" data-openap="${id}">Review</button>` : ""}</div>`;
function renderStored(box, t) {
  box.innerHTML = "";
  const aps = Object.fromEntries((t.approvals || []).map((a) => [a.id, a]));
  for (const m of t.messages) {
    if (m.role === "user") box.insertAdjacentHTML("beforeend", `<div class="msg me"><div class="bubble">${hl(m.content)}</div></div>`);
    else if (m.role === "agent") box.insertAdjacentHTML("beforeend", agentMsgHTML(m.agent, m.content, m.meta?.error ? "err" : ""));
    else if (m.role === "note") box.insertAdjacentHTML("beforeend", `<div class="handoff"><img src="${IMG(m.agent)}" alt="">${esc(m.content.split(":")[0])}</div>`);
    else if (m.role === "event") box.insertAdjacentHTML("beforeend", agentMsgHTML(m.agent, m.content, "event"));
  }
  for (const a of t.approvals || []) if (a.status === "pending") box.insertAdjacentHTML("beforeend", apInlineHTML(a.id, a.title));
  box.lastElementChild?.scrollIntoView({ block: "end" });
}
let busy = false;
async function runChat(box, text, { agent = null, threadId = null, onThread = () => {} } = {}) {
  if (busy) return toast("Your team is still working on the last message.");
  busy = true; $$(".composer .send").forEach((b) => (b.disabled = true));
  addMsg(box, `<div class="msg me"><div class="bubble">${hl(text)}</div></div>`);
  let statusEl = null;
  const setStatus = (k, t) => { if (!statusEl) { box.insertAdjacentHTML("beforeend", `<div class="step"><span class="spin"></span><span></span></div>`); statusEl = box.lastElementChild; } statusEl.lastElementChild.textContent = `${AG[k]?.god || "Your team"}: ${t}…`; box.appendChild(statusEl); statusEl.scrollIntoView({ behavior: "smooth", block: "end" }); };
  const clearStatus = () => { statusEl?.remove(); statusEl = null; };
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "x-mt": "1" }, body: JSON.stringify({ text, agent, threadId, model: S.model }) });
    if (r.status === 401) return showAuth(false);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error");
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "thread") onThread(ev.id);
        else if (ev.type === "status") setStatus(ev.agent, ev.text);
        else if (ev.type === "tool") { clearStatus(); addMsg(box, `<div class="step"><span class="dot2"></span>${esc(ev.text)}</div>`); }
        else if (ev.type === "approval") { clearStatus(); addMsg(box, apInlineHTML(ev.id, ev.title)); }
        else if (ev.type === "handoff") { clearStatus(); addMsg(box, `<div class="handoff"><img src="${IMG(ev.from)}" alt="">${AG[ev.from].god} tagged <span class="mention">@${AG[ev.to].god}</span></div>`); }
        else if (ev.type === "message") { clearStatus(); addMsg(box, agentMsgHTML(ev.agent, ev.text, ev.error ? "err" : "")); }
      }
    }
  } catch (e) { clearStatus(); addMsg(box, agentMsgHTML("chief", "I couldn't reach the server. Check your connection and try again.", "err")); }
  finally {
    clearStatus(); busy = false; $$(".composer .send").forEach((b) => (b.disabled = false));
    refresh().catch(() => {});
  }
}
let curThread = null;
async function openThread(id) {
  const t = await api("/api/threads/" + id).catch(() => null);
  if (!t) { location.hash = "home"; return; }
  curThread = t.id; $("#threadTitle").textContent = t.title; renderStored($("#chat"), t);
}
function startThread(text) {
  curThread = null; $("#chat").innerHTML = ""; $("#threadTitle").textContent = text.length > 70 ? text.slice(0, 68) + "…" : text;
  history.replaceState(null, "", "#chat");
  runChat($("#chat"), text, { onThread: (id) => { curThread = id; history.replaceState(null, "", "#chat/" + id); } });
  show(true);
}
function bindComposer(form, ta, fn) {
  form.addEventListener("submit", (e) => { e.preventDefault(); const t = ta.value.trim(); if (!t) return ta.focus(); ta.value = ""; ta.style.height = "auto"; fn(t); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
}
bindComposer($("#homeForm"), $("#homeInput"), startThread);
bindComposer($("#chatForm"), $("#chatInput"), (t) => runChat($("#chat"), t, { threadId: curThread, onThread: (id) => { curThread = id; history.replaceState(null, "", "#chat/" + id); } }));
const agThreads = {};
bindComposer($("#agForm"), $("#agInput"), (t) => { const k = window._agent; runChat($("#agChat"), t, { agent: k, threadId: agThreads[k] || null, onThread: (id) => (agThreads[k] = id) }); });
document.addEventListener("click", (e) => { const c = e.target.closest("[data-chip]"); if (c) startThread(c.dataset.chip); });
document.addEventListener("click", (e) => { if (e.target.closest("[data-new]")) { location.hash = "home"; setTimeout(() => $("#homeInput").focus(), 80); } });

// ---------- approvals ----------
function inputView(input) {
  const entries = Object.entries(input || {});
  if (!entries.length) return `<div class="kv2"><div class="v" style="color:var(--ink-4)">No details.</div></div>`;
  return `<div class="kv2">${entries.map(([k, v]) => `<div><div class="k">${esc(k.replace(/_/g, " "))}</div>${typeof v === "object" && v !== null ? `<div class="v json">${esc(JSON.stringify(v, null, 2))}</div>` : `<div class="v">${esc(v)}</div>`}</div>`).join("")}</div>`;
}
function reviewHTML(p) {
  const a = AG[p.agent];
  return `<div class="review" data-id="${p.id}">
    <div class="rv-top"><img class="av md" src="${IMG(p.agent)}" alt=""><div style="min-width:0"><span class="eyebrow">${a?.god || ""} · ${a?.name || ""}</span><h3>${esc(p.title)}</h3><div class="rv-meta"><span>${esc(p.server)} · ${esc(p.tool)}</span><span>${ago(p.created_at)}</span></div></div></div>
    <div class="why"><svg class="ico sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>${esc(p.why)} Nothing runs until you approve.</div>
    <div class="draft" data-view>${inputView(p.input)}</div>
    <div class="err" data-err></div>
    <div class="rv-act"><button class="btn primary" data-ap="ok">Approve</button><button class="btn" data-ap="edit">Edit</button><button class="btn ghost" data-ap="skip">Skip</button><span class="note"><a href="#chat/${p.thread_id || ""}" class="link">Open chat</a></span></div></div>`;
}
const apRow = (p, cta = true) => `<button class="row" data-open="${p.id}"><img class="av" src="${IMG(p.agent)}" alt=""><span class="main"><b>${esc(p.title)}</b><small>${AG[p.agent]?.god || ""} · ${esc(p.tool.replace(/_/g, " "))}</small></span>${cta ? `<span class="go">Review</span>` : `<span class="meta">${ago(p.created_at)}</span>`}</button>`;
let apSel = null, apF = "all";
const apDD = DD($("#apDD"), { label: "Filter by teammate", value: "all", items: () => [{ v: "all", t: "All teammates", n: S.pending.length }, ...[...new Set(S.pending.map((p) => p.agent))].map((k) => ({ v: k, t: AG[k]?.god || k, img: IMG(k), n: S.pending.filter((p) => p.agent === k).length }))], onChange: (v) => { apF = v; renderApprovals(); } });
function renderApprovals() {
  if (apF !== "all" && !S.pending.some((p) => p.agent === apF)) apF = "all";
  apDD.set(apF);
  const list = S.pending.filter((p) => apF === "all" || p.agent === apF);
  if (!list.some((p) => p.id === apSel)) apSel = list[0]?.id ?? null;
  $("#apList").innerHTML = list.length ? list.map((p) => apRow(p, false).replace('class="row"', `class="row ${p.id === apSel ? "sel" : ""}"`)).join("") : emptyHTML("All caught up", "When your team prepares a change, it shows up here.");
  const p = S.pending.find((x) => x.id === apSel);
  $("#apPane").innerHTML = p ? reviewHTML(p) : emptyHTML("Nothing to review", "New changes will show up here.");
}
document.addEventListener("click", (e) => {
  const o = e.target.closest("[data-open],[data-openap]"); if (!o) return;
  const id = +(o.dataset.open || o.dataset.openap), p = S.pending.find((x) => x.id === id);
  if (!p) { toast("That one was already handled."); return; }
  if (o.closest("#apList") && !isMobile()) { apSel = id; renderApprovals(); return; }
  openDrawer("Review", reviewHTML(p));
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ap]"); if (!b) return;
  const box = b.closest(".review"), id = +box.dataset.id, p = S.pending.find((x) => x.id === id); if (!p) return;
  const act = b.dataset.ap, view = box.querySelector("[data-view]"), err = box.querySelector("[data-err]");
  if (act === "edit") { view.classList.add("editing"); view.innerHTML = `<textarea class="ta code" aria-label="Edit the details as JSON">${esc(JSON.stringify(p.input, null, 2))}</textarea>`; view.querySelector("textarea").focus(); b.textContent = "Cancel"; b.dataset.ap = "cancel"; return; }
  if (act === "cancel") { view.classList.remove("editing"); view.innerHTML = inputView(p.input); b.textContent = "Edit"; b.dataset.ap = "edit"; err.textContent = ""; return; }
  let body = { action: act === "skip" ? "skip" : "approve" };
  const ta = view.querySelector("textarea");
  if (ta && act === "ok") { try { body.input = JSON.parse(ta.value); } catch { err.textContent = "That isn't valid JSON. Fix it or press Cancel."; return; } }
  $$("[data-ap]", box).forEach((x) => (x.disabled = true));
  try {
    const r = await api("/api/approvals/" + id, { method: "POST", body });
    if (r.status === "skipped") toast(`Skipped. ${AG[p.agent].god} won't run it.`);
    else if (r.status === "done") toast("✓ Done: " + p.title);
    else toast("It failed: " + (r.result || "unknown error").slice(0, 160));
    if (box.closest("#dw")) closeDrawer();
    await refresh(); show(true);
  } catch (x) { err.textContent = x.message; $$("[data-ap]", box).forEach((y) => (y.disabled = false)); }
});

// ---------- home ----------
async function renderHome() {
  await refresh();
  const h = new Date().getHours(), nm = (S.me?.name || "").split(" ")[0];
  $("#greet").textContent = (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + (nm ? ", " + nm : "");
  const ok = (k) => S.services[k]?.ready;
  const sugg = [];
  if (ok("arrowsterr")) sugg.push("@Artemis how is our AI visibility this week?", "@Artemis what should we write next?");
  if (ok("capybaroar")) sugg.push("@Aphrodite plan next week's posts");
  if (!sugg.length) sugg.push("Help me write a short brand voice guide", "@Hephaestus outline a homepage for my business", "What can my AI team do for me?");
  const IC = '<svg class="ico sm" viewBox="0 0 24 24"><path d="M12 3v3M18.4 5.6l-2.1 2.1M21 12h-3M5.6 5.6l2.1 2.1M3 12h3"/><path d="M9 18h6M10 21h4M12 9a4 4 0 0 0-2 7.5V18h4v-1.5A4 4 0 0 0 12 9Z"/></svg>', GO = '<svg class="ico sm go-ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  $("#sugg").innerHTML = sugg.slice(0, 3).map((c) => `<button class="sg-i" data-chip="${esc(c)}">${IC}<span>${hl(c)}</span>${GO}</button>`).join("");
  // trial / plan banner
  const w = S.ws, tb = $("#trialBar");
  if (S.blocked) { tb.hidden = false; tb.className = "trialbar warn"; tb.innerHTML = `${esc(S.blocked)} <b>Open Billing →</b>`; }
  else if (w.plan === "trial") { const d = Math.max(0, Math.ceil((new Date(w.trial_ends_at) - Date.now()) / 864e5)); tb.hidden = false; tb.className = "trialbar"; tb.innerHTML = `Free trial: <b>${d} day${d === 1 ? "" : "s"} left</b> · Choose a plan →`; }
  else tb.hidden = true;
  const [home, know] = await Promise.all([api("/api/home"), api("/api/knowledge")]);
  const filled = know.some((d) => !/What we sell:\s*\nWho our customers are:/.test(d.body));
  const steps = [
    { done: filled, t: "Tell your team about your business", s: "Fill in what you sell, who you serve and how you sound", href: "#knowledge" },
    { done: S.services.arrowsterr?.setup, t: "SEO and AI visibility", s: "Morning Telos is setting this up for you. Usually within 1 business day.", href: "#team", wait: true },
    { done: S.services.capybaroar?.setup, t: "Connect your social accounts", s: "Book a quick call and we'll connect Facebook, Instagram and more", href: "https://morningtelos.com/book/", ext: true },
  ];
  const left = steps.filter((x) => !x.done);
  $("#setupSec").hidden = !left.length; $("#setupN").textContent = left.length;
  $("#setupList").innerHTML = left.map((x) => `<a class="row" href="${x.href}"${x.ext ? ' target="_blank" rel="noopener"' : ""}><span class="main"><b>${x.t}</b><small>${x.s}</small></span><span class="${x.wait ? "meta" : "btn sm"}">${x.wait ? "In progress" : x.ext ? "Book a call" : "Start"}</span></a>`).join("");
  $("#homeNeeds").innerHTML = S.pending.length ? S.pending.slice(0, 3).map((p) => apRow(p)).join("") : emptyHTML("All caught up", "Your team will ask you here before changing anything.");
  $("#homeKpis").innerHTML = [["Replies", home.replies], ["Changes done", home.changesDone], ["Waiting on you", S.pending.length], ["AI cost", "$" + home.spend.toFixed(2)]].map(([k, v]) => `<div class="kpi"><small>${k}</small><b>${v}</b><em class="flat">Last 7 days</em></div>`).join("");
  $("#feed").innerHTML = home.activity.length ? home.activity.map((a) => `<${a.thread_id ? `a href="#chat/${a.thread_id}"` : "div"} class="row"><img class="av sm" src="${IMG(a.agent || "chief")}" alt=""><p><b>${AG[a.agent]?.god || "Team"}</b> ${esc(a.text)}</p><span class="meta">${ago(a.created_at)}</span></${a.thread_id ? "a" : "div"}>`).join("") : emptyHTML("Quiet so far", "Ask your team something to get started.");
}

// ---------- team + agent ----------
function renderTeam() {
  const CATS = [["Marketing", ["social", "seo", "email", "web"]], ["Sales and scheduling", ["sales", "forms"]], ["Customer service", ["support"]], ["Operations", ["chief"]]];
  const ics = (svcs) => `<span class="ics">${svcs.filter((x) => SVC_ICON[x]).map((x) => `<span class="ic" title="${esc(S.services[x]?.label || x)}" style="background:${SVC_ICON[x][1]};width:auto;padding:0 6px;font-size:10px">${SVC_ICON[x][0]}</span>`).join("")}</span>`;
  const st = (a) => a.soon ? ["idle", "Coming soon"] : !a.enabled ? ["idle", "Paused"] : a.ready ? ["", "Ready"] : ["wait", "Setting up"];
  const card = (a) => `<article class="card uc"><div class="top"><img src="${IMG(a.key)}" alt="${a.god}">${ics(a.services)}</div><div class="r1"><span class="eyebrow">${a.god}</span><span class="status ${st(a)[0]}">${esc(st(a)[1])}</span></div><h3>${a.name}</h3><p>${esc(a.job)}</p><ul>${a.out.map((o) => `<li>${esc(o)}</li>`).join("")}</ul><div class="ft"><a href="#agent/${a.key}">See how it works →</a>${a.soon ? "" : `<button class="btn primary sm try" data-try="${a.key}">Try in chat</button>`}</div></article>`;
  $("#ucWrap").innerHTML = CATS.map(([c, ks]) => `<section class="uc-sec"><h2>${c}</h2><div class="uc-grid">${ks.map((k) => card(AG[k])).join("")}</div></section>`).join("");
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-try]"); if (!b) return; const k = b.dataset.try; location.hash = "home"; setTimeout(() => { const ta = $("#homeInput"); ta.value = "@" + AG[k].god + " "; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }, 80); });
const TRUST = [[0, "Approve every change", "Changes wait for your OK. Reading and research run right away."], [2, "Autopilot", "Changes run right away and show up in Activity. Use once you trust this teammate."]];
function setTab(t) { $$("#agTabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t)); $$("#v-agent .tp").forEach((p) => p.classList.toggle("on", p.id === "t-" + t)); if (t === "chat") setTimeout(() => $("#agInput").focus(), 60); }
document.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b && b.closest("#v-agent")) setTab(b.dataset.tab); });
async function openAgent(k) {
  const a = AG[k]; window._agent = k;
  $("#agImg").src = FULL(k); $("#agImg").alt = "Marble statue of " + a.god;
  $("#agGod").textContent = a.god; $("#agName").textContent = a.name; $("#agJob").textContent = a.job;
  $("#agTools").innerHTML = a.soon ? `<span class="toolc">Coming soon</span>` : a.services.map((x) => `<span class="toolc"><i style="background:${S.services[x]?.ready ? "var(--green)" : "var(--ink-4)"}"></i>${esc(S.services[x]?.label || x)}${S.services[x]?.ready ? "" : " · setting up"}</span>`).join("") || `<span class="toolc">Knowledge and chat</span>`;
  $("#agTog").setAttribute("aria-checked", a.enabled); $("#agOnLbl").textContent = a.enabled ? "Working" : "Paused";
  $("#trust").innerHTML = TRUST.map(([v, t, s]) => `<button class="radio" role="radio" aria-checked="${a.trust === v}" data-trust="${v}"><span class="rd"></span><span><b>${t}</b><small>${s}</small></span></button>`).join("");
  if (!agThreads[k]) $("#agChat").innerHTML = `<div class="msg"><img class="av" src="${IMG(k)}" alt=""><div class="body"><div class="who">${a.god} <span>· ${a.name}</span></div>${md(a.soon ? `Hi, I'm ${a.god}. I'm coming soon.` : a.ready ? `Hi, I'm ${a.god}. ${a.job} What do you need?` : `Hi, I'm ${a.god}. Morning Telos is still setting up ${a.missing.join(" and ").toLowerCase()} for you, so I'll work from your Knowledge for now.`)}</div></div>`;
  setTab("ov");
  const [st, know] = await Promise.all([api(`/api/agents/${k}/stats`), api("/api/knowledge")]);
  $("#agKpis").innerHTML = [["Replies", st.replies], ["Changes done", st.done], ["Waiting on you", st.pending], ["Status", a.soon ? "Soon" : !a.enabled ? "Paused" : a.ready ? "Ready" : "Setup"]].map(([x, v]) => `<div class="kpi"><small>${x}</small><b>${v}</b><em class="flat">${x === "Status" ? (a.soon ? "Coming soon" : a.ready ? "All services ready" : "Setting up " + esc(a.missing.join(", ").toLowerCase())) : "Last 7 days"}</em></div>`).join("");
  const mine = S.pending.filter((p) => p.agent === k);
  $("#agNeeds").innerHTML = mine.length ? mine.map((p) => apRow(p)).join("") : emptyHTML("Nothing waiting", "All caught up.");
  $("#agRecent").innerHTML = st.recent.length ? st.recent.map((r) => `<div class="row"><p>${esc(r.text)}</p><span class="meta">${ago(r.created_at)}</span></div>`).join("") : emptyHTML("No work yet", "Send a message to get started.");
  const docs = know.filter((d) => !d.agent || d.agent === k);
  $("#agDocs").innerHTML = docs.length ? docs.map((d) => `<a class="row" href="#knowledge"><span class="main"><b>${esc(d.title)}</b><small>${d.agent ? "Only for " + a.god : "Everyone"}</small></span></a>`).join("") : emptyHTML("Nothing yet", "Add your services, prices and rules in Knowledge.");
}
$("#trust").addEventListener("click", async (e) => { const b = e.target.closest("[data-trust]"); if (!b) return; const k = window._agent; await api(`/api/agents/${k}`, { method: "POST", body: { trust: +b.dataset.trust } }); AG[k].trust = +b.dataset.trust; $$("#trust .radio").forEach((r) => r.setAttribute("aria-checked", r === b)); toast(`${AG[k].god}: ${TRUST.find((t) => t[0] === +b.dataset.trust)[1]}`); });
$("#agTog").addEventListener("click", async () => { const k = window._agent, on = $("#agTog").getAttribute("aria-checked") !== "true"; await api(`/api/agents/${k}`, { method: "POST", body: { enabled: on } }); AG[k].enabled = on; $("#agTog").setAttribute("aria-checked", on); $("#agOnLbl").textContent = on ? "Working" : "Paused"; toast(on ? `${AG[k].god} is back to work` : `${AG[k].god} is paused`); });

// ---------- routines ----------
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
async function renderRoutines() {
  const list = await api("/api/routines");
  const dayTxt = (d) => d.length === 7 ? "Every day" : d.join(",") === "1,2,3,4,5" ? "Weekdays" : d.map((x) => DAYS[x]).join(", ");
  $("#rtList").innerHTML = list.length ? list.map((r) => `<div class="row"><img class="av" src="${IMG(r.agent)}" alt=""><span class="main"><b>${esc(r.title)}</b><small>${AG[r.agent]?.god} · ${dayTxt(r.days)} at ${r.at_time}${r.last_run_at ? " · last ran " + ago(r.last_run_at) : ""}</small></span><button class="btn sm ghost" data-rtrun="${r.id}">Run now</button><button class="switch" role="switch" aria-checked="${r.enabled}" data-rt="${r.id}" aria-label="${esc(r.title)}"></button><button class="icon-btn" data-rtdel="${r.id}" aria-label="Delete routine"><svg class="ico sm" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg></button></div>`).join("") : emptyHTML("No routines yet", "Example: every Monday at 8am, Aphrodite plans the week's posts.");
}
$("#rtNew").addEventListener("click", () => {
  const opts = S.agents.filter((a) => !a.soon).map((a) => `<option value="${a.key}">${a.god} · ${a.name}</option>`).join("");
  openDrawer("New routine", `<form id="rtForm"><label class="fld"><span>Teammate</span><select class="sel" name="agent">${opts}</select></label><label class="fld"><span>Name</span><input class="inp" name="title" placeholder="Plan next week's posts"></label><label class="fld"><span>What to do</span><textarea class="ta" name="instruction" placeholder="Look at last week's results and draft 5 posts for next week."></textarea></label><div class="fld"><span>Days</span><div class="daypick">${DAYS.map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${i >= 1 && i <= 5 ? "checked" : ""}>${d}</label>`).join("")}</div></div><label class="fld"><span>Time (${esc(S.ws.timezone)})</span><input class="inp" type="time" name="at_time" value="08:00"></label><div class="err" id="rtErr"></div><button class="btn primary">Save routine</button></form>`);
  $("#rtForm").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("/api/routines", { method: "POST", body: { agent: f.get("agent"), title: f.get("title"), instruction: f.get("instruction"), days: f.getAll("days").map(Number), at_time: f.get("at_time") } }); closeDrawer(); toast("Routine saved"); renderRoutines(); } catch (x) { $("#rtErr").textContent = x.message; } });
});
$("#rtList").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-rt]"), run = e.target.closest("[data-rtrun]"), del = e.target.closest("[data-rtdel]");
  if (t) { const on = t.getAttribute("aria-checked") !== "true"; await api("/api/routines/" + t.dataset.rt, { method: "PUT", body: { enabled: on } }); t.setAttribute("aria-checked", on); toast(on ? "Routine on" : "Routine paused"); }
  if (run) { const r = await api(`/api/routines/${run.dataset.rtrun}/run`, { method: "POST" }); toast("Started. Opening the chat…"); setTimeout(() => (location.hash = "chat/" + r.threadId), 600); }
  if (del && confirm("Delete this routine?")) { await api("/api/routines/" + del.dataset.rtdel, { method: "DELETE" }); renderRoutines(); }
});

// ---------- knowledge ----------
let KD = [], kSel = null;
function kEditor(d) {
  const opts = `<option value="">Everyone</option>` + S.agents.map((a) => `<option value="${a.key}" ${d?.agent === a.key ? "selected" : ""}>Only ${a.god} (${a.name})</option>`).join("");
  return `<form id="kForm" data-id="${d?.id || ""}"><label class="fld"><span>Title</span><input class="inp" name="title" value="${esc(d?.title || "")}" placeholder="Services and prices"></label><label class="fld"><span>Who uses it</span><select class="sel" name="agent">${opts}</select></label><label class="fld"><span>Details</span><textarea class="ta" name="body" style="min-height:220px" placeholder="Write it like you'd brief a new hire.">${esc(d?.body || "")}</textarea></label><div class="err" id="kErr"></div><div class="rv-act" style="margin-top:4px"><button class="btn primary">Save</button>${d?.id ? `<button type="button" class="btn ghost" data-kdel="${d.id}">Delete</button>` : ""}</div></form>`;
}
async function renderKnowledge() {
  KD = await api("/api/knowledge");
  $("#kList").innerHTML = KD.length ? KD.map((d) => `<button class="row ${d.id === kSel ? "sel" : ""}" data-kd="${d.id}"><span class="ki ${d.agent ? "l" : ""}">DOC</span><span class="main"><b>${esc(d.title)}</b><small>${d.agent ? "Only " + AG[d.agent]?.god : "Everyone"} · ${ago(d.updated_at)}</small></span></button>`).join("") : emptyHTML("Nothing yet", "Start with your services, prices, service area and brand voice.");
  if (!isMobile()) $("#kPane").innerHTML = kEditor(KD.find((d) => d.id === kSel));
}
$("#kNew").addEventListener("click", () => { kSel = null; isMobile() ? openDrawer("New doc", kEditor(null)) : renderKnowledge().then(() => $('#kForm [name="title"]').focus()); });
$("#kList").addEventListener("click", (e) => { const r = e.target.closest("[data-kd]"); if (!r) return; kSel = +r.dataset.kd; isMobile() ? openDrawer("Edit doc", kEditor(KD.find((d) => d.id === kSel))) : renderKnowledge(); });
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "kForm") return;
  e.preventDefault(); const f = new FormData(e.target), id = e.target.dataset.id;
  const body = { title: f.get("title"), body: f.get("body"), agent: f.get("agent") || null };
  try { const r = await api(id ? "/api/knowledge/" + id : "/api/knowledge", { method: id ? "PUT" : "POST", body }); if (!id) kSel = r.id; toast("Saved. Your team will use it from now on."); if ($("#dw").classList.contains("on")) closeDrawer(); renderKnowledge(); }
  catch (x) { $("#kErr").textContent = x.message; }
});
document.addEventListener("click", async (e) => { const b = e.target.closest("[data-kdel]"); if (!b || !confirm("Delete this doc?")) return; await api("/api/knowledge/" + b.dataset.kdel, { method: "DELETE" }); kSel = null; if ($("#dw").classList.contains("on")) closeDrawer(); renderKnowledge(); });

// ---------- billing ----------
const SECRET_ATTRS = 'type="text" class="inp secret" autocomplete="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other"';
async function renderBilling() {
  const b = await api("/api/billing"), w = b.ws, owner = S.me?.role === "owner";
  if (new URLSearchParams(location.hash.split("?")[1] || "").get("paid")) toast("Thanks! Your plan is active.");
  const pct = b.budget ? Math.min(100, Math.round((b.used / b.budget) * 100)) : 0;
  const trialDays = Math.max(0, Math.ceil((new Date(w.trial_ends_at) - Date.now()) / 864e5));
  const planName = w.plan === "trial" ? "Free trial" : w.plan === "internal" ? "Morning Telos team" : (b.plans.find((p) => p.key === w.plan)?.name || w.plan);
  $("#planNow").innerHTML = `<div class="sh" style="margin-bottom:4px"><h2>${esc(planName)}</h2><span class="status ${w.status === "active" || w.status === "trialing" ? "" : "wait"}">${esc(w.plan === "trial" ? `${trialDays} day${trialDays === 1 ? "" : "s"} left` : w.status)}</span></div>
    ${w.plan === "internal" ? `<p style="color:var(--ink-3);font-size:13.5px">No limits for the Morning Telos team.</p>` : `<div class="meter"><i style="width:${pct}%"></i></div><p style="color:var(--ink-3);font-size:13px">${pct}% of this period's AI allowance used.</p>`}`;
  $("#portalBtn").hidden = !(b.hasBilling && owner);
  $("#planGrid").innerHTML = b.plans.length ? b.plans.map((p) => `<div class="card plan ${p.key === w.plan ? "cur" : ""}"><h3>${esc(p.name)}</h3><span class="price">${esc(p.price_label || "")}</span><p>Your full AI team with ${p.key === "pro" ? "a bigger" : "a monthly"} AI allowance.</p>
    ${p.key === w.plan ? `<span class="btn sm" style="pointer-events:none">Current plan</span>` : p.buyable && b.stripe && owner ? `<button class="btn primary sm" data-buy="${p.key}">Choose ${esc(p.name)}</button>` : `<a class="btn sm" href="https://morningtelos.com/book/" target="_blank" rel="noopener">Talk to us</a>`}</div>`).join("") : emptyHTML("Plans coming soon", "Talk to us to keep your team after the trial.");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-buy]"); if (!b) return;
  b.disabled = true;
  try { const r = await api("/api/billing/checkout", { method: "POST", body: { plan: b.dataset.buy } }); location.href = r.url; } catch (x) { toast(x.message); b.disabled = false; }
});
$("#portalBtn").addEventListener("click", async () => { try { const r = await api("/api/billing/portal", { method: "POST" }); location.href = r.url; } catch (x) { toast(x.message); } });

// ---------- admin ----------
async function renderAdmin() {
  if (!S.me?.is_admin) { location.hash = "home"; return; }
  const d = await api("/api/admin/overview");
  const st = (a) => a.status === "ok" ? `<span class="pillst ok">Connected${a.toolCount ? ` · ${a.toolCount} tools` : ""}</span>` : a.status === "error" ? `<span class="pillst error">Not working</span>` : `<span class="pillst off">Not connected</span>`;
  $("#admApps").innerHTML = d.apps.map((a) => `<div class="card appx"><div class="hd"><span class="lg" style="background:${APPC[a.key]?.[1] || "#999"}">${APPC[a.key]?.[0] || "?"}</span><span class="tx"><b>${esc(a.name)}</b><small>${esc(a.help)}</small></span>${st(a)}</div>
    <form data-app="${a.key}" autocomplete="off">${a.kind === "mcp" ? `<input class="inp" name="mcp_address" autocomplete="off" data-1p-ignore data-lpignore="true" placeholder="https://…/mcp" value="${esc(a.url)}" aria-label="${esc(a.name)} MCP address">` : ""}
    <input ${SECRET_ATTRS} name="k_secret" placeholder="${a.hasKey ? "Saved. Paste a new key to replace it" : "Paste key"}" aria-label="${esc(a.name)} key">
    ${a.kind === "stripe" ? `<input ${SECRET_ATTRS} name="k_whsec" placeholder="Webhook signing secret (whsec_…)" aria-label="Stripe webhook secret">` : ""}
    ${a.error ? `<div class="err">${esc(a.error)}</div>` : ""}
    <div class="row2"><button class="btn primary sm">${a.status === "ok" ? "Update" : "Save and test"}</button>${a.hasKey ? `<button type="button" class="btn ghost sm" data-appdel="${a.key}">Disconnect</button>` : ""}</div></form></div>`).join("");
  $("#admHook").textContent = "Stripe webhook: " + d.hookUrl;
  $("#admPlans").innerHTML = `<div class="plan-edit h"><span>Plan</span><span>Name</span><span>Price label</span><span>Stripe price id</span><span>AI $ / period</span></div>` +
    d.plans.map((p) => `<div class="plan-edit" data-plan="${p.key}"><b style="font-size:13px">${p.key}</b><input class="inp" name="name" value="${esc(p.name)}"><input class="inp" name="price_label" value="${esc(p.price_label)}" placeholder="$99/month"><input class="inp" name="stripe_price_id" value="${esc(p.stripe_price_id || "")}" placeholder="price_…" ${p.key === "trial" ? "disabled" : ""}><input class="inp" name="ai_budget_usd" type="number" min="0" step="1" value="${Number(p.ai_budget_usd)}"></div>`).join("") +
    `<button class="btn primary sm" style="margin-top:6px">Save plans</button>`;
  $("#admWs").innerHTML = d.workspaces.map((w) => `<form class="adm-row" data-ws="${w.id}" autocomplete="off"><span><b>${esc(w.name)}</b><small>${esc(w.owner_email || "")} · ${esc(w.website || "no site")} · ${w.users} ${w.users === 1 ? "person" : "people"} · $${w.spend30.toFixed(2)} AI / 30d</small></span>
    <input class="inp" name="arrowsterr_brand" placeholder="Arrowsterr brand" value="${esc(w.arrowsterr_brand || "")}" autocomplete="off" data-1p-ignore>
    <input class="inp" name="capybaroar_brand_id" placeholder="Capybaroar brand id" value="${esc(w.capybaroar_brand_id || "")}" autocomplete="off" data-1p-ignore>
    <span style="display:flex;gap:6px"><select class="sel" name="plan">${["trial", "starter", "pro", "internal"].map((p) => `<option ${p === w.plan ? "selected" : ""}>${p}</option>`).join("")}</select><select class="sel" name="status">${["trialing", "active", "past_due", "canceled"].map((p) => `<option ${p === w.status ? "selected" : ""}>${p}</option>`).join("")}</select></span>
    <span style="display:flex;gap:6px"><button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-extend="${w.id}" title="Add 7 trial days">+7d</button></span></form>`).join("") || emptyHTML("No workspaces", "");
}
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-app]");
  if (f) {
    e.preventDefault(); const b = f.querySelector("button"); b.disabled = true; b.textContent = "Testing…";
    const d = Object.fromEntries(new FormData(f).entries());
    try { const r = await api("/api/admin/apps/" + f.dataset.app, { method: "POST", body: { url: d.mcp_address, key: d.k_secret, webhook_secret: d.k_whsec } }); toast(r.status === "ok" ? "Connected" : "Saved, but the test failed: " + r.error); }
    catch (x) { toast(x.message); }
    await refresh(); return renderAdmin();
  }
  const w = e.target.closest("[data-ws]");
  if (w) { e.preventDefault(); try { await api("/api/admin/workspaces/" + w.dataset.ws, { method: "POST", body: Object.fromEntries(new FormData(w).entries()) }); toast("Workspace saved"); } catch (x) { toast(x.message); } return renderAdmin(); }
  if (e.target.id === "admPlans") {
    e.preventDefault();
    const plans = $$("[data-plan]", e.target).map((r) => ({ key: r.dataset.plan, ...Object.fromEntries($$("input", r).map((i) => [i.name, i.value])) }));
    try { await api("/api/admin/plans", { method: "POST", body: { plans } }); toast("Plans saved"); } catch (x) { toast(x.message); }
  }
});
document.addEventListener("click", async (e) => {
  const x = e.target.closest("[data-extend]");
  if (x) { await api("/api/admin/workspaces/" + x.dataset.extend, { method: "POST", body: { extend_trial_days: 7 } }); toast("Trial extended 7 days"); return renderAdmin(); }
  const b = e.target.closest("[data-appdel]");
  if (b && confirm("Disconnect this platform app? Every workspace loses it.")) { await api("/api/admin/apps/" + b.dataset.appdel, { method: "DELETE" }); renderAdmin(); }
});

// ---------- settings ----------
const TZS = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Asia/Ho_Chi_Minh", "Asia/Singapore", "Australia/Sydney", "UTC"];
async function renderSettings() {
  const s = await api("/api/settings"), owner = S.me?.role === "owner";
  $('#bizForm [name="name"]').value = s.ws.name; $('#bizForm [name="website"]').value = s.ws.website || "";
  $("#tzSel").innerHTML = [...new Set([s.ws.timezone, ...TZS])].map((z) => `<option ${z === s.ws.timezone ? "selected" : ""}>${z}</option>`).join("");
  $$("#bizForm input, #bizForm select, #bizForm button").forEach((x) => (x.disabled = !owner));
  $("#userList").innerHTML = s.users.map((u) => `<div class="row"><span class="avatar-me" style="width:32px;height:32px">${esc((u.name || u.email)[0].toUpperCase())}</span><span class="main"><b>${esc(u.name || u.email)}</b><small>${esc(u.email)} · ${u.role === "owner" ? "Owner" : "Teammate"}</small></span>${owner && u.role !== "owner" ? `<button class="btn ghost sm" data-udel="${u.id}">Remove</button>` : ""}</div>`).join("");
  $("#userForm").hidden = !owner;
}
$("#bizForm").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/settings", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) }); $("#bizOk").textContent = "Saved"; setTimeout(() => ($("#bizOk").textContent = ""), 2000); await refresh(); } catch (x) { toast(x.message); } });
$("#pwForm").addEventListener("submit", async (e) => { e.preventDefault(); $("#pwErr").textContent = ""; try { await api("/api/me/password", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) }); e.target.reset(); toast("Password updated"); } catch (x) { $("#pwErr").textContent = x.message; } });
$("#userForm").addEventListener("submit", async (e) => { e.preventDefault(); $("#userErr").textContent = ""; try { await api("/api/users", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) }); e.target.reset(); toast("Teammate added"); renderSettings(); } catch (x) { $("#userErr").textContent = x.message; } });
document.addEventListener("click", async (e) => { const b = e.target.closest("[data-udel]"); if (!b || !confirm("Remove this person?")) return; await api("/api/users/" + b.dataset.udel, { method: "DELETE" }); renderSettings(); });

// ---------- command palette ----------
const PAGES = [["home", "Home"], ["approvals", "Approvals"], ["team", "Team"], ["routines", "Routines"], ["knowledge", "Knowledge"], ["billing", "Billing"], ["settings", "Settings"]];
let palSel = 0, palItems = [];
function renderPal() {
  const q = $("#palIn").value.toLowerCase().trim();
  const items = [
    { l: "New request", k: "Actions", go: () => { location.hash = "home"; setTimeout(() => $("#homeInput").focus(), 80); }, i: '<span class="pi">+</span>' },
    ...[...PAGES, ...(S.me?.is_admin ? [["admin", "Admin"]] : [])].map((p) => ({ l: p[1], k: "Pages", go: () => (location.hash = p[0]), i: '<span class="pi">›</span>' })),
    ...S.agents.map((a) => ({ l: `${a.god} · ${a.name}`, k: "Teammates", go: () => (location.hash = "agent/" + a.key), i: `<img src="${IMG(a.key)}" alt="">` })),
    ...S.threads.map((t) => ({ l: t.title, k: "Chats", go: () => (location.hash = "chat/" + t.id), i: '<span class="pi">#</span>' })),
  ].filter((x) => !q || x.l.toLowerCase().includes(q));
  palItems = items; palSel = Math.min(palSel, Math.max(items.length - 1, 0));
  let html = "", last = "";
  items.forEach((x, i) => { if (x.k !== last) { html += `<h5>${x.k}</h5>`; last = x.k; } html += `<button data-pi="${i}" class="${i === palSel ? "on" : ""}">${x.i}${esc(x.l)}</button>`; });
  $("#palL").innerHTML = html || emptyHTML("No results", "Try another word.");
}
function openPal() { $("#pal").classList.add("on"); $("#palIn").value = ""; palSel = 0; renderPal(); setTimeout(() => $("#palIn").focus(), 20); }
function closePal() { $("#pal").classList.remove("on"); }
function runPal(i) { const x = palItems[i]; if (!x) return; closePal(); x.go(); }
document.addEventListener("click", (e) => { if (e.target.closest("[data-pal]")) openPal(); else if (e.target.id === "pal") closePal(); const b = e.target.closest("[data-pi]"); if (b) runPal(+b.dataset.pi); });
document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !$("#shell").hidden) { e.preventDefault(); $("#pal").classList.contains("on") ? closePal() : openPal(); } });
$("#palIn").addEventListener("input", () => { palSel = 0; renderPal(); });
$("#palIn").addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); palSel = (palSel + 1) % palItems.length; renderPal(); } else if (e.key === "ArrowUp") { e.preventDefault(); palSel = (palSel - 1 + palItems.length) % palItems.length; renderPal(); } else if (e.key === "Enter") { e.preventDefault(); runPal(palSel); } });
document.addEventListener("click", (e) => { if (!e.target.closest("[data-more]")) return; openDrawer("More", `<div class="card list">${[["routines", "Routines"], ["billing", "Billing"], ["settings", "Settings"], ...(S.me?.is_admin ? [["admin", "Admin"]] : [])].map((p) => `<a class="row" href="#${p[0]}" data-close><span class="main"><b>${p[1]}</b></span><svg class="ico sm" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></a>`).join("")}<button class="row" data-logout><span class="main"><b>Log out</b></span></button></div>`); });

// ---------- router ----------
function show(keepScroll) {
  if ($("#shell").hidden) return;
  let [v, arg] = (location.hash.slice(1).split("?")[0] || "home").split("/");
  if (!document.getElementById("v-" + v)) v = "home";
  if (v === "agent" && !AG[arg]) v = "team";
  $$(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
  const navV = v === "agent" ? "team" : v === "chat" ? "home" : v;
  $$("[data-v]").forEach((a) => { const on = a.dataset.v === navV || (a.dataset.v === "more" && ["routines", "billing", "settings", "admin"].includes(navV)); a.classList.toggle("on", on); if (a.tagName === "A") a.toggleAttribute("aria-current", on); });
  if (v !== "agent") window._agent = null;
  const run = { home: renderHome, approvals: renderApprovals, team: renderTeam, routines: renderRoutines, knowledge: renderKnowledge, billing: renderBilling, admin: renderAdmin, settings: renderSettings }[v];
  if (run) Promise.resolve(run()).catch((e) => toast(e.message));
  if (v === "agent") openAgent(arg).catch((e) => toast(e.message));
  if (v === "chat" && arg && +arg !== curThread) openThread(+arg);
  if (v === "chat" && !arg && !busy && !curThread) { location.hash = "home"; return; }
  if ($("#dw").classList.contains("on")) closeDrawer();
  if (!keepScroll && v !== "chat") window.scrollTo({ top: 0 });
  document.title = (v === "agent" ? AG[arg].god : v[0].toUpperCase() + v.slice(1)) + " · Morning Telos";
}
window.addEventListener("hashchange", () => show());
init();
