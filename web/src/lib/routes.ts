// Pages inside the one client app (src/app/[[...slug]]). The address bar holds the page, so links and Back work.
import { inviteTokenFromPath } from "./workspace.ts";

export type SettingsTab = "general" | "members" | "social";
export type Route = { page: "home" } | { page: "settings"; tab: SettingsTab } | { page: "invite"; token: string };

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
  return { page: "home" };
}

export function routePath(r: Route): string {
  if (r.page === "settings") return r.tab === "general" ? "/settings" : `/settings/${r.tab}`;
  if (r.page === "invite") return `/invite/${r.token}`;
  return "/";
}
