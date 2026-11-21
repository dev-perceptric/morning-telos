// Pages inside the one client app (src/app/[[...slug]]). The address bar holds the page, so links and Back work.
import { agentByGod, isAgentKey, type AgentKey } from "./team.ts";
import { can, inviteTokenFromPath, type Action, type Role } from "./workspace.ts";

export type SettingsTab = "general" | "account" | "notifications" | "brand" | "members" | "billing" | "social" | "apps" | "skills" | "email" | "extension";
export type Route =
  | { page: "home" }
  | { page: "useCases" }
  | { page: "thread"; id: string | null }
  | { page: "team" }
  | { page: "agent"; key: AgentKey }
  | { page: "billing" }
  | { page: "knowledge" }
  | { page: "routines" }
  | { page: "memory" }
  | { page: "approvals"; id: number | null }
  | { page: "settings"; tab: SettingsTab }
  | { page: "invite"; token: string }
  // Where a social network's (or SEO tool's) sign-in comes back to (src/lib/connectFlow.ts RETURN_PATH).
  | { page: "socialReturn" }
  // The staff console. Its routes answer 404 to anyone who isn't staff (src/lib/staff.ts).
  | { page: "staff"; id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One Settings section: its address, its label, its icon and who sees it. */
export type SettingsItem = { id: SettingsTab; label: string; icon: string; sub: string; need?: Action; ownerOnly?: boolean };
/** Settings, grouped like Omniscient's: you, the workspace, then what it connects to. One panel at a time. */
export const SETTINGS_GROUPS: { label: string; items: SettingsItem[] }[] = [
  {
    label: "You",
    items: [
      { id: "account", label: "Account", icon: "user", sub: "Who you are signed in as." },
      { id: "notifications", label: "Notifications", icon: "bell", sub: "Which emails you get from us.", ownerOnly: true },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: "building", sub: "Your business name, website and time zone." },
      { id: "brand", label: "Brand", icon: "palette", sub: "The colors and fonts your team writes in.", need: "editSettings" },
      { id: "members", label: "Members", icon: "team", sub: "The people in this workspace and what they can do." },
      { id: "billing", label: "Plans & billing", icon: "card", sub: "Your plan and this period's AI use." },
    ],
  },
  {
    label: "Connections",
    items: [
      { id: "social", label: "Social accounts", icon: "message", sub: "The accounts your team posts to." },
      { id: "apps", label: "Apps", icon: "grid", sub: "The tools your team can read and work in." },
      { id: "email", label: "Team email", icon: "mail", sub: "An address that sends email straight to your team." },
      { id: "skills", label: "Skills", icon: "idea", sub: "How your team does each job." },
      { id: "extension", label: "Chrome extension", icon: "puzzle", sub: "Send any web page to your team." },
    ],
  },
];

/** The sections this person can open. */
export const settingsGroups = (role: Role) =>
  SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (i.ownerOnly ? role === "owner" : i.need ? can(role, i.need) : true)) })).filter((g) => g.items.length);

/** A section's address. Billing keeps /billing, where Stripe sends people back. */
export const settingsPath = (tab: SettingsTab) => (tab === "general" ? "/settings" : tab === "billing" ? "/billing" : `/settings/${tab}`);

/** A section's label and short line. */
export const settingsItem = (tab: SettingsTab) => SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)!;

export function parseRoute(path: string): Route {
  const token = inviteTokenFromPath(path);
  if (token) return { page: "invite", token };
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/settings" || p === "/settings/general") return { page: "settings", tab: "general" };
  if (p === "/settings/members") return { page: "settings", tab: "members" };
  if (p === "/settings/social") return { page: "settings", tab: "social" };
  if (p === "/settings/social/return") return { page: "socialReturn" };
  if (p === "/settings/apps") return { page: "settings", tab: "apps" };
  if (p === "/settings/skills") return { page: "settings", tab: "skills" };
  if (p === "/settings/extension") return { page: "settings", tab: "extension" };
  if (p === "/settings/account") return { page: "settings", tab: "account" };
  if (p === "/settings/notifications") return { page: "settings", tab: "notifications" };
  if (p === "/settings/brand") return { page: "settings", tab: "brand" };
  if (p === "/settings/email") return { page: "settings", tab: "email" };
  if (p === "/settings/billing") return { page: "billing" };
  if (p === "/use-cases") return { page: "useCases" };
  if (p === "/team") return { page: "team" };
  // One teammate's own page, like the current app's #agent/<key>.
  // Their name works too: /team/athena opens the same page as /team/chief.
  const agent = /^\/team\/([a-z]+)$/i.exec(p);
  const key = agent ? (isAgentKey(agent[1]) ? agent[1] : agentByGod(agent[1])) : null;
  if (key) return { page: "agent", key };
  // Stripe Checkout and the billing portal come back here.
  if (p === "/billing") return { page: "billing" };
  // A new chat is /chat until its first reply names the thread, then /chat/<thread id>.
  if (p === "/chat") return { page: "thread", id: null };
  const chat = /^\/chat\/([^/]+)$/.exec(p);
  if (chat && UUID.test(chat[1])) return { page: "thread", id: chat[1].toLowerCase() };
  if (p === "/knowledge") return { page: "knowledge" };
  if (p === "/routines") return { page: "routines" };
  if (p === "/memory") return { page: "memory" };
  if (p === "/approvals") return { page: "approvals", id: null };
  const ap = /^\/approvals\/(\d{1,15})$/.exec(p);
  if (ap && Number(ap[1]) > 0) return { page: "approvals", id: Number(ap[1]) };
  if (p === "/staff") return { page: "staff", id: null };
  const staff = /^\/staff\/([^/]+)$/.exec(p);
  if (staff && UUID.test(staff[1])) return { page: "staff", id: staff[1].toLowerCase() };
  return { page: "home" };
}

export function routePath(r: Route): string {
  if (r.page === "settings") return settingsPath(r.tab);
  if (r.page === "invite") return `/invite/${r.token}`;
  if (r.page === "socialReturn") return "/settings/social/return";
  if (r.page === "thread") return r.id ? `/chat/${r.id}` : "/chat";
  if (r.page === "useCases") return "/use-cases";
  if (r.page === "team") return "/team";
  if (r.page === "agent") return `/team/${r.key}`;
  if (r.page === "billing") return "/billing";
  if (r.page === "knowledge") return "/knowledge";
  if (r.page === "routines") return "/routines";
  if (r.page === "memory") return "/memory";
  if (r.page === "approvals") return r.id ? `/approvals/${r.id}` : "/approvals";
  if (r.page === "staff") return r.id ? `/staff/${r.id}` : "/staff";
  return "/";
}

// The site's "Start free trial" button links to https://chat.morningtelos.com/#signup, as the old app did.
// /signup works too. Signed out, either opens the sign-up form. Signed in, it opens home.
const SIGNUP_HASH = /^#\/?signup\/?$/i;
const SIGNUP_PATH = /^\/signup\/?$/i;

/** True when the address asks for the sign-up form: #signup, or the /signup page. */
export function wantsSignup(path: string, hash: string): boolean {
  return SIGNUP_HASH.test(hash) || SIGNUP_PATH.test(path);
}

/** The address without the sign-up link, once the person is signed in, or null when there is nothing to clean. */
export function withoutSignup(path: string, search: string, hash: string): string | null {
  if (!wantsSignup(path, hash)) return null;
  const p = SIGNUP_PATH.test(path) ? "/" : path;
  return p + search + (SIGNUP_HASH.test(hash) ? "" : hash);
}
