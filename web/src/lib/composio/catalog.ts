// The apps a customer can connect on Settings, Apps, and which teammate may use each one. Data only: the Apps page,
// the app tools (src/lib/appTools.ts), the routes and the tests read it. Shared with the browser.
// Copied from Omniscient's src/lib/composio/catalog.ts and trimmed to the apps the AI team needs. Each toolkit was
// checked on its Composio page (composio.dev/toolkits/<slug>.md) on 2026-11-18: slug, auth and whether Composio has
// its own app for it (managed). supabase/016_app_connections.sql lists the same toolkits.

import type { AgentKey } from "../team.ts";
import type { ComposioTool } from "./composio.ts";

export type AppGroup = "mail" | "calendar" | "crm" | "chat" | "support";

/** The Apps page's groups, in its order. */
export const GROUPS: { id: AppGroup; label: string }[] = [
  { id: "mail", label: "Email" },
  { id: "calendar", label: "Calendar and booking" },
  { id: "crm", label: "CRM" },
  { id: "chat", label: "Team chat" },
  { id: "support", label: "Customer support" },
];

export type AppEntry = ComposioTool & {
  name: string;
  group: AppGroup;
  /** One short line on the Apps page: what the team does with it. */
  blurb: string;
  /** The teammates this app is for, once they go live on Composio (plan phase 4, step 2). Not access: see APP_ACCESS. */
  forAgents: AgentKey[];
};

const oauth = (toolkit: string) => ({ toolkit, scheme: "OAUTH2" as const, managed: true });
// OAuth with no app of Composio's: connectable once COMPOSIO_AUTH_CONFIG_<TOOLKIT> names our own app's auth config.
// Both also take an API key on Composio, but customers never paste keys (one-click sign-in only).
const ownApp = (toolkit: string) => ({ toolkit, scheme: "OAUTH2" as const, managed: false });

export const APPS: AppEntry[] = [
  { ...oauth("gmail"), name: "Gmail", group: "mail", blurb: "Read and answer your email, and send what you approve.", forAgents: ["email", "sales", "support"] },
  { ...oauth("outlook"), name: "Outlook", group: "mail", blurb: "Read and answer your email, and send what you approve.", forAgents: ["email", "sales", "support"] },
  { ...oauth("googlecalendar"), name: "Google Calendar", group: "calendar", blurb: "See when you're free and add the meetings you approve.", forAgents: ["forms", "sales"] },
  { ...oauth("calendly"), name: "Calendly", group: "calendar", blurb: "See your bookings and share your booking links.", forAgents: ["forms", "sales"] },
  { ...oauth("hubspot"), name: "HubSpot", group: "crm", blurb: "Look up contacts and deals, and keep them up to date.", forAgents: ["sales"] },
  { ...ownApp("pipedrive"), name: "Pipedrive", group: "crm", blurb: "Look up contacts and deals, and keep them up to date.", forAgents: ["sales"] },
  { ...oauth("salesforce"), name: "Salesforce", group: "crm", blurb: "Look up leads and opportunities, and keep them up to date.", forAgents: ["sales"] },
  { ...oauth("slack"), name: "Slack", group: "chat", blurb: "Read your channels and post the updates you approve.", forAgents: ["support"] },
  { ...oauth("zendesk"), name: "Zendesk", group: "support", blurb: "Read your tickets and send the replies you approve.", forAgents: ["support"] },
  { ...ownApp("help_scout"), name: "Help Scout", group: "support", blurb: "Read your conversations and send the replies you approve.", forAgents: ["support"] },
];

export const TOOLKITS: Readonly<Record<string, AppEntry>> = Object.fromEntries(APPS.map((a) => [a.toolkit, a]));
export const isToolkit = (v: unknown): boolean => typeof v === "string" && Object.hasOwn(TOOLKITS, v);
export const appName = (toolkit: string) => TOOLKITS[toolkit]?.name ?? toolkit;
/** Composio's picture of a toolkit. */
export const appLogo = (toolkit: string) => `https://logos.composio.dev/api/${encodeURIComponent(toolkit)}`;

// ─────────────── who may use which app ───────────────

/**
 * Which connected apps each teammate may use, in one place. "*" is every app. `reads`: only actions that read.
 * A teammate that is coming soon gets nothing, whatever this says (appsFor).
 * For now only Athena reads. Plan phase 4, step 2 turns Iris, Hora, Hermes and Hestia on and gives each its apps:
 * set `email`, `forms`, `sales` and `support` here (from APPS[].forAgents), and drop `soon` in src/lib/team.ts.
 */
export const APP_ACCESS: Partial<Record<AgentKey, { toolkits: "*" | readonly string[]; reads?: boolean }>> = {
  chief: { toolkits: "*", reads: true },
};

/** The apps a teammate may use, and whether only to read. Nothing for a teammate that is coming soon. */
export function appsFor(agent: AgentKey, soon: boolean): { toolkits: string[]; reads: boolean } {
  const a = APP_ACCESS[agent];
  if (!a || soon) return { toolkits: [], reads: true };
  const toolkits = a.toolkits === "*" ? APPS.map((x) => x.toolkit) : a.toolkits.filter(isToolkit);
  return { toolkits, reads: a.reads === true };
}

// ─────────────── words ───────────────

export const APP_MESSAGES = {
  off: "Apps aren't set up on the server yet.",
  notYet: (name: string) => `${name} isn't set up on the server yet.`,
  unknown: "That app can't be connected here.",
  adminsOnly: "Only owners and admins can connect and disconnect apps.",
  gone: "That app is already disconnected.",
  expired: "The sign-in link ran out. Try again.",
  denied: (name: string) => `${name} wasn't connected. You can try again any time.`,
  failed: "We couldn't connect that app. Try again.",
  connected: (name: string) => `${name} is connected.`,
} as const;
