// The AI team's database, bound to one workspace. Used by POST /api/chat with the server's client (adminClient),
// since agent replies and ai_usage are server only. Every read and write names the workspace, so a thread id from
// another workspace finds nothing (CLAUDE.md: server code checks the workspace too).

import { cleanBooking } from "./booking.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewMessage, Pref, StoredMessage, TeamStore, TeamWorkspace, UsageRow } from "./agentLoop.ts";
import { HISTORY } from "./agentLoop.ts";
import { storedFiles } from "./attachments.ts";
import { brandTone, type BrandRow } from "./brand.ts";
import { isModelChoice } from "./models.ts";
import { isAgentKey, type AgentKey } from "./team.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/**
 * The workspace fields the team needs: its name, website and brand tone for the prompt, and its plan for the meter.
 * A brand that can't be read (021_brand.sql not run yet, a hiccup) only leaves the tone out.
 */
export async function loadWorkspace(db: SupabaseClient, id: string): Promise<TeamWorkspace | null> {
  const row = must(await db.from("workspaces").select("id, name, website, timezone, plan, status, trial_ends_at, period_start").eq("id", id).maybeSingle()) as TeamWorkspace | null;
  if (!row) return null;
  const brand = await db.from("brand_kits").select("tone, use_brand").eq("workspace_id", id).maybeSingle();
  return { ...row, tone: brand.error ? null : brandTone(brand.data as Pick<BrandRow, "tone" | "use_brand"> | null) };
}

/** True when the thread is in this workspace. */
export async function threadInWorkspace(db: SupabaseClient, workspaceId: string, threadId: string): Promise<boolean> {
  if (!isUuid(threadId)) return false;
  const row = must(await db.from("threads").select("id").eq("id", threadId).eq("workspace_id", workspaceId).maybeSingle());
  return Boolean(row);
}

/** The person's last message in a thread of this workspace, for Retry and Ask someone else. Null when there is none. */
export async function lastUserText(db: SupabaseClient, workspaceId: string, threadId: string): Promise<string | null> {
  if (!isUuid(threadId)) return null;
  const row = must(await db.from("messages").select("content, meta").eq("thread_id", threadId).eq("workspace_id", workspaceId).eq("role", "user").order("id", { ascending: false }).limit(1).maybeSingle()) as { content?: string; meta?: Record<string, unknown> | null } | null;
  if (typeof row?.content !== "string") return null;
  // A message of only files has no words, and can still be answered again.
  return row.content.trim() || storedFiles(row.meta, workspaceId).length ? row.content : null;
}

/** A thread's title: the first message on one line, cut to 70 letters at a word. */
export function threadTitle(text: string): string {
  const raw = text.replace(/\s+/g, " ").trim();
  // Leading @teammates, /skills and a use case's "Start:" say who and how, not what the chat is about.
  const one = raw.replace(/^(?:(?:@[a-z]+|\/[a-z0-9-]+)[,:]?\s+)+/i, "").replace(/^start:\s*/i, "").trim() || raw;
  if (one.length <= 70) return one;
  const cut = one.slice(0, 70);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}...`;
}

export function teamStore(db: SupabaseClient, workspaceId: string): TeamStore {
  return {
    async history(threadId) {
      // The newest messages, put back in order.
      const rows = must(await db.from("messages").select("id, role, agent, content, meta").eq("thread_id", threadId).eq("workspace_id", workspaceId).order("id", { ascending: false }).limit(HISTORY)) as (StoredMessage & { id: number })[];
      return [...(rows ?? [])].reverse().map((r) => ({ role: r.role, agent: isAgentKey(r.agent) ? r.agent : null, content: r.content, meta: r.meta ?? null }));
    },
    async addMessage(m: NewMessage) {
      if (m.workspace_id !== workspaceId) throw new Error("That message is for another workspace.");
      must(await db.from("messages").insert(m));
    },
    async prefs() {
      const rows = must(await db.from("agent_prefs").select("agent, enabled, trust, model, settings").eq("workspace_id", workspaceId)) as { agent: string; enabled: boolean; trust: number; model: string; settings: Record<string, unknown> | null }[];
      const out: Partial<Record<AgentKey, Partial<Pref>>> = {};
      for (const r of rows ?? []) {
        if (!isAgentKey(r.agent)) continue;
        out[r.agent] = {
          enabled: r.enabled !== false,
          trust: r.trust === 1 || r.trust === 2 ? r.trust : 0,
          model: isModelChoice(r.model) ? r.model : "auto",
          booking: r.settings?.booking ? cleanBooking(r.settings.booking) : null,
        };
      }
      return out;
    },
    async recordUsage(u: UsageRow) {
      if (u.workspace_id !== workspaceId) throw new Error("That usage is for another workspace.");
      must(await db.from("ai_usage").insert(u));
    },
    async spendSince(since) {
      const r = await db.rpc("ai_spend", { p_ws: workspaceId, p_since: since });
      // Without the meter's numbers the team can't tell if it's over the allowance, so it doesn't run.
      if (r.error) throw new Error(`AI spend: ${r.error.message}`);
      const usd = Number(r.data);
      return Number.isFinite(usd) ? usd : 0;
    },
    async touchThread(threadId) {
      must(await db.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("workspace_id", workspaceId));
    },
  };
}
