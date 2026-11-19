// Calls to the app (chat.morningtelos.com) with this browser's bearer token. A read that hits a hiccup (busy, a server
// error or no connection) is tried again with growing waits, like Omniscient's background.js. A change (send,
// approve, save) is never sent twice. Pure: fetch, the token and the wait come in.

const HICCUP = (s) => s === 429 || s >= 500;

/**
 * One call. `auth` is { token, app }. Returns { ok: true, data } or { ok: false, status, error, signedOut }.
 * `signedOut` is true for a 401: the session is gone.
 */
export async function call(fetch, auth, path, { method = "GET", body, tries = method === "GET" ? 3 : 1, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!auth?.token) return { ok: false, status: 401, error: "Sign in to Morning Telos first.", signedOut: true };
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(`${auth.app}${path}`, {
        method,
        headers: { Authorization: `Bearer ${auth.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
      });
    } catch {
      if (i + 1 < tries) {
        await wait(600 * 2 ** i);
        continue;
      }
      return { ok: false, status: 0, error: "Couldn't reach Morning Telos. Check your connection and try again." };
    }
    if (HICCUP(res.status) && i + 1 < tries) {
      await wait(600 * 2 ** i);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    return { ok: false, status: res.status, error: data.error || "Something went wrong. Try again.", signedOut: res.status === 401 };
  }
}
