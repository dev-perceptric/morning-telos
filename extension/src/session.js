// This browser's sign-in to Morning Telos. The person signs in on chat.morningtelos.com (they are already signed in
// there): Settings, Chrome extension, Connect this browser makes the browser a session of its own and hands it over on
// that page only (src/content-app.js). The extension never asks for a password.
//
// The session lives in chrome.storage.local, in this extension only. The access token is refreshed with Supabase the
// way the app does (POST /auth/v1/token?grant_type=refresh_token), a minute before it runs out, one refresh at a time.
// Sign out tells Supabase to end this browser's session and clears everything stored.
//
// Pure: storage and fetch come in, so tests use fakes.

export const KEYS = ["auth", "workspaceId", "threads"];

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const KEY = /^(sb_publishable_[A-Za-z0-9_-]{10,200}|eyJ[A-Za-z0-9_.-]{20,1000})$/;

/**
 * The handover from the app's page, checked: it must come from the app's own address (the content script's tab), with
 * a whole session for an allowed Supabase address. Returns what to store, or null.
 */
export function validHandover(h, senderOrigin, { apps, dbs }) {
  if (!h || typeof h !== "object" || !apps.includes(senderOrigin) || h.app !== senderOrigin) return null;
  const s = h.session;
  if (!s || typeof s.access_token !== "string" || !JWT.test(s.access_token) || s.access_token.length > 8000) return null;
  if (typeof s.refresh_token !== "string" || !/^[A-Za-z0-9._-]{6,500}$/.test(s.refresh_token)) return null;
  if (typeof s.expires_at !== "number" || !Number.isFinite(s.expires_at)) return null;
  if (typeof h.supabaseUrl !== "string" || !dbs.includes(h.supabaseUrl.replace(/\/+$/, ""))) return null;
  if (typeof h.publishableKey !== "string" || !KEY.test(h.publishableKey)) return null;
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
    supabaseUrl: h.supabaseUrl.replace(/\/+$/, ""),
    publishableKey: h.publishableKey,
    app: senderOrigin,
  };
}

/** True when the access token runs out within a minute. `expires_at` is in seconds, like Supabase's. */
export const needsRefresh = (auth, now = Date.now()) => !auth || auth.expires_at * 1000 - now < 60_000;

/** The signed-in state for one extension: storage is chrome.storage.local (or a fake). */
export function makeSession({ storage, fetch, now = () => Date.now() }) {
  let refreshing = null;

  const read = async () => (await storage.get(["auth"])).auth ?? null;

  async function save(auth) {
    await storage.set({ auth });
  }

  async function clear() {
    await storage.remove(KEYS);
  }

  async function refresh(auth) {
    let res;
    try {
      res = await fetch(`${auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: auth.publishableKey },
        body: JSON.stringify({ refresh_token: auth.refresh_token }),
      });
    } catch {
      throw new Error("Couldn't reach Morning Telos. Check your connection and try again.");
    }
    const out = await res.json().catch(() => ({}));
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // The session ended (signed out elsewhere, or the person was removed): sign this browser out too.
      await clear();
      return null;
    }
    if (!res.ok || typeof out.access_token !== "string" || typeof out.refresh_token !== "string") throw new Error("Morning Telos is busy. Try again in a moment.");
    const next = { ...auth, access_token: out.access_token, refresh_token: out.refresh_token, expires_at: typeof out.expires_at === "number" ? out.expires_at : Math.floor(now() / 1000) + (out.expires_in ?? 3600) };
    await save(next);
    return next;
  }

  return {
    read,
    save,
    /** A fresh access token and the app address, or null when signed out. Refreshes once even when asked twice. */
    async token() {
      const auth = await read();
      if (!auth) return null;
      if (!needsRefresh(auth, now())) return { token: auth.access_token, app: auth.app };
      refreshing ??= refresh(auth).finally(() => (refreshing = null));
      const next = await refreshing;
      return next ? { token: next.access_token, app: next.app } : null;
    },
    /** Ends this browser's session with Supabase (never the app's own) and clears everything stored. */
    async signOut() {
      const auth = await read();
      if (auth) {
        await fetch(`${auth.supabaseUrl}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: auth.publishableKey, Authorization: `Bearer ${auth.access_token}` } }).catch(() => null);
      }
      await clear();
    },
    clear,
  };
}
