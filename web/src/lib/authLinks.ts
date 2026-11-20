// What an email link (confirm, magic link, invite, reset) brings back in the address, and a quick log out.
// Supabase Auth sends people back with one of three things: ?code= (the same browser that asked, which the client
// swaps for a session on its own), #access_token= (links made without that browser, such as a link opened on another
// device or an invite), or an error. The client here only takes ?code=, so the other two were dropped and people
// landed on Log in with no word. Pure, so tests check every shape.

export type LinkResult =
  | { kind: "tokens"; access_token: string; refresh_token: string }
  | { kind: "code" }
  | { kind: "error"; notice: string }
  | null;

export const LINK_NOTICES = {
  expired: "That link has expired. Log in, or ask for a new link.",
  failed: "That link didn't work. Log in to keep going.",
  // A ?code= link opened in a different browser: the email is confirmed, but this browser can't finish signing in.
  confirmed: "Your email is confirmed. Log in to keep going.",
};

/** What the address holds after an email link, or null for an ordinary page. */
export function readLink(hash: string, search: string): LinkResult {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const error = h.get("error") ?? q.get("error");
  if (error) {
    const code = h.get("error_code") ?? q.get("error_code") ?? "";
    return { kind: "error", notice: /expired/i.test(code) || /expired/i.test(h.get("error_description") ?? q.get("error_description") ?? "") ? LINK_NOTICES.expired : LINK_NOTICES.failed };
  }
  const access = h.get("access_token");
  const refresh = h.get("refresh_token");
  if (access && refresh) return { kind: "tokens", access_token: access, refresh_token: refresh };
  if (q.get("code")) return { kind: "code" };
  return null;
}

/** The address without the link's tokens, code or error, keeping the page and any other query. */
export function cleanLink(path: string, search: string): string {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  for (const k of ["code", "error", "error_code", "error_description"]) q.delete(k);
  const rest = q.toString();
  return path + (rest ? `?${rest}` : "");
}

type Fetch = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Logs out at once on this device, then tells Supabase Auth to end the session in the background. Waiting for Auth
 * first left people on a frozen screen for several seconds.
 */
export async function quickSignOut(
  auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }>; signOut: (o: { scope: "local" }) => Promise<unknown> },
  o: { url: string; key: string; fetch?: Fetch },
): Promise<void> {
  const token = (await auth.getSession()).data.session?.access_token;
  await auth.signOut({ scope: "local" });
  if (!token || !o.url) return;
  const send = o.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
  void Promise.resolve()
    .then(() => send(`${o.url.replace(/\/+$/, "")}/auth/v1/logout?scope=global`, { method: "POST", keepalive: true, headers: { apikey: o.key, Authorization: `Bearer ${token}` } }))
    .catch(() => {});
}
