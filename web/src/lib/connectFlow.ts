// The connect flow's parts the screens share with the server: where a connect started, where it goes back to, which
// way it runs and what the return page shows. Pure and free of server imports (src/lib/partnerConnect.ts has the rest).
import type { Product } from "./partner.ts";
import { isAgentKey, type AgentKey } from "./team.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the partner sends the browser back to. One page for both products: the state says which. */
export const RETURN_PATH = "/settings/social/return";

// ─────────────── where the person started ───────────────

/** The screen a connect started from, so the return page can go back there. */
export type ConnectOrigin = { to: "settings" } | { to: "home" } | { to: "chat"; thread: string; agent: AgentKey | null };

/** The origin a screen sent, or Settings for anything we don't know. */
export function cleanOrigin(v: unknown): ConnectOrigin {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (o.to === "home") return { to: "home" };
  if (o.to === "chat" && typeof o.thread === "string" && UUID.test(o.thread)) return { to: "chat", thread: o.thread.toLowerCase(), agent: isAgentKey(o.agent) ? o.agent : null };
  return { to: "settings" };
}

/** The address to go back to: the product's Settings tab, Home, or the chat thread. */
export function originPath(from: ConnectOrigin, product: Product): string {
  if (from.to === "home") return "/";
  if (from.to === "chat") return `/chat/${from.thread}`;
  return product === "capybaroar" ? "/settings/social" : "/settings/apps";
}

/**
 * Which way to connect, from the partner's answer to the list (or the start): its own list means our page ("branded"),
 * a 404 means that product doesn't have the new calls yet ("link": the old connect page), anything else is a hiccup.
 */
export function connectMode(r: { ok: boolean; status: number }): "branded" | "link" | "down" {
  if (r.ok) return "branded";
  return r.status === 404 ? "link" : "down";
}

/** A 404 that isn't the partner's own error (no JSON body): the route isn't there, so it's an older product. */
export function missingRoute(r: { ok: boolean; status: number; code?: string }): boolean {
  return !r.ok && r.status === 404 && (r.code ?? "http_404") === "http_404";
}

/** The route and body that start a sign-in for a product's network or tool, from Settings, Home or the return page. */
export function startRequest(product: Product | undefined, workspaceId: string, item: string, from: ConnectOrigin): { path: string; body: Record<string, unknown> } {
  return product === "arrowsterr"
    ? { path: "/api/seo/connect/start", body: { workspaceId, integration: item, from } }
    : { path: "/api/social/connect/start", body: { workspaceId, network: item, from } };
}

/**
 * Where the sign-in opens. The old connect page and a chat open a new tab: the chat keeps waiting in this one and
 * carries on when the account shows up. Settings and Home go there and come back in the same tab.
 */
export function openIn(mode: "branded" | "link", from: ConnectOrigin): "tab" | "here" {
  return mode === "link" || from.to === "chat" ? "tab" : "here";
}

export type ReturnView =
  | { kind: "connected"; product: Product; item: string; name: string; title: string; back: string; chat: boolean; from: ConnectOrigin }
  | { kind: "pick"; product: Product; item: string; name: string; token: string; back: string; from: ConnectOrigin }
  /** retry: Try again can start the same sign-in from this page. */
  | { kind: "error"; product: Product; item: string; name: string; text: string; back: string; from: ConnectOrigin; retry: boolean };

/** The product SEO tools connect through. */
export const TOOLS_PRODUCT: Product = "arrowsterr";

/** SEO tools we have a logo and a line for (Settings, Apps). Others show their name only. */
export const TOOLS: Record<string, { logo: string; blurb: string }> = {
  cloudflare: { logo: "/img/tools/cloudflare.svg", blurb: "So Artemis can see which AI tools visit and read your site." },
};
