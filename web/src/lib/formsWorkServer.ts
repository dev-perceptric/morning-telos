// The connections and Composio calls behind Cleo's Calendar tab (src/lib/formsWork.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { AppSetupError, needsReconnect, runTool } from "./composio/actions.ts";
import { composioOn, composioUser } from "./composio/composio.ts";
import { connectionsOf, markReconnect } from "./composio/store.ts";
import type { CalSource } from "./formsWork.ts";

export function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "forms-work" } });
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

const CAL: readonly string[] = ["googlecalendar", "calendly"];

export function formsData(db: SupabaseClient, ws: string) {
  return {
    connections: async () => (await connectionsOf(db, ws)).filter((c) => CAL.includes(c.toolkit)).map((c) => ({ toolkit: c.toolkit, status: c.status })),
    /** One action on the workspace's own connection. A plain message when it can't run; a gone sign-in is marked. */
    run: async (toolkit: CalSource, slug: string, args: Record<string, unknown>) => {
      if (!composioOn()) throw new Error("Apps aren't set up on the server yet.");
      const row = (await connectionsOf(db, ws)).find((c) => c.toolkit === toolkit);
      if (!row) throw new Error("Connect your calendar in Settings, Apps.");
      try {
        return await runTool({ toolkit, account: row.composio_account, user: composioUser(ws) }, slug, args);
      } catch (e) {
        if (needsReconnect(e)) await markReconnect(db, ws, toolkit, e instanceof Error ? e.message : String(e)).catch(() => {});
        if (e instanceof AppSetupError) throw e;
        log(`${slug} for workspace ${ws} failed: ${e instanceof Error ? e.message : String(e)}`);
        throw new Error("We couldn't reach your calendar right now. Try again in a few minutes.");
      }
    },
    approvals: async () =>
      must(await db.from("approvals").select("id, product, tool, input, status").eq("workspace_id", ws).eq("agent", "forms").eq("status", "pending").order("id").limit(100)) as {
        id: number;
        product: string;
        tool: string;
        input: Record<string, unknown> | null;
        status: string;
      }[],
    activity: async (text: string) => {
      must(await db.from("activity").insert({ workspace_id: ws, agent: "forms", text }));
    },
  };
}
