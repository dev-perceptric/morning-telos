// Roles, who may do what, invite links and the delete check. Shared by the screens and the server routes,
// and kept free of server-only imports so tests can load it. Copied from Arrowsterr's src/lib/db.ts (ROLE_RANK, atLeast).
import { cleanTimezone, cleanWebsite } from "./signup.ts";

export type Role = "owner" | "admin" | "editor" | "viewer";
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
export const isRole = (r: unknown): r is Role => typeof r === "string" && r in ROLE_RANK;
export const atLeast = (role: Role | null | undefined, min: Role) => (role ? ROLE_RANK[role] >= ROLE_RANK[min] : false);

export const ROLES: { id: Role; label: string; can: string }[] = [
  { id: "owner", label: "Owner", can: "Everything, including billing and deleting the workspace." },
  { id: "admin", label: "Admin", can: "Changes settings, invites people and changes their roles." },
  { id: "editor", label: "Editor", can: "Chats with the team and approves their work." },
  { id: "viewer", label: "Viewer", can: "Sees everything but can't change anything." },
];
/** Roles someone can be invited as or changed to. Nobody becomes owner this way. */
export const ASSIGNABLE: Role[] = ["admin", "editor", "viewer"];
export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;

/** Every workspace action, and the lowest role that may do it. Row level security in the database enforces the same. */
export const NEEDS = {
  viewSettings: "viewer",
  editSettings: "admin",
  viewMembers: "viewer",
  invite: "admin",
  seeInvites: "admin",
  revokeInvite: "admin",
  changeRole: "admin",
  removeMember: "admin",
  deleteWorkspace: "owner",
  connectSocial: "editor",
  readChats: "viewer",
  chat: "editor",
  changeTeam: "admin",
} as const satisfies Record<string, Role>;
export type Action = keyof typeof NEEDS;

export const can = (role: Role | null | undefined, action: Action) => atLeast(role, NEEDS[action]);

export type MemberRow = { user_id: string; email: string | null; role: Role };

/** What the person on screen may do to one row of the members list. */
export function memberActions(me: { userId: string; role: Role }, m: MemberRow) {
  const self = m.user_id === me.userId;
  const otherNonOwner = !self && m.role !== "owner";
  return {
    changeRole: otherNonOwner && can(me.role, "changeRole"),
    remove: otherNonOwner && can(me.role, "removeMember"),
    // Anyone but the owner can leave. The owner deletes the workspace instead.
    leave: self && m.role !== "owner",
  };
}

/** The link an invited person opens. */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

/** The token from a path like /invite/abc123, or null. */
export function inviteTokenFromPath(path: string): string | null {
  const m = /^\/invite\/([A-Za-z0-9_-]{8,200})\/?$/.exec(path);
  return m ? m[1] : null;
}

/** The delete button only works once the person has typed the business name. Case and extra spaces don't matter. */
export function deleteConfirmMatches(typed: unknown, name: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return typeof typed === "string" && norm(name) !== "" && norm(typed) === norm(name);
}

/** Check the settings form. Returns the values to save, or a message to show. */
export function cleanSettings(input: { name?: unknown; website?: unknown; timezone?: unknown }): { ok: true; value: { name: string; website: string | null; timezone: string } } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter your business name." };
  if (name.length > 120) return { ok: false, error: "The business name can be up to 120 letters." };
  const typed = String(input.website ?? "").trim();
  const website = cleanWebsite(typed);
  if (typed && !website) return { ok: false, error: "Enter a website like yourbusiness.com." };
  const timezone = String(input.timezone ?? "");
  if (!timezone || cleanTimezone(timezone, "") !== timezone) return { ok: false, error: "Pick a time zone from the list." };
  return { ok: true, value: { name, website: website || null, timezone } };
}
