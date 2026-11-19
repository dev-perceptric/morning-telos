// How Settings, Chrome extension hands this browser's own session to the Morning Telos extension, the way
// Omniscient's Settings hands over its token (content-app.js). Pure, shared by the screen and tests.
//
// The extension's content script runs only on the app's own address (extension/src/content-app.js). It marks the
// page with data-morningtelos-extension="1", takes a HANDOVER message posted by this same page, passes it to the
// extension, and posts CONNECTED back. tests/extension-sync.test.ts checks the extension uses the same names.

export const EXTENSION_MARK = "morningtelosExtension";
export const HANDOVER = "morningtelos-extension-session";
export const CONNECTED = "morningtelos-extension-connected";

export type ConnectAnswer = {
  session: { access_token: string; refresh_token: string; expires_at: number };
  supabaseUrl: string;
  publishableKey: string;
  app: string;
};

/** The message the page posts to the extension, from POST /api/extension/connect's answer. Null when it's not whole. */
export function handoverMessage(out: Partial<ConnectAnswer> | null | undefined) {
  const s = out?.session;
  if (!s || typeof s.access_token !== "string" || typeof s.refresh_token !== "string" || typeof s.expires_at !== "number") return null;
  if (typeof out?.supabaseUrl !== "string" || typeof out?.publishableKey !== "string" || typeof out?.app !== "string") return null;
  return { type: HANDOVER, session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }, supabaseUrl: out.supabaseUrl, publishableKey: out.publishableKey, app: out.app };
}

/** True for the extension's answer that it took the session. */
export const isConnected = (data: unknown) => Boolean(data && typeof data === "object" && (data as { type?: unknown }).type === CONNECTED && (data as { ok?: unknown }).ok === true);
