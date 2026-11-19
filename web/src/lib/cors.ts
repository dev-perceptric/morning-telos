// CORS for the routes the Chrome extension calls (extension/): /api/chat, /api/approvals/:id, /api/knowledge and
// /api/extension/*. Only the extension's own origin, chrome-extension://<id> for each id in EXTENSION_IDS, gets an
// Access-Control-Allow-Origin, and only that exact origin: never "*" and never credentials, because the extension
// signs in with a bearer token, not cookies. Another extension's origin is turned away. Pure: env comes in.

/** A Chrome extension id: 32 letters from a to p. */
const ID = /^[a-p]{32}$/;

/** The extension origins allowed, from EXTENSION_IDS (comma separated ids, like the store's and an unpacked one). */
export function extensionOrigins(raw: string | undefined = process.env.EXTENSION_IDS): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ID.test(s))
    .map((id) => `chrome-extension://${id}`);
}

const METHODS = "GET, POST, OPTIONS";
const HEADERS = "Authorization, Content-Type";

/** CORS headers for this request: the caller's origin when it is the extension's, else none. */
export function corsHeaders(origin: string | null, allowed: string[] = extensionOrigins()): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": METHODS, "Access-Control-Allow-Headers": HEADERS, "Access-Control-Max-Age": "600", Vary: "Origin" };
}

/** True when the call comes from a Chrome extension that isn't ours. Pages and the app itself are not affected. */
export const otherExtension = (origin: string | null, allowed: string[] = extensionOrigins()) => Boolean(origin?.startsWith("chrome-extension://")) && !allowed.includes(origin!);

/** The answer to a browser's preflight (OPTIONS). */
export function preflight(request: Request, allowed: string[] = extensionOrigins()): Response {
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
}

/** The same response with this request's CORS headers added. */
export function withCors(request: Request, res: Response, allowed: string[] = extensionOrigins()): Response {
  for (const [k, v] of Object.entries(corsHeaders(request.headers.get("origin"), allowed))) res.headers.set(k, v);
  return res;
}

/** A 403 for another extension, or null to carry on. */
export function refuseOtherExtension(request: Request, allowed: string[] = extensionOrigins()): Response | null {
  if (!otherExtension(request.headers.get("origin"), allowed)) return null;
  return Response.json({ error: "Not allowed." }, { status: 403, headers: { Vary: "Origin", "Cache-Control": "no-store" } });
}
