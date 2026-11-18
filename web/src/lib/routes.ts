// Pages inside the one client app (src/app/[[...slug]]). The address bar holds the page, so links and Back work.
import { isAgentKey, type AgentKey } from "./team.ts";
import { inviteTokenFromPath } from "./workspace.ts";

export type SettingsTab = "general" | "members" | "social" | "apps" | "skills";
export type Route =
  | { page: "home" }
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
  // The staff console. Its routes answer 404 to anyone who isn't staff (src/lib/staff.ts).
  | { page: "staff"; id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "social", label: "Social accounts" },
  { id: "apps", label: "Apps" },
  { id: "skills", label: "Skills" },
];

export function parseRoute(path: string): Route {
  const token = inviteTokenFromPath(path);
  if (token) return { page: "invite", token };
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/settings" || p === "/settings/general") return { page: "settings", tab: "general" };
  if (p === "/settings/members") return { page: "settings", tab: "members" };
  if (p === "/settings/social") return { page: "settings", tab: "social" };
  if (p === "/settings/apps") return { page: "settings", tab: "apps" };
  if (p === "/settings/skills") return { page: "settings", tab: "skills" };
  if (p === "/team") return { page: "team" };
  // One teammate's own page, like the current app's #agent/<key>.
  const agent = /^\/team\/([a-z]+)$/.exec(p);
  if (agent && isAgentKey(agent[1])) return { page: "agent", key: agent[1] };
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
  if (r.page === "thread") return r.id ? `/chat/${r.id}` : "/chat";
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
