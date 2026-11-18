// Pages inside the one client app (src/app/[[...slug]]). The address bar holds the page, so links and Back work.
import { inviteTokenFromPath } from "./workspace.ts";

export type SettingsTab = "general" | "members" | "social";
export type Route =
  | { page: "home" }
  | { page: "thread"; id: string | null }
  | { page: "team" }
  | { page: "knowledge" }
  | { page: "approvals"; id: number | null }
  | { page: "settings"; tab: SettingsTab }
  | { page: "invite"; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "social", label: "Social accounts" },
];

export function parseRoute(path: string): Route {
  const token = inviteTokenFromPath(path);
  if (token) return { page: "invite", token };
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/settings" || p === "/settings/general") return { page: "settings", tab: "general" };
  if (p === "/settings/members") return { page: "settings", tab: "members" };
  if (p === "/settings/social") return { page: "settings", tab: "social" };
  if (p === "/team") return { page: "team" };
  // A new chat is /chat until its first reply names the thread, then /chat/<thread id>.
  if (p === "/chat") return { page: "thread", id: null };
  const chat = /^\/chat\/([^/]+)$/.exec(p);
  if (chat && UUID.test(chat[1])) return { page: "thread", id: chat[1].toLowerCase() };
  if (p === "/knowledge") return { page: "knowledge" };
  if (p === "/approvals") return { page: "approvals", id: null };
  const ap = /^\/approvals\/(\d{1,15})$/.exec(p);
  if (ap && Number(ap[1]) > 0) return { page: "approvals", id: Number(ap[1]) };
  return { page: "home" };
}

export function routePath(r: Route): string {
  if (r.page === "settings") return r.tab === "general" ? "/settings" : `/settings/${r.tab}`;
  if (r.page === "invite") return `/invite/${r.token}`;
  if (r.page === "thread") return r.id ? `/chat/${r.id}` : "/chat";
  if (r.page === "team") return "/team";
  if (r.page === "knowledge") return "/knowledge";
  if (r.page === "approvals") return r.id ? `/approvals/${r.id}` : "/approvals";
  return "/";
}
