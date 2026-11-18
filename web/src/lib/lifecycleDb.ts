import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_FROM, type ResendDeps } from "./email.ts";
import { appUrl } from "./emailKit.ts";
import type { Handler } from "./jobs.ts";
import { sendLifecycleEmails, type LifecycleStore, type StoredWorkspace } from "./lifecycleSend.ts";
import { envKeyring } from "./sealing.ts";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe.ts";

// lifecycleSend.ts wired to Supabase (the full-access client) and Resend from the server's settings. Used by the
// worker's hourly lifecycle_emails job (supabase/018_email_log.sql).

const PAGE = 1000;
const fail = (what: string, message: string) => new Error(/email_log|email_prefs/.test(message) ? "Run supabase/018_email_log.sql in Supabase." : `Could not read ${what}: ${message}`);

async function countOf(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) {
  const { count, error } = await q;
  if (error) throw fail(what, error.message);
  return count ?? 0;
}

export function lifecycleStore(db: SupabaseClient): LifecycleStore {
  return {
    workspaces: async () => {
      const all: StoredWorkspace[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("workspaces")
          .select("id, name, plan, status, trial_ends_at, period_start, timezone, created_at")
          .order("created_at")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw fail("workspaces", error.message);
        all.push(...((data ?? []) as StoredWorkspace[]));
        if (!data || data.length < PAGE) return all;
      }
    },
    spend: async (ws, since) => {
      const { data, error } = await db.rpc("ai_spend", { p_ws: ws, p_since: since });
      if (error) throw fail("AI spend", error.message);
      return Number(data ?? 0);
    },
    owners: async (ws) => {
      const { data, error } = await db.from("workspace_members").select("user_id, email").eq("workspace_id", ws).eq("role", "owner");
      if (error) throw fail("the owner", error.message);
      return ((data ?? []) as { user_id: string; email: string | null }[]).filter((m) => m.email).map((m) => ({ userId: m.user_id, email: m.email! }));
    },
    digestOn: async (ws, user) => {
      const { data, error } = await db.from("email_prefs").select("digest").eq("workspace_id", ws).eq("user_id", user).maybeSingle();
      if (error) throw fail("email settings", error.message);
      return (data as { digest: boolean } | null)?.digest !== false;
    },
    stats: async (ws, from, to) => {
      const [chats, approvals, routines] = await Promise.all([
        countOf(db.from("threads").select("id", { count: "exact", head: true }).eq("workspace_id", ws).gte("created_at", from).lt("created_at", to), "chats"),
        countOf(db.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).gte("decided_at", from).lt("decided_at", to), "approvals"),
        countOf(db.from("jobs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("kind", "run_routine").gte("done_at", from).lt("done_at", to), "routine runs"),
      ]);
      return { chats, approvals, routines };
    },
    claim: async (row) => {
      const { error } = await db.from("email_log").insert(row);
      if (!error) return true;
      if ((error as { code?: string }).code === "23505") return false;
      throw fail("the email log", error.message);
    },
    unclaim: async (row) => {
      const { error } = await db.from("email_log").delete().eq("workspace_id", row.workspace_id).eq("user_id", row.user_id).eq("kind", row.kind).eq("period_key", row.period_key);
      if (error) throw new Error(error.message);
    },
  };
}

/** The unsubscribe link maker, or a maker that gives null while SEALING_KEYS isn't set (no digest then). */
function linkMaker(base: string, log: (m: string) => void) {
  return (workspaceId: string, userId: string) => {
    try {
      return unsubscribeUrl(base, unsubscribeToken(envKeyring(), { workspaceId, userId }));
    } catch (e) {
      log(`No unsubscribe link, so no weekly digest: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
}

/** The hourly lifecycle_emails job. */
export function lifecycleEmailsHandler(db: SupabaseClient, o: { fetcher?: typeof fetch; log: (m: string) => void }): Handler {
  return async () => {
    const resend: ResendDeps = { key: process.env.RESEND_API_KEY?.trim() ?? "", from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM, fetch: o.fetcher ?? fetch };
    const base = appUrl();
    const run = await sendLifecycleEmails({ store: lifecycleStore(db), resend, appUrl: base, now: () => Date.now(), unsubscribeUrl: linkMaker(base, o.log), log: o.log });
    if (run.sent || run.failed) console.log(`Lifecycle emails: ${run.sent} sent, ${run.skipped} skipped, ${run.failed} failed.`);
    return { status: "done" };
  };
}
