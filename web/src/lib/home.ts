// What Home and the app's frame say: the greeting, the trial pill, the idea list, the Finish setup steps and the
// search palette's matches. Ported from the old app's renderHome and renderPal (app/public/app.js). Pure, so tests
// check the words.

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

export type ServiceRow = { product: string; status: string };
export type SetupStep = {
  key: "knowledge" | "seo" | "social" | "apps";
  title: string;
  text: string;
  /** What the button says and where it goes. None while it's in progress on our side. */
  action?: { label: string; path: string };
  /** A quiet word on the right instead of a button. */
  meta?: string;
  /** "social" opens the connect page instead of going somewhere. */
  connect?: boolean;
};

/**
 * What's left to set up, like the old app's Finish setup card. Done steps are left out, so an empty list means
 * nothing is left. `canSocial` and `canApps` hide steps the person can't do.
 */
export function setupSteps(s: {
  docs: number;
  services: readonly ServiceRow[];
  socialConnected: boolean;
  appsConnected: boolean;
  canSocial: boolean;
  canApps: boolean;
  canKnowledge: boolean;
}): SetupStep[] {
  const out: SetupStep[] = [];
  if (!s.docs && s.canKnowledge)
    out.push({ key: "knowledge", title: "Tell your team about your business", text: "Fill in what you sell, who you serve and how you sound", action: { label: "Start", path: "/knowledge" } });
  const seo = s.services.find((r) => r.product === "arrowsterr")?.status;
  if (seo === "waiting") out.push({ key: "seo", title: "SEO and AI visibility", text: "Add your website so your team can track how people find you.", action: { label: "Add website", path: "/settings" } });
  else if (seo === "failed") out.push({ key: "seo", title: "SEO and AI visibility", text: "Part of the setup didn't finish. Our team has been told and is on it.", meta: "We're on it" });
  else if (seo === "pending") out.push({ key: "seo", title: "SEO and AI visibility", text: "Morning Telos is setting this up for you. It takes a minute or two.", meta: "In progress" });
  if (!s.socialConnected && s.canSocial)
    out.push({ key: "social", title: "Connect your social accounts", text: "Link Instagram, Facebook, LinkedIn and more, so Aphrodite can post for you", action: { label: "Connect", path: "/settings/social" }, connect: true });
  if (!s.appsConnected && s.canApps)
    out.push({ key: "apps", title: "Connect your apps", text: "Gmail, Outlook, your calendar and CRM, so Iris, Hermes, Hora and Hestia can work in them", action: { label: "Connect", path: "/settings/apps" } });
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
