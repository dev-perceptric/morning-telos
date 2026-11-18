// The apps a customer can connect on Settings, Apps, and which teammate may use each one. Data only: the Apps page,
// the app tools (src/lib/appTools.ts), the routes and the tests read it. Shared with the browser.
// Copied from Omniscient's src/lib/composio/catalog.ts and trimmed to the apps the AI team needs. Each toolkit was
// checked on its Composio page (composio.dev/toolkits/<slug>.md) on 2026-11-18: slug, auth and whether Composio has
// its own app for it (managed). supabase/019_website_builders.sql lists the same toolkits.
// The website builders (Framer, Webflow, WordPress.com) were checked on Composio's API (GET /api/v3.1/toolkits/<slug>
// and /api/v3.1/tools?toolkit_slug=<slug>, saved in tests/fixtures/composio-builders.json) on 2026-11-18. Framer has
// over 150 actions, so each builder lists the few the team uses (`actions`); every other action of theirs is blocked.

import type { AgentKey } from "../team.ts";
import type { ComposioTool } from "./composio.ts";

export type AppGroup = "mail" | "calendar" | "crm" | "chat" | "support" | "website";

/** The Apps page's groups, in its order. */
export const GROUPS: { id: AppGroup; label: string }[] = [
  { id: "mail", label: "Email" },
  { id: "calendar", label: "Calendar and booking" },
  { id: "crm", label: "CRM" },
  { id: "chat", label: "Team chat" },
  { id: "support", label: "Customer support" },
  { id: "website", label: "Website" },
];

/**
 * One action a teammate may run in an app that lists its actions. `kind`: whether it only reads or changes something.
 * A change waits for the owner's approval below autopilot, under `title` on the approval card. `long`: its answer may be
 * longer than most (Framer's own guide to building pages).
 */
export type AppAction = { kind: "read"; long?: boolean } | { kind: "write"; title: string };

export type AppEntry = ComposioTool & {
  name: string;
  group: AppGroup;
  /** One short line on the Apps page: what the team does with it. */
  blurb: string;
  /** The teammates this app is for, shown on the Apps page. Not access: see APP_ACCESS (tests/apps.test.ts keeps them the same). */
  forAgents: AgentKey[];
  /**
   * Only these of the app's actions, by Composio slug. Every other one is blocked. Without it, every action of the app
   * is sorted by its name (kindOf in actions.ts).
   */
  actions?: Readonly<Record<string, AppAction>>;
};

const oauth = (toolkit: string) => ({ toolkit, scheme: "OAUTH2" as const, managed: true });
// OAuth with no app of Composio's: connectable once COMPOSIO_AUTH_CONFIG_<TOOLKIT> names our own app's auth config.
// Both also take an API key on Composio, but customers never paste keys (one-click sign-in only).
const ownApp = (toolkit: string) => ({ toolkit, scheme: "OAUTH2" as const, managed: false });
// An API key only, no sign-in: connectable once COMPOSIO_AUTH_CONFIG_<TOOLKIT> names an API key auth config made in
// Composio. The owner gives the key on Composio's connect page, not in Morning Telos.
const ownKey = (toolkit: string) => ({ toolkit, scheme: "API_KEY" as const, managed: false });

const read = { kind: "read" } as const;
const write = (title: string) => ({ kind: "write", title }) as const;

/**
 * Framer: one connection is one Framer project. A page is built with Framer's agent tools: read its guide and the
 * project (GET_AGENT_SYSTEM_PROMPT, GET_AGENT_CONTEXT, READ_PROJECT_FOR_AGENT), then add or copy a page and fill it in
 * one step (APPLY_AGENT_CHANGES runs a list of Framer's commands), so the owner approves one card per page. Changes
 * stay unpublished until PUBLISH makes a preview and DEPLOY puts it live, each after its own approval.
 * Removing pages, layers, styles, code, redirects and branches is left out.
 */
export const FRAMER_ACTIONS: Readonly<Record<string, AppAction>> = {
  FRAMER_GET_PROJECT_INFO: read,
  FRAMER_GET_PUBLISH_INFO: read,
  FRAMER_GET_UNPUBLISHED_PAGE_CHANGES: read,
  FRAMER_GET_AGENT_SYSTEM_PROMPT: { kind: "read", long: true },
  FRAMER_GET_AGENT_CONTEXT: { kind: "read", long: true },
  FRAMER_READ_PROJECT_FOR_AGENT: read,
  FRAMER_GET_NODES_WITH_TYPE: read,
  FRAMER_SERIALIZE_FOR_AGENT: read,
  FRAMER_LIST_COMPONENTS_FOR_AGENT: read,
  FRAMER_GET_COLLECTIONS: read,
  FRAMER_GET_COLLECTION_FIELDS: read,
  FRAMER_GET_COLLECTION_ITEMS: read,
  FRAMER_CREATE_WEB_PAGE: write("Add a page to your Framer site"),
  FRAMER_CLONE_WEB_PAGE: write("Copy a page on your Framer site"),
  FRAMER_APPLY_AGENT_CHANGES: write("Change a page on your Framer site"),
  FRAMER_REPLACE_TEXT_FOR_AGENT: write("Change words on your Framer site"),
  FRAMER_ADD_COLLECTION_ITEMS: write("Add or update posts in your Framer CMS"),
  FRAMER_PUBLISH: write("Make a preview of your Framer site"),
  FRAMER_DEPLOY: write("Publish your Framer site"),
};

/**
 * Webflow: blog posts and other CMS items, a page's search title and description, and publishing. It can't design
 * new pages. Deleting and unpublishing are left out.
 */
export const WEBFLOW_ACTIONS: Readonly<Record<string, AppAction>> = {
  WEBFLOW_LIST_WEBFLOW_SITES: read,
  WEBFLOW_GET_SITE_INFO: read,
  WEBFLOW_LIST_CUSTOM_DOMAINS: read,
  WEBFLOW_LIST_PAGES: read,
  WEBFLOW_GET_PAGE: read,
  WEBFLOW_GET_PAGE_DOM: read,
  WEBFLOW_LIST_COLLECTIONS: read,
  WEBFLOW_GET_COLLECTION: read,
  WEBFLOW_LIST_COLLECTION_ITEMS: read,
  WEBFLOW_GET_COLLECTION_ITEM: read,
  WEBFLOW_CREATE_COLLECTION_ITEM: write("Add a blog post or CMS item to Webflow"),
  WEBFLOW_UPDATE_COLLECTION_ITEM_V2: write("Update a blog post or CMS item on Webflow"),
  WEBFLOW_UPDATE_PAGE_METADATA: write("Change a page's search title on Webflow"),
  WEBFLOW_PUBLISH_SITE: write("Publish your Webflow site"),
};

/** WordPress.com: drafts only. Composio's tools never publish there; the owner does in WordPress. No deleting drafts. */
export const WORDPRESS_COM_ACTIONS: Readonly<Record<string, AppAction>> = {
  WORDPRESS_COM_LIST_SITES: read,
  WORDPRESS_COM_GET_SITE_OVERVIEW: read,
  WORDPRESS_COM_LIST_CONTENT: read,
  WORDPRESS_COM_GET_POST: read,
  WORDPRESS_COM_LIST_CMS_RESOURCES: read,
  WORDPRESS_COM_CREATE_DRAFT_POST: write("Add a draft post to WordPress.com"),
  WORDPRESS_COM_UPDATE_DRAFT_POST: write("Update a draft post on WordPress.com"),
};

export const APPS: AppEntry[] = [
  { ...oauth("gmail"), name: "Gmail", group: "mail", blurb: "Read and answer your email, and send what you approve.", forAgents: ["sales", "support", "forms", "email"] },
  { ...oauth("outlook"), name: "Outlook", group: "mail", blurb: "Read and answer your email, and send what you approve.", forAgents: ["sales", "support", "forms", "email"] },
  { ...oauth("googlecalendar"), name: "Google Calendar", group: "calendar", blurb: "See when you're free and add the meetings you approve.", forAgents: ["forms", "sales"] },
  { ...oauth("calendly"), name: "Calendly", group: "calendar", blurb: "See your bookings and share your booking links.", forAgents: ["forms", "sales"] },
  { ...oauth("hubspot"), name: "HubSpot", group: "crm", blurb: "Look up contacts and deals, and keep them up to date.", forAgents: ["sales"] },
  { ...ownApp("pipedrive"), name: "Pipedrive", group: "crm", blurb: "Look up contacts and deals, and keep them up to date.", forAgents: ["sales"] },
  { ...oauth("salesforce"), name: "Salesforce", group: "crm", blurb: "Look up leads and opportunities, and keep them up to date.", forAgents: ["sales"] },
  { ...oauth("slack"), name: "Slack", group: "chat", blurb: "Read your channels and post the updates you approve.", forAgents: ["support"] },
  { ...oauth("zendesk"), name: "Zendesk", group: "support", blurb: "Read your tickets and send the replies you approve.", forAgents: ["support"] },
  { ...ownApp("help_scout"), name: "Help Scout", group: "support", blurb: "Read your conversations and send the replies you approve.", forAgents: ["support"] },
  { ...ownKey("framer"), name: "Framer", group: "website", blurb: "Build and update pages on your site, and publish what you approve.", forAgents: ["web"], actions: FRAMER_ACTIONS },
  { ...ownApp("webflow"), name: "Webflow", group: "website", blurb: "Add blog posts and site content, and publish what you approve.", forAgents: ["web"], actions: WEBFLOW_ACTIONS },
  { ...ownApp("wordpress_com"), name: "WordPress.com", group: "website", blurb: "Write draft posts for you to check and publish.", forAgents: ["web"], actions: WORDPRESS_COM_ACTIONS },
];

export const TOOLKITS: Readonly<Record<string, AppEntry>> = Object.fromEntries(APPS.map((a) => [a.toolkit, a]));
export const isToolkit = (v: unknown): boolean => typeof v === "string" && Object.hasOwn(TOOLKITS, v);
export const appName = (toolkit: string) => TOOLKITS[toolkit]?.name ?? toolkit;
/** The listed action, for an app that lists its actions. Undefined for one that doesn't, or an action it leaves out. */
export function appAction(toolkit: string, slug: string): AppAction | undefined {
  const list = TOOLKITS[toolkit]?.actions;
  return list && Object.hasOwn(list, slug) ? list[slug] : undefined;
}
/** The approval card's title for a change: the app's own words for it, or the action's name and the app. */
export function changeTitle(toolkit: string, slug: string, name: string): string {
  const a = appAction(toolkit, slug);
  return (a?.kind === "write" ? a.title : `${name} (${appName(toolkit)})`).slice(0, 200);
}
/** Composio's picture of a toolkit. */
export const appLogo = (toolkit: string) => `https://logos.composio.dev/api/${encodeURIComponent(toolkit)}`;

// ─────────────── who may use which app ───────────────

/**
 * Which connected apps each teammate may use, in one place. "*" is every app. `reads`: only actions that read.
 * A teammate that is coming soon gets nothing, whatever this says (appsFor).
 * Athena reads every app. Iris, Hora, Hermes and Hestia (plan phase 4, step 2) and Hephaestus read and change their
 * own apps; every change waits for the owner's approval below autopilot (src/lib/composio/appAction.ts), and
 * runApproval checks again.
 */
export const APP_ACCESS: Partial<Record<AgentKey, { toolkits: "*" | readonly string[]; reads?: boolean }>> = {
  chief: { toolkits: "*", reads: true },
  // Email campaigns and follow-ups, sent from the owner's own inbox.
  email: { toolkits: ["gmail", "outlook"] },
  // Open times, bookings, and the invites and reminders that go with them.
  forms: { toolkits: ["googlecalendar", "calendly", "gmail", "outlook"] },
  // Leads and quotes: email, booking the call, and the CRM.
  sales: { toolkits: ["gmail", "outlook", "googlecalendar", "calendly", "hubspot", "pipedrive", "salesforce"] },
  // Customer email and tickets, and the team's chat for handing things over.
  support: { toolkits: ["gmail", "outlook", "slack", "zendesk", "help_scout"] },
  // The owner's own site builder: pages on Framer, blog posts and CMS items on Webflow, drafts on WordPress.com.
  web: { toolkits: ["framer", "webflow", "wordpress_com"] },
};

/** The apps a teammate may use, and whether only to read. Nothing for a teammate that is coming soon. */
export function appsFor(agent: AgentKey, soon: boolean): { toolkits: string[]; reads: boolean } {
  const a = APP_ACCESS[agent];
  if (!a || soon) return { toolkits: [], reads: true };
  const toolkits = a.toolkits === "*" ? APPS.map((x) => x.toolkit) : a.toolkits.filter(isToolkit);
  return { toolkits, reads: a.reads === true };
}

/** True when a teammate may change something in a connected app (it gets the Ask me first or Autopilot setting). */
export function changesApps(agent: AgentKey, soon = false): boolean {
  const a = appsFor(agent, soon);
  return a.toolkits.length > 0 && !a.reads;
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
