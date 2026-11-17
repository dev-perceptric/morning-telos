// Test stand-in for src/lib/serverAuth.ts (wired by ../tsResolve.mjs). A request is signed in as the user id in its
// "Authorization: Bearer <user id>" header, with the roles a test puts in `auth.roles`. adminClient() is `auth.db`.
type Min = "owner" | "admin" | "editor" | "viewer";
const RANK: Record<Min, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export const auth = {
  db: null as unknown,
  /** "<user id>:<workspace id>" → role */
  roles: new Map<string, Min>(),
  emails: new Map<string, string>(),
};

export const supabaseUrl = () => "https://db.test";

export async function requireRole(request: Request, workspaceId: unknown, min: Min) {
  const deny = (error: string, status: number) => ({ denied: Response.json({ error }, { status }) });
  const userId = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!userId) return deny("Please sign in again.", 401);
  if (typeof workspaceId !== "string" || !workspaceId) return deny("Missing workspace.", 400);
  const role = auth.roles.get(`${userId}:${workspaceId}`);
  if (!role || RANK[role] < RANK[min]) return deny(min === "owner" ? "Only the workspace owner can do that." : `You need ${min} access in this workspace to do that.`, 403);
  return { sb: null, user: { id: userId, email: auth.emails.get(userId) ?? `${userId}@example.com` } };
}

export const adminClient = () => auth.db;

/** Same shape as roleGate in src/lib/serverAuth.ts, on top of the stand-in requireRole. */
export function roleGate(request: Request, workspaceId: unknown) {
  const gate = async (min: Min) => {
    const r = await requireRole(request, workspaceId, min);
    if ("denied" in r) {
      const body = (await r.denied.clone().json().catch(() => ({}))) as { error?: string };
      return { ok: false as const, status: r.denied.status, error: body.error ?? "Not allowed." };
    }
    return { ok: true as const, userId: r.user.id, email: r.user.email };
  };
  const client = () => auth.db;
  return { gate, client };
}
