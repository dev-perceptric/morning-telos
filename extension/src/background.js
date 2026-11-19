// Morning Telos for Chrome: the background. Keeps this browser's sign-in (src/session.js), opens the side panel from
// the toolbar button, the shortcut and the right-click menu, and keeps the approvals count on the toolbar icon while
// signed in. It never reads a page by itself, never clicks or submits anything and never sends anything.

import { call } from "./api.js";
import { BADGE_COLOR, badgeText, badgeTitle } from "./badge.js";
import { origins, POLL_MINUTES } from "./config.js";
import { makeSession, validHandover } from "./session.js";

const session = makeSession({ storage: chrome.storage.local, fetch: (...a) => fetch(...a) });
const allowed = () => origins(chrome.runtime.getManifest());
const ALARM = "approvals";

// The toolbar button (and the Alt+Shift+J shortcut, which presses it) opens the side panel.
const panelOnClick = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => null);

const MENU = [
  { id: "ask", title: "Ask Morning Telos" },
  { id: "rewrite", title: "Rewrite this" },
  { id: "save", title: "Save to Knowledge" },
];

chrome.runtime.onInstalled.addListener(() => {
  panelOnClick();
  chrome.contextMenus.removeAll(() => {
    for (const m of MENU) chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ["selection"] });
  });
  void startPolling();
});
chrome.runtime.onStartup.addListener(() => {
  panelOnClick();
  void startPolling();
});

// Right-click on selected text: open the side panel first (Chrome only allows it right after the click), then leave
// the text for the panel, which checks the page and does the rest.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !MENU.some((m) => m.id === info.menuItemId)) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => null);
  void chrome.storage.session.set({
    pending: { kind: info.menuItemId, text: String(info.selectionText ?? "").slice(0, 5000), tabId: tab.id, url: tab.url || info.pageUrl || "", title: tab.title || "", at: Date.now() },
  });
});

/** The picked workspace, or the first one the person belongs to. */
async function workspaceId(auth) {
  const { workspaceId: picked } = await chrome.storage.local.get(["workspaceId"]);
  if (picked) return picked;
  const me = await call(fetch, auth, "/api/extension/me");
  const first = me.ok ? me.data.workspaces?.[0]?.id : null;
  if (first) await chrome.storage.local.set({ workspaceId: first });
  return first ?? null;
}

async function setBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => null);
  await chrome.action.setBadgeText({ text: badgeText(count) }).catch(() => null);
  await chrome.action.setTitle({ title: badgeTitle(count) }).catch(() => null);
}

/** Counts the approvals waiting in the picked workspace. Signed out, the badge is cleared and checking stops. */
async function updateBadge() {
  let auth = null;
  try {
    auth = await session.token();
  } catch {
    return;
  }
  if (!auth) {
    await chrome.alarms.clear(ALARM);
    return setBadge(0);
  }
  const ws = await workspaceId(auth);
  if (!ws) return setBadge(0);
  const r = await call(fetch, auth, `/api/extension/approvals?workspaceId=${encodeURIComponent(ws)}`);
  if (r.signedOut) {
    await session.clear();
    await chrome.alarms.clear(ALARM);
    return setBadge(0);
  }
  if (r.ok) await setBadge(r.data.count);
}

/** Checks once a minute, only while signed in. */
async function startPolling() {
  if (!(await session.read())) return setBadge(0);
  await chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES, delayInMinutes: 0.1 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void updateBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    // From the app's own page only (src/content-app.js): the session made by Connect this browser.
    if (msg?.type === "session") {
      const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
      const auth = sender.id === chrome.runtime.id && sender.tab ? validHandover(msg.handover, origin, allowed()) : null;
      if (!auth) return reply({ ok: false });
      await chrome.storage.local.remove(["workspaceId", "threads"]);
      await session.save(auth);
      await startPolling();
      void updateBadge();
      return reply({ ok: true });
    }
    // The rest come only from the side panel, an extension page, never from a content script on a web page.
    if (sender.id !== chrome.runtime.id || !String(sender.url ?? "").startsWith(chrome.runtime.getURL(""))) return reply({ error: "Not allowed." });
    if (msg?.type === "token") {
      try {
        return reply((await session.token()) ?? { signedOut: true });
      } catch (e) {
        return reply({ error: e instanceof Error ? e.message : "Something went wrong. Try again." });
      }
    }
    if (msg?.type === "signout") {
      await session.signOut();
      await chrome.alarms.clear(ALARM);
      await setBadge(0);
      return reply({ ok: true });
    }
    if (msg?.type === "badge") {
      await updateBadge();
      return reply({ ok: true });
    }
    reply({ error: "Unknown request." });
  })();
  return true;
});
