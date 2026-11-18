// The scan_website job's handler for the worker (src/app/api/worker/route.ts): the real database, the safe fetch
// and the Claude client around scanWebsite (src/lib/siteScan.ts).
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Handler } from "./jobs.ts";
import { fetchPage } from "./siteFetch.ts";
import { scanWebsite, usageRow, type AiUsage, type AskClaude } from "./siteScan.ts";

type MessagesClient = { messages: { create: (body: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };

/** A hiccup worth trying again: rate limited, overloaded, a server error or the network. */
export function retryableClaudeError(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return true;
  return e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (typeof e.status === "number" && e.status >= 500));
}

/** One Claude call through the SDK, as an AskClaude. JSON comes back through structured outputs. */
export function askWith(client: MessagesClient): AskClaude {
  return async ({ model, system, user, schema, maxTokens }) => {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      });
      // A response can start with thinking blocks, so read the text blocks by type.
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return { text, stopReason: res.stop_reason ?? null, model: res.model, usage: res.usage };
    } catch (e) {
      throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { retryable: retryableClaudeError(e) });
    }
  };
}

/** The AI meter for the scan's one Claude call: a row in ai_usage, so it counts against the month's allowance.
 *  A failed write is logged and never fails the scan. */
function meterWith(db: SupabaseClient) {
  return async (u: AiUsage): Promise<void> => {
    const { error } = await db.from("ai_usage").insert(usageRow(u));
    if (error) warn(`AI usage for the website scan of workspace ${u.workspaceId} wasn't saved: ${error.message}`);
  };
}

function warn(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { job_kind: "scan_website" } });
}

export function knowledgeJobHandlers(db: SupabaseClient, env: Record<string, string | undefined> = process.env): Record<string, Handler> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const claude = key ? askWith(new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 })) : null;
  return {
    scan_website: (job) =>
      scanWebsite({
        workspaceId: job.workspace_id,
        workspace: async () => {
          const { data, error } = await db.from("workspaces").select("name, website").eq("id", job.workspace_id).maybeSingle();
          if (error) throw new Error(`Could not read the workspace: ${error.message}`);
          return data as { name: string; website: string | null } | null;
        },
        fetchPage: (url) => fetchPage(url),
        claude,
        save: async (doc) => {
          const { error } = await db.rpc("save_website_doc", { ws: job.workspace_id, p_title: doc.title, p_body: doc.body, p_url: doc.url });
          if (error) throw new Error(/save_website_doc/.test(error.message) ? "Run supabase/012_knowledge.sql in Supabase." : `Could not save the website doc: ${error.message}`);
        },
        meter: meterWith(db),
        warn,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
      }),
  };
}
