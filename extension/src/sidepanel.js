// The side panel: chat with the team, approvals and settings. It reads the open tab only when the person clicks
// (Use this page, a quick action, Draft a reply, Save this page, or a right-click item), never in the background,
// and never a page on the block list or with a password box (src/guard.js, src/page.js). It never clicks, submits
// or sends anything on a page: "Put in reply box" only types the draft into Gmail's box for the person to send.
// Every element is built with textContent, so nothing a page or a reply says can run as HTML.

import { call } from "./api.js";
import { chatBody, inlineParts, plainReply, readLines } from "./chat.js";
import { CONNECT_PATH, LIMITS, PRIVACY_URL, SHOT_MAX } from "./config.js";
import { hasReplyBox, insertReply, pickReplyAgent, readEmail } from "./gmail.js";
import { BLOCK_LINES, blockReason } from "./guard.js";
import { peekPage, readPage } from "./page.js";
import { domainOf, draftMessage, QUICK, quickMessage, REWRITE } from "./quick.js";
import { AGENTS, byKey, insertMention, mentionMatches, mentionQuery } from "./team.js";

const NEED_CLICK = "Chrome needs a click first. Press the Morning Telos button in the toolbar while on this page, then try again.";
const GMAIL = "https://mail.google.com/";

const S = {
  signedIn: false,
  auth: null,
  me: null,
  ws: null,
  tab: "chat",
  threadId: null,
  items: [],
  status: "",
  busy: false,
  attached: null,
  shotWanted: false,
  shot: null,
  approvals: [],
  line: { text: "", tone: "" },
  gmail: { tabId: null, box: false },
  mention: { open: false, list: [], at: 0 },
  draft: "",
};

// ─────────────── talking to the background and the app ───────────────

const ask = (msg) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { error: "Something went wrong. Try again." }));
  });

async function token() {
  const r = await ask({ type: "token" });
  if (r.signedOut) return null;
  if (r.error) throw new Error(r.error);
  return r;
}

/** A call to the app as this browser. A 401 means the session is gone: sign out here too. */
async function api(path, opts = {}) {
  const auth = await token().catch((e) => ({ error: e.message }));
  if (!auth) return signedOut();
  if (auth.error) return { ok: false, error: auth.error };
  S.auth = auth;
  const r = await call(fetch, auth, path, opts);
  if (r.signedOut) return signedOut();
  return r;
}

async function signedOut() {
  await ask({ type: "signout" });
  S.signedIn = false;
  render();
  return { ok: false, error: "Sign in to Morning Telos again." };
}

const say = (text, tone = "") => {
  S.line = { text, tone };
  render();
};

// ─────────────── drawing ───────────────

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
function icon(paths) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "ico");
  s.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}
const ICONS = {
  open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  plus: ["M12 5v14", "M5 12h14"],
  send: ["M5 12h14", "M13 6l6 6-6 6"],
  x: ["M6 6l12 12", "M18 6 6 18"],
};

function logo() {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 28 20");
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("fill", "#D97757");
  for (const [x, y, w, hh] of [[8, 0, 12, 4], [4, 4, 20, 4], [0, 8, 28, 4], [0, 16, 28, 4]]) {
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("x", x);
    r.setAttribute("y", y);
    r.setAttribute("width", w);
    r.setAttribute("height", hh);
    g.append(r);
  }
  s.append(g);
  return h("span", { class: "logo", "aria-hidden": "true" }, s);
}

/** Text with **bold** and @tags, as text nodes only. */
function richText(text) {
  const out = [];
  for (const part of inlineParts(String(text))) {
    const pieces = part.text.split(/(@(?:Alexander|Midas|Irene|Cleo|Cyrus|Leo|Theseus|Archon)\b)/);
    const nodes = pieces.map((p, i) => (i % 2 ? h("span", { class: "mention", text: p }) : document.createTextNode(p)));
    out.push(part.bold ? h("b", {}, nodes) : nodes);
  }
  return out.flat();
}

const face = (key) => h("img", { class: "av", alt: "", src: `${S.auth?.app ?? ""}/img/agents/${key}-f.webp`, onerror: (e) => e.target.classList.add("gone") });
const appUrl = (path = "") => `${S.auth?.app ?? "https://chat.morningtelos.com"}${path}`;

function render() {
  const root = document.getElementById("app");
  const keep = document.activeElement?.id === "box" ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  root.replaceChildren(S.signedIn ? signedInView() : welcomeView());
  const box = document.getElementById("box");
  if (box && keep) {
    box.focus();
    box.setSelectionRange(keep.start, keep.end);
  }
  const scroller = document.querySelector(".scroll.chat");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function welcomeView() {
  return h(
    "div",
    { class: "welcome" },
    logo(),
    h("h1", { text: "Your AI team, next to every page" }),
    h("p", { text: "Sign in on chat.morningtelos.com. If you are already signed in there, it takes one click. The extension never asks for your password." }),
    h("button", { class: "btn primary full", type: "button", onclick: () => chrome.tabs.create({ url: appUrl(CONNECT_PATH) }) }, "Sign in"),
    S.line.text ? h("p", { class: `line ${S.line.tone}`, text: S.line.text }) : null,
  );
}

function signedInView() {
  const wsName = S.ws?.name ?? "Morning Telos";
  const threadLink = S.threadId ? appUrl(`/chat/${S.threadId}`) : appUrl("/");
  const top = h(
    "div",
    { class: "top" },
    logo(),
    h("div", { class: "grow" }, h("b", { text: wsName }), h("small", { text: S.me?.email ?? "" })),
    h("a", { class: "icon-btn", href: threadLink, target: "_blank", rel: "noopener", title: "Open in Morning Telos", "aria-label": "Open in Morning Telos" }, icon(ICONS.open)),
  );
  const tab = (id, label, extra) =>
    h("button", { type: "button", role: "tab", "aria-selected": S.tab === id ? "true" : "false", onclick: () => switchTab(id) }, label, extra ?? null);
  const tabs = h(
    "div",
    { class: "tabs", role: "tablist" },
    tab("chat", "Chat"),
    tab("approvals", "Approvals", S.approvals.length ? h("span", { class: "count", text: String(S.approvals.length) }) : null),
    tab("settings", "Settings"),
  );
  const view = S.tab === "approvals" ? approvalsView() : S.tab === "settings" ? settingsView() : chatView();
  return h("div", { class: "view" }, top, tabs, view);
}

// ─────────────── chat ───────────────

function chatView() {
  const list = h("div", { class: "msgs" });
  if (!S.items.length)
    list.append(
      h("div", { class: "empty" }, h("h2", { text: "Ask your team" }), h("p", { text: "Type @ to tag a teammate, or use the page you're on." })),
    );
  for (const it of S.items) list.append(itemView(it));
  if (S.status) list.append(h("div", { class: "status", text: S.status }));

  const quick = h(
    "div",
    { class: "chips" },
    S.gmail.box ? h("button", { type: "button", class: "chip main", disabled: S.busy, onclick: draftReply }, "Draft a reply") : null,
    h("button", { type: "button", class: "chip", disabled: S.busy, onclick: () => usePage() }, "Use this page"),
    ...QUICK.map((q) => h("button", { type: "button", class: "chip", disabled: S.busy, onclick: () => quickAction(q.id) }, q.label)),
    h("button", { type: "button", class: "chip", disabled: S.busy, onclick: savePage }, "Save this page to Knowledge"),
  );

  const attach = S.attached
    ? h(
        "div",
        { class: "attach" },
        h(
          "div",
          { class: "grow" },
          h("b", { text: S.attached.kind === "selection" ? "Selected text" : S.attached.kind === "email" ? "Email" : "Page" }),
          h("small", { text: S.attached.title || S.attached.url }),
          S.attached.cut ? h("small", { text: "Long page: only the first part is attached." }) : null,
          S.attached.kind !== "selection"
            ? h(
                "label",
                {},
                h("input", { type: "checkbox", checked: S.shotWanted, onchange: (e) => toggleShot(e.target.checked) }),
                "Add a screenshot",
              )
            : null,
        ),
        h("button", { type: "button", class: "x", "aria-label": "Remove", title: "Remove", onclick: () => ((S.attached = null), (S.shot = null), (S.shotWanted = false), render()) }, icon(ICONS.x)),
      )
    : null;

  const box = h("textarea", {
    id: "box",
    rows: "2",
    placeholder: "Message your team. Type @ to tag someone.",
    "aria-label": "Message",
    disabled: S.busy,
    oninput: (e) => {
      S.draft = e.target.value;
      updateMentions(e.target);
    },
    onkeydown: onKey,
  });
  box.value = S.draft;
  const pop = S.mention.open
    ? h(
        "div",
        { class: "mpop", role: "listbox" },
        S.mention.list.map((k, i) =>
          h(
            "button",
            { type: "button", class: i === S.mention.at ? "on" : "", role: "option", onmousedown: (e) => (e.preventDefault(), pickMention(k)) },
            face(k),
            h("span", {}, byKey(k).god, h("small", { text: byKey(k).name })),
          ),
        ),
      )
    : null;
  const composer = h(
    "div",
    { class: "composer" },
    pop,
    box,
    h(
      "div",
      { class: "ctools" },
      h("small", { text: S.threadId ? "" : "New chat" }),
      S.threadId ? h("button", { type: "button", class: "btn sm", onclick: newChat }, icon(ICONS.plus), "New chat") : null,
      h("button", { type: "button", class: "send", "aria-label": "Send", title: "Send", disabled: S.busy, onclick: () => sendTyped() }, icon(ICONS.send)),
    ),
  );
  return h(
    "div",
    { class: "view" },
    h("div", { class: "scroll chat" }, list),
    h("div", { class: "dock" }, quick, S.line.text ? h("p", { class: `line ${S.line.tone}`, role: "status", text: S.line.text }) : null, h("div", { class: "mt" }, attach, composer)),
  );
}

function itemView(it) {
  if (it.kind === "user")
    return h(
      "div",
      { class: "msg me" },
      h("div", { class: "bubble" }, richText(it.text), it.page ? h("small", { text: `From a page: ${it.page.title || it.page.url}` }) : null),
    );
  if (it.kind === "note") return h("div", { class: "note", text: it.text });
  if (it.kind === "approval")
    return h(
      "div",
      { class: "ap" },
      h("div", { class: "grow" }, h("b", { text: "Waiting for your OK: " }), it.title),
      h("button", { type: "button", class: "btn sm", onclick: () => switchTab("approvals") }, "Review"),
    );
  const a = byKey(it.agent);
  const wrap = h(
    "div",
    {},
    h("div", { class: `msg${it.error ? " err" : ""}` }, face(a.key), h("div", { class: "body" }, h("div", { class: "who" }, a.god, h("span", { text: ` ${a.name}` })), richText(it.text))),
  );
  if (it.draftTab && !it.error)
    wrap.append(h("div", { class: "put" }, h("button", { type: "button", class: "btn sm primary", onclick: () => putInReplyBox(it) }, "Put in reply box")));
  return wrap;
}

function onKey(e) {
  if (S.mention.open) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = S.mention.list.length;
      S.mention.at = (S.mention.at + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      return render();
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      return pickMention(S.mention.list[S.mention.at]);
    }
    if (e.key === "Escape") {
      S.mention.open = false;
      return render();
    }
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void sendTyped();
  }
}

function updateMentions(box) {
  const q = mentionQuery(box.value.slice(0, box.selectionStart));
  const list = q === null ? [] : mentionMatches(q);
  const open = list.length > 0;
  if (open !== S.mention.open || list.join() !== S.mention.list.join()) {
    S.mention = { open, list, at: 0 };
    render();
  }
}

function pickMention(key) {
  const box = document.getElementById("box");
  const out = insertMention(box.value, box.selectionStart, key);
  S.draft = out.text;
  S.mention = { open: false, list: [], at: 0 };
  render();
  const b = document.getElementById("box");
  b.focus();
  b.setSelectionRange(out.cursor, out.cursor);
}

function newChat() {
  S.threadId = null;
  S.items = [];
  S.line = { text: "", tone: "" };
  void saveThread();
  render();
}

async function saveThread() {
  if (!S.ws) return;
  const { threads = {} } = await chrome.storage.local.get(["threads"]);
  if (S.threadId) threads[S.ws.id] = S.threadId;
  else delete threads[S.ws.id];
  await chrome.storage.local.set({ threads });
}

async function loadThread() {
  S.items = [];
  const { threads = {} } = await chrome.storage.local.get(["threads"]);
  S.threadId = S.ws ? (threads[S.ws.id] ?? null) : null;
  if (!S.threadId) return;
  const r = await api(`/api/extension/thread?workspaceId=${encodeURIComponent(S.ws.id)}&id=${encodeURIComponent(S.threadId)}`);
  if (!r.ok) {
    S.threadId = null;
    return;
  }
  for (const m of r.data.messages) {
    if (m.role === "user") S.items.push({ kind: "user", text: m.content, page: m.page });
    else if (m.role === "note") S.items.push({ kind: "note", text: m.content.split(":")[0] });
    else {
      S.items.push({ kind: "agent", agent: AGENTS.some((a) => a.key === m.agent) ? m.agent : "chief", text: m.content, error: m.error });
      for (const ap of m.approvals) if (typeof ap?.id === "number") S.items.push({ kind: "approval", id: ap.id, title: String(ap.title ?? "A change") });
    }
  }
}

async function sendTyped() {
  const text = S.draft.trim();
  if (!text) return;
  S.draft = "";
  await send(text, { page: S.attached });
}

/** Sends one message, with the attached page when there is one, and shows the team's replies as they arrive. */
async function send(text, { page = null, draftTab = null } = {}) {
  if (S.busy || !S.ws) return;
  S.busy = true;
  S.line = { text: "", tone: "" };
  S.items.push({ kind: "user", text, page: page ? { url: page.url, title: page.title } : null });
  const screenshot = page && S.shotWanted ? S.shot : null;
  S.attached = null;
  S.shot = null;
  S.shotWanted = false;
  S.status = "Sending";
  render();
  let waiting = [];
  try {
    const auth = await token();
    if (!auth) return void signedOut();
    S.auth = auth;
    const res = await fetch(`${auth.app}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(chatBody({ workspaceId: S.ws.id, text, threadId: S.threadId, page, screenshot })),
      credentials: "omit",
    }).catch(() => null);
    if (!res) throw new Error("Couldn't reach Morning Telos. Check your connection and try again.");
    if (res.status === 401) return void signedOut();
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "Something went wrong. Try again.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const onEvent = (e) => {
      if (e.type === "thread") {
        S.threadId = e.id;
        void saveThread();
      } else if (e.type === "status") S.status = `${byKey(e.agent).god} is ${String(e.text).toLowerCase()}`;
      else if (e.type === "tool") S.status = `${byKey(e.agent).god}: ${e.text}`;
      else if (e.type === "handoff") S.items.push({ kind: "note", text: `${byKey(e.from).god} handed this to ${byKey(e.to).god}` });
      else if (e.type === "approval") waiting.push({ kind: "approval", id: e.id, title: e.title });
      else if (e.type === "message") {
        S.items.push({ kind: "agent", agent: e.agent, text: e.text, error: Boolean(e.error || e.blocked), draftTab });
        S.items.push(...waiting);
        waiting = [];
        S.status = "";
      }
      render();
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const out = readLines(buffer);
      buffer = out.rest;
      out.events.forEach(onEvent);
    }
    readLines(`${buffer}\n`).events.forEach(onEvent);
  } catch (e) {
    S.line = { text: e instanceof Error ? e.message : "Something went wrong. Try again.", tone: "bad" };
  } finally {
    S.items.push(...waiting);
    S.busy = false;
    S.status = "";
    render();
    void ask({ type: "badge" }).then(loadApprovals);
  }
}

// ─────────────── reading the open tab, on a click ───────────────

const activeTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null;

async function run(tabId, func, args = []) {
  const [first] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return first?.result;
}

/**
 * Reads the tab the person is on. First only its address and whether it has a password box; the words are read only
 * when both checks pass. Returns { page, tab } or { error }.
 */
async function readTab() {
  const tab = await activeTab();
  if (!tab?.id) return { error: "Open a page first." };
  if (tab.url && blockReason(tab.url)) return { error: BLOCK_LINES[blockReason(tab.url)] };
  let peek;
  try {
    peek = await run(tab.id, peekPage);
  } catch {
    return { error: NEED_CLICK };
  }
  if (!peek) return { error: NEED_CLICK };
  const reason = blockReason(peek.url);
  if (reason) return { error: BLOCK_LINES[reason] };
  if (peek.password) return { error: BLOCK_LINES.password };
  const gmail = peek.url.startsWith(GMAIL);
  let page;
  try {
    page = await run(tab.id, gmail ? readEmail : readPage, [LIMITS]);
  } catch {
    return { error: NEED_CLICK };
  }
  if (!page || page.blocked) return { error: BLOCK_LINES.password };
  if (!page.text && !page.selection) return { error: "This page has no text to attach." };
  return { page: { ...page, kind: gmail ? "email" : "page" }, tab };
}

/** A screenshot of the visible tab, made small enough to send, or null. */
async function screenshot(windowId) {
  const raw = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
  const img = await createImageBitmap(await (await fetch(raw)).blob());
  for (const [width, quality] of [[1280, 0.7], [1024, 0.55], [800, 0.45]]) {
    const scale = Math.min(1, width / img.width);
    const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    const url = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
    if (url.length - url.indexOf(",") - 1 <= SHOT_MAX) return url;
  }
  return null;
}

async function usePage() {
  const r = await readTab();
  if (r.error) return say(r.error, "bad");
  S.attached = r.page;
  S.attachedWindow = r.tab.windowId;
  S.shot = null;
  S.shotWanted = false;
  say("");
  document.getElementById("box")?.focus();
}

async function toggleShot(on) {
  S.shotWanted = on;
  if (!on) {
    S.shot = null;
    return render();
  }
  try {
    const tab = await activeTab();
    if (!tab || tab.windowId !== S.attachedWindow) throw new Error("tab");
    S.shot = await screenshot(tab.windowId);
    if (!S.shot) throw new Error("size");
    say("");
  } catch {
    S.shotWanted = false;
    S.shot = null;
    say("Couldn't take a screenshot of this page. Send it without one.", "bad");
  }
}

async function quickAction(id) {
  const r = await readTab();
  if (r.error) return say(r.error, "bad");
  await send(quickMessage(id, r.page), { page: r.page });
}

async function savePage() {
  const r = await readTab();
  if (r.error) return say(r.error, "bad");
  await saveToKnowledge({ title: r.page.title || domainOf(r.page.url), body: r.page.text, sourceUrl: r.page.url });
}

async function saveToKnowledge({ title, body, sourceUrl }) {
  if (!S.ws) return;
  say("Saving to Knowledge");
  const r = await api("/api/knowledge", { method: "POST", body: { workspaceId: S.ws.id, title, body, sourceUrl } });
  say(r.ok ? "Saved to Knowledge. Your team reads it from now on." : r.error, r.ok ? "ok" : "bad");
}

// ─────────────── Gmail ───────────────

async function draftReply() {
  const r = await readTab();
  if (r.error) return say(r.error, "bad");
  if (r.page.kind !== "email") return say("Open the email in Gmail first.", "bad");
  const typed = S.draft.trim();
  const agent = pickReplyAgent(r.page, typed);
  S.draft = "";
  const extra = typed ? `\n\n${typed}` : "";
  await send(`${draftMessage(agent)}${extra}`, { page: r.page, draftTab: r.tab.id });
}

async function putInReplyBox(it) {
  try {
    const out = await run(it.draftTab, insertReply, [plainReply(it.text)]);
    say(out?.ok ? "Added to the reply box. Read it, then send it yourself." : (out?.error ?? "Open a reply box in Gmail first."), out?.ok ? "ok" : "bad");
  } catch {
    say("Open the Gmail tab with the reply box, then try again.", "bad");
  }
}

/** While the panel is open and Gmail is the tab in front, look every 2 seconds for an open reply box. Reads nothing else. */
async function watchGmail() {
  if (document.visibilityState !== "visible" || !S.signedIn) return;
  const tab = await activeTab().catch(() => null);
  let box = false;
  if (tab?.id && tab.url?.startsWith(GMAIL)) box = Boolean(await run(tab.id, hasReplyBox).catch(() => false));
  if (box !== S.gmail.box) {
    S.gmail = { tabId: box ? tab.id : null, box };
    if (S.tab === "chat") render();
  }
}

// ─────────────── right-click items ───────────────

async function handlePending() {
  await booting;
  const { pending } = await chrome.storage.session.get(["pending"]);
  if (!pending) return;
  await chrome.storage.session.remove(["pending"]);
  if (Date.now() - pending.at > 120_000) return;
  if (!S.signedIn) return say("Sign in first, then try again.", "bad");
  const reason = blockReason(pending.url);
  if (reason) return say(BLOCK_LINES[reason], "bad");
  let peek = null;
  try {
    peek = await run(pending.tabId, peekPage);
  } catch {
    peek = null;
  }
  if (!peek) return say(NEED_CLICK, "bad");
  if (blockReason(peek.url)) return say(BLOCK_LINES[blockReason(peek.url)], "bad");
  if (peek.password) return say(BLOCK_LINES.password, "bad");
  const page = { kind: "selection", url: peek.url, title: pending.title, text: "", selection: pending.text };
  S.tab = "chat";
  if (pending.kind === "save") return saveToKnowledge({ title: `Selected from ${pending.title || domainOf(peek.url)}`.slice(0, 200), body: pending.text, sourceUrl: peek.url });
  if (pending.kind === "rewrite") return send(REWRITE, { page });
  S.attached = page;
  say("");
  document.getElementById("box")?.focus();
}

// ─────────────── approvals ───────────────

async function loadApprovals() {
  if (!S.ws) return;
  const r = await api(`/api/extension/approvals?workspaceId=${encodeURIComponent(S.ws.id)}`);
  if (r.ok) S.approvals = r.data.approvals;
  render();
}

async function decide(ap, action) {
  const r = await api(`/api/approvals/${ap.id}`, { method: "POST", body: { workspaceId: S.ws.id, action } });
  if (!r.ok) return say(r.error, "bad");
  say(action === "deny" ? "Denied. Nothing was changed." : r.data.status === "failed" ? "Approved, but it didn't work. Open it in Morning Telos to see why." : "Approved and done.", r.data.status === "failed" ? "bad" : "ok");
  await ask({ type: "badge" });
  await loadApprovals();
}

function approvalsView() {
  const list = h("div", {});
  if (!S.approvals.length) list.append(h("div", { class: "empty" }, h("h2", { text: "All caught up" }), h("p", { text: "Nothing is waiting for your OK." })));
  for (const ap of S.approvals) {
    const a = byKey(ap.agent);
    list.append(
      h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, face(a.key), h("div", { class: "grow" }, h("b", { text: ap.title }), h("div", { class: "meta", text: `From ${a.god}` }))),
        ap.why ? h("p", { class: "why", text: ap.why }) : null,
        h(
          "div",
          { class: "row mt" },
          h("button", { type: "button", class: "btn sm primary", onclick: (e) => ((e.target.disabled = true), decide(ap, "approve")) }, "Approve"),
          h("button", { type: "button", class: "btn sm", onclick: (e) => ((e.target.disabled = true), decide(ap, "deny")) }, "Deny"),
          h("a", { class: "btn sm", href: appUrl(`/approvals/${ap.id}`), target: "_blank", rel: "noopener" }, "Open in Morning Telos"),
        ),
      ),
    );
  }
  return h("div", { class: "scroll" }, S.line.text ? h("p", { class: `line ${S.line.tone}`, role: "status", text: S.line.text }) : null, list);
}

// ─────────────── settings ───────────────

function settingsView() {
  const wsPick =
    (S.me?.workspaces ?? []).length > 1
      ? h(
          "select",
          { class: "sel", "aria-label": "Workspace", onchange: (e) => pickWorkspace(e.target.value) },
          S.me.workspaces.map((w) => h("option", { value: w.id, selected: w.id === S.ws?.id, text: w.name })),
        )
      : h("p", { text: S.ws?.name ?? "" });
  return h(
    "div",
    { class: "scroll" },
    h("div", { class: "card" }, h("p", { class: "sh", text: "Account" }), h("p", { text: S.me?.email ?? "" }), h("p", { class: "hint", text: `Your role: ${S.ws?.role ?? ""}` })),
    h("div", { class: "card" }, h("p", { class: "sh", text: "Workspace" }), wsPick),
    h(
      "div",
      { class: "card" },
      h("p", { class: "sh", text: "Shortcut" }),
      h("p", { text: "Alt+Shift+J opens Morning Telos." }),
      h("button", { type: "button", class: "btn sm mt", onclick: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }) }, "Change shortcut"),
    ),
    h(
      "div",
      { class: "card" },
      h("p", { class: "sh", text: "Privacy" }),
      h("p", { class: "hint", text: "The extension reads a page only when you click, never in the background. It never reads pages with a password box, bank pages or Chrome's own pages. It never clicks, submits or sends anything." }),
      h("a", { class: "btn sm mt", href: PRIVACY_URL, target: "_blank", rel: "noopener" }, "Read the privacy note"),
    ),
    h("div", { class: "row mt" }, h("button", { type: "button", class: "btn", onclick: signOut }, "Sign out"), h("span", { class: "hint", text: `Version ${chrome.runtime.getManifest().version}` })),
  );
}

async function pickWorkspace(id) {
  S.ws = S.me.workspaces.find((w) => w.id === id) ?? S.ws;
  await chrome.storage.local.set({ workspaceId: S.ws.id });
  await loadThread();
  await ask({ type: "badge" });
  await loadApprovals();
}

async function signOut() {
  await ask({ type: "signout" });
  Object.assign(S, { signedIn: false, me: null, ws: null, items: [], threadId: null, approvals: [], attached: null, shot: null, line: { text: "Signed out.", tone: "" } });
  render();
}

function switchTab(id) {
  S.tab = id;
  S.line = { text: "", tone: "" };
  render();
  if (id === "approvals") void loadApprovals();
}

// ─────────────── start ───────────────

let booting = null;

async function boot() {
  const auth = await token().catch(() => null);
  if (!auth) {
    S.signedIn = false;
    return render();
  }
  S.auth = auth;
  const me = await call(fetch, auth, "/api/extension/me");
  if (!me.ok) {
    if (me.signedOut) return void signedOut();
    S.signedIn = false;
    return say(me.error, "bad");
  }
  S.signedIn = true;
  S.me = me.data;
  const { workspaceId } = await chrome.storage.local.get(["workspaceId"]);
  S.ws = S.me.workspaces.find((w) => w.id === workspaceId) ?? S.me.workspaces[0] ?? null;
  if (!S.ws) {
    render();
    return say("You aren't in a workspace yet. Open Morning Telos to set one up.", "bad");
  }
  await chrome.storage.local.set({ workspaceId: S.ws.id });
  await loadThread();
  render();
  void loadApprovals();
  setTimeout(() => void handlePending(), 0);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.auth && Boolean(changes.auth.newValue) !== Boolean(changes.auth.oldValue)) booting = boot();
  if (area === "session" && changes.pending?.newValue) void handlePending();
});
setInterval(() => void watchGmail(), 2000);
render();
booting = boot();
