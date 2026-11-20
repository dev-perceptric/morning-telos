// Pages inside the one client app (src/app/[[...slug]]). The address bar holds the page, so links and Back work.
import { agentByGod, isAgentKey, type AgentKey } from "./team.ts";
import { inviteTokenFromPath } from "./workspace.ts";

export type SettingsTab = "general" | "members" | "social" | "apps" | "skills" | "extension";
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

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "social", label: "Social accounts" },
  { id: "apps", label: "Apps" },
  { id: "skills", label: "Skills" },
  { id: "extension", label: "Chrome extension" },
];

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
  if (r.page === "settings") return r.tab === "general" ? "/settings" : `/settings/${r.tab}`;
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
