// How the Team page groups the teammates and what each card's status dot says. Ported from the old app's renderTeam
// (app/public/app.js CATS and st()). Pure: the screens and tests share it. Reads src/lib/team.ts, never changes it.

import { appsFor, directFor } from "./composio/catalog.ts";
import { AGENTS, type AgentKey } from "./team.ts";

/** The small colored badges for our own products, like the old app's SVC_ICON. */
export const PRODUCT_BADGE: Record<string, { label: string; color: string; name: string }> = {
  arrowsterr: { label: "SEO", color: "#d9a441", name: "SEO and AI visibility" },
  capybaroar: { label: "Soc", color: "#c084a7", name: "Social media" },
};

export type AgentStatus = { tone: "ok" | "wait" | "idle"; label: string };

/**
 * One teammate's status: Coming soon, Paused, Setting up (our product isn't ready yet), Connect an app (works through
 * the business's own apps and none is connected), or Working.
 */
export function agentStatus(k: AgentKey, s: { paused: boolean; services: Readonly<Record<string, string>>; connected: readonly string[] }): AgentStatus {
  const a = AGENTS[k];
  if (a.soon) return { tone: "idle", label: "Coming soon" };
  if (s.paused) return { tone: "idle", label: "Paused" };
  const products = a.apps.filter((p) => p !== "*");
  if (products.some((p) => s.services[p] !== "ready")) return { tone: "wait", label: "Setting up" };
  if (!products.length && !a.apps.includes("*")) {
    const tk = agentToolkits(k);
    if (tk.length && !tk.some((t) => s.connected.includes(t))) return { tone: "wait", label: "Connect an app" };
  }
  return { tone: "ok", label: "Working" };
}

/**
 * The business apps a teammate works in, for the logos on its card: its Composio apps, then the ones Morning Telos
 * connects itself (self-hosted WordPress). Athena reads all of them, so none are shown.
 */
export function agentToolkits(k: AgentKey): string[] {
  const a = AGENTS[k];
  if (a.apps.includes("*")) return [];
  return [...appsFor(k, Boolean(a.soon)).toolkits, ...directFor(k, Boolean(a.soon))];
}

