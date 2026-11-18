import * as Sentry from "@sentry/nextjs";
import { APP_MESSAGES, appName } from "@/lib/composio/catalog";
import { composioOn, composioUser } from "@/lib/composio/composio";
import { accountLabel, activeAccount, dropAccount, readState } from "@/lib/composio/connect";
import { connectionFor, saveConnection } from "@/lib/composio/store";
import { envKeyring } from "@/lib/sealing";
import { adminClient, appOrigin } from "@/lib/serverAuth";
import { atLeast, isRole } from "@/lib/workspace";

// Back from Composio's hosted sign-in page (POST /api/apps/connect). The sealed note (state) says which workspace,
// person and app; it only opens on this server and runs out after 30 minutes. The connected account Composio names
// must be that workspace's own (its Composio user), for that app, and ACTIVE, and the person must still be an owner
// or admin there, before it's saved. An account it replaces is removed at Composio, as is a new one that didn't make
// it. Then back to Settings, Apps with one line to show.
// Copied from Omniscient's src/app/api/apps/composio/route.ts and trimmed.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "apps" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appOrigin(request);
  const go = (q: Record<string, string>) => Response.redirect(`${base}/settings/apps?${new URLSearchParams(q)}`, 302);
  let state = null;
  try {
    state = readState(envKeyring(), url.searchParams.get("state") ?? "");
  } catch {
    state = null;
  }
  if (!state) return go({ app: "error", reason: APP_MESSAGES.expired });
  const name = appName(state.toolkit);
  const id = url.searchParams.get("connected_account_id") ?? "";
  if (url.searchParams.get("status") === "failed" || !id) return go({ app: "error", reason: APP_MESSAGES.denied(name) });
  const db = adminClient();
  if (!db || !composioOn()) return go({ app: "error", reason: APP_MESSAGES.off });

  const ws = state.ws;
  let user: string;
  try {
    user = composioUser(ws);
  } catch {
    return go({ app: "error", reason: APP_MESSAGES.failed });
  }
  let made = "";
  let old: string | null = null;
  try {
    const { data: member, error } = await db.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", state.user).maybeSingle();
    if (error) throw new Error(error.message);
    const role = (member as { role?: string } | null)?.role;
    if (!isRole(role) || !atLeast(role, "admin")) throw Object.assign(new Error(APP_MESSAGES.adminsOnly), { plain: true });
    old = (await connectionFor(db, ws, state.toolkit))?.composio_account ?? null;
    const account = await activeAccount(state.toolkit, user, id);
    made = account.id;
    const label = await accountLabel(state.toolkit, account.id, user);
    const saved = await saveConnection(db, { ws, toolkit: state.toolkit, userId: state.user, account: account.id, label });
    if (saved.old) await dropAccount(saved.old);
    return go({ app: "connected", toolkit: state.toolkit });
  } catch (e) {
    // The new account that didn't make it isn't kept at Composio either (never the one in use).
    if (made && made !== old) await dropAccount(made);
    const msg = e instanceof Error ? e.message : String(e);
    log(`Connecting ${state.toolkit} for workspace ${ws} failed: ${msg}`);
    return go({ app: "error", reason: (e as { plain?: boolean }).plain ? msg : APP_MESSAGES.failed });
  }
}
