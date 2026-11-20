// What Home and the app's frame say: the greeting, the trial pill, the idea list, the ways to reach the team, the
// Slack banner, the Finish setup rows and the search palette's matches. Ported from the old app's renderHome and
// renderPal (app/public/app.js). Pure, so tests check the words.

import type { PlanState } from "./plans.ts";

/** "Good morning, Vincent" by the hour of the day, or just "Good evening" with no name. */
export function greeting(hour: number, name?: string | null): string {
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = firstName(name);
  return first ? `${part}, ${first}` : part;
}

/** The first word of a name. An email address gives nothing: "Good morning, jo@x.com" reads wrong. */
export function firstName(name?: string | null): string {
  const n = String(name ?? "").trim();
  if (!n || n.includes("@")) return "";
  return n.split(/\s+/)[0];
}

/** The letter in the round avatar. */
export const initial = (name?: string | null) => (String(name ?? "").trim()[0] ?? "?").toUpperCase();

/** "now", "5m", "3h", or a short date like "Nov 18". */
export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = (now - t) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The pill at the top of Home: days left in the trial, or that it ended. Nothing on a paid or internal plan. */
export function trialPill(p: Pick<PlanState, "plan" | "daysLeft">): { warn: boolean; lead: string; strong: string; cta: string } | null {
  if (p.plan === "trial") return { warn: p.daysLeft <= 3, lead: "Free trial:", strong: `${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`, cta: "Choose a plan" };
  if (p.plan === "expired") return { warn: true, lead: "Your trial ended.", strong: "Your team is paused.", cta: "Choose a plan" };
  return null;
}

/** The ideas under the Home box. Ideas for SEO or social show only once that product is ready for the workspace. */
export function homeIdeas(ideas: readonly string[], ready: { arrowsterr: boolean; capybaroar: boolean }, max = 4): string[] {
  const needs = (t: string) => (/^@(Artemis|Hephaestus)\b/.test(t) ? ready.arrowsterr : /^@Aphrodite\b/.test(t) ? ready.capybaroar : true);
  return ideas.filter(needs).slice(0, max);
}

// ─────────────── other ways to reach the team ───────────────

export type ReachChannel = { id: "email" | "text" | "slack"; label: string; detail: string };

/**
 * Ways into the workspace outside the app. Each door fills its own field once it exists: the team's email address,
 * the number to text, and whether the team answers in Slack. Nothing filled means the app has no door yet.
 */
export type ReachDoors = { emailAddress?: string | null; textNumber?: string | null; slackTeam?: boolean };

/** The channels Home's "Other ways to reach your team" strip shows, in its order. Empty hides the strip. */
export function reachChannels(ws: ReachDoors): ReachChannel[] {
  const out: ReachChannel[] = [];
  const email = String(ws.emailAddress ?? "").trim();
  const text = String(ws.textNumber ?? "").trim();
  if (email) out.push({ id: "email", label: "Email", detail: email });
  if (text) out.push({ id: "text", label: "Text", detail: text });
  if (ws.slackTeam) out.push({ id: "slack", label: "Slack", detail: "Message your team in Slack" });
  return out;
}

// ─────────────── the Slack banner ───────────────

/** Where a person's "not now" on the Slack banner is kept in this browser. */
export const slackBannerKey = (userId: string, workspaceId: string) => `mt.slackBanner.${workspaceId}.${userId}`;

/** The banner at the top of Home: for owners and admins, while Slack can be connected here and isn't yet. */
export function showSlackBanner(s: { canConnect: boolean; slackReady: boolean; slackConnected: boolean; dismissed: boolean }): boolean {
  return s.canConnect && s.slackReady && !s.slackConnected && !s.dismissed;
}

// ─────────────── Finish setup ───────────────

export const MAIL_APPS = ["gmail", "outlook"] as const;
export const CALENDAR_APPS = ["googlecalendar", "calendly"] as const;
/** Site builders connected through the apps page. "wordpress" is a self-hosted site, connected directly. */
export const SITE_APPS = ["wordpress", "shopify", "framer", "webflow", "wordpress_com"] as const;

export type SetupRow = {
  key: "social" | "email" | "calendar" | "website";
  title: string;
  text: string;
  /** App logos on the row, first one biggest. */
  logos: string[];
  /**
   * What Connect does: open the social accounts' connect page, open one app's sign-in (one button per app), or go
   * to Settings, Apps (a self-hosted WordPress site needs its address typed there).
   */
  connect: { kind: "social" } | { kind: "apps"; apps: string[] } | { kind: "page"; path: string };
};

/** What Home knows about the workspace's connections. */
export type SetupState = {
  /** Owners and admins only: nobody else sees Finish setup. */
  canConnect: boolean;
  /** Social accounts the workspace has, working or not. */
  socialAccounts: number;
  /** Apps with a connection, working or waiting for a new sign-in. */
  connected: readonly string[];
  /** Apps this server can connect right now. */
  connectable: readonly string[];
  /** A self-hosted WordPress site is connected. */
  wordpress: boolean;
};

/** Home's Finish setup rows: what's left to connect, in order. Done rows are left out, so empty hides the section. */
export function finishSetup(s: SetupState): SetupRow[] {
  if (!s.canConnect) return [];
  const has = (apps: readonly string[]) => apps.some((a) => s.connected.includes(a) || (a === "wordpress" && s.wordpress));
  const ready = (apps: readonly string[]) => apps.filter((a) => s.connectable.includes(a));
  const out: SetupRow[] = [];
  if (!s.socialAccounts)
    out.push({ key: "social", title: "Connect your social accounts", text: "Instagram, Facebook, LinkedIn and more, so Aphrodite can post for you.", logos: ["instagram", "facebook", "linkedin"], connect: { kind: "social" } });
  if (!has(MAIL_APPS) && ready(MAIL_APPS).length)
    out.push({ key: "email", title: "Connect your email", text: "Gmail or Outlook, so Iris, Hermes and Hestia can work in your inbox.", logos: [...MAIL_APPS], connect: { kind: "apps", apps: ready(MAIL_APPS) } });
  if (!has(CALENDAR_APPS) && ready(CALENDAR_APPS).length)
    out.push({ key: "calendar", title: "Connect your calendar", text: "Google Calendar or Calendly, so Hora can book meetings for you.", logos: [...CALENDAR_APPS], connect: { kind: "apps", apps: ready(CALENDAR_APPS) } });
  if (!has(SITE_APPS))
    out.push({ key: "website", title: "Connect your website builder", text: "WordPress, Shopify, Framer or Webflow, so Hephaestus can build pages for you.", logos: ["wordpress", "shopify", "framer", "webflow"], connect: { kind: "page", path: "/settings/apps" } });
  return out;
}

export type PaletteItem = { label: string; group: "Actions" | "Pages" | "Teammates" | "Chats"; path: string; keywords?: string };

/** The palette's list for what's typed: every item with all the typed words in its label or keywords, in order. */
export function paletteMatch(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((it) => {
    const hay = `${it.label} ${it.keywords ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
