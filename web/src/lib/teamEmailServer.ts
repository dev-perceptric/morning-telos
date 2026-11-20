// The email door on the server: src/lib/teamEmailInbound.ts's deps over Supabase (service role) and Resend, and the
// worker's team_email job. Every query names the workspace (CLAUDE.md: server code checks the workspace too).
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runTurn, type LoopClient, type TeamStore } from "./agentLoop.ts";
import { approveUrl, makeApproveToken, newNonce } from "./approveLink.ts";
import type { StoredFile } from "./attachments.ts";
import { fileReader, saveFile } from "./attachmentsServer.ts";
import { brainTools, teamContext } from "./brainServer.ts";
import { getReceivedEmail, listReceivedAttachments, sendBuilt } from "./email.ts";
import type { Handler } from "./jobs.ts";
import { claudeRouter } from "./router.ts";
import { envKeyring } from "./sealing.ts";
import { capTrust, pickAttachments, type DropReason, type SenderRow } from "./teamEmail.ts";
import type { InboundDeps, JobDeps } from "./teamEmailInbound.ts";
import { processTeamEmail } from "./teamEmailInbound.ts";
import { loadWorkspace, teamStore } from "./teamStore.ts";
import { teamTools } from "./teamTools.ts";

type Env = Record<string, string | undefined>;

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

async function findSender(db: SupabaseClient, ws: string, email: string): Promise<SenderRow | null> {
  const rows = must(await db.rpc("team_email_sender", { p_ws: ws, p_email: email }), "Sender wasn't checked") as SenderRow[] | SenderRow | null;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row ?? null;
}

async function countDrop(db: SupabaseClient, reason: DropReason, log: (m: string) => void) {
  const { error } = await db.rpc("count_team_email_drop", { p_reason: reason });
  if (error) log(`Team email drop (${reason}) wasn't counted: ${error.message}`);
}

/** What POST /api/email/inbound needs. */
export function inboundDeps(db: SupabaseClient, o: { domain: string | null; secret: string | undefined; log: (m: string) => void }): InboundDeps {
  return {
    domain: o.domain,
    secret: o.secret,
    findAddress: async (slug) => must(await db.from("team_email").select("workspace_id, enabled").eq("slug", slug).maybeSingle(), "Address wasn't read") as { workspace_id: string; enabled: boolean } | null,
    sender: (ws, email) => findSender(db, ws, email),
    queue: async (emailId, ws) => Boolean(must(await db.rpc("queue_team_email", { p_email_id: emailId, p_ws: ws }), "Email wasn't queued")),
    drop: (reason) => countDrop(db, reason, o.log),
  };
}

export type TeamEmailServerDeps = {
  client: () => LoopClient | null;
  log: (message: string) => void;
  env?: Env;
  fetch?: typeof fetch;
};

/** The worker's team_email job. Up to 3 tries while the email is being read; never twice once it is saved. */
export function teamEmailJobHandlers(db: SupabaseClient, deps: TeamEmailServerDeps, domain: string | null, appUrl: string): Record<string, Handler> {
  return {
    team_email: async (job) => {
      if (!domain) return { status: "failed", error: "TEAM_EMAIL_DOMAIN is not set, so team email is off." };
      const env = deps.env ?? process.env;
      const key = env.RESEND_API_KEY?.trim() ?? "";
      const net = deps.fetch ?? fetch;
      if (!key) return { status: "failed", error: "RESEND_API_KEY is not set, so the email can't be read." };
      const ws = job.workspace_id;
      const workspace = ws ? await loadWorkspace(db, ws) : null;
      if (!ws || !workspace) return { status: "done" };
      const log = deps.log;

      const d: JobDeps = {
        domain,
        appUrl,
        now: () => Date.now(),
        getEmail: (id) => getReceivedEmail(id, { key, fetch: net }),
        address: async (w) => must(await db.from("team_email").select("slug, enabled").eq("workspace_id", w).maybeSingle(), "Address wasn't read") as { slug: string; enabled: boolean } | null,
        sender: (w, email) => findSender(db, w, email),
        inboundSince: async (w, since) => {
          const r = await db.from("team_email_messages").select("id", { count: "exact", head: true }).eq("workspace_id", w).eq("direction", "in").gte("created_at", since);
          if (r.error) throw new Error(`Recent emails weren't counted: ${r.error.message}`);
          return r.count ?? 0;
        },
        drop: (reason) => countDrop(db, reason, log),
        threadByToken: async (w, token) => must(await db.from("team_email_threads").select("thread_id, token").eq("workspace_id", w).eq("token", token).maybeSingle(), "Chat wasn't read") as { thread_id: string; token: string } | null,
        threadsByMessageIds: async (w, ids) => {
          const rows = (must(await db.from("team_email_messages").select("message_id, thread_id").eq("workspace_id", w).in("message_id", ids.slice(0, 50)), "Chats weren't read") ?? []) as { message_id: string; thread_id: string }[];
          return Object.fromEntries(rows.map((r) => [r.message_id, r.thread_id]));
        },
        tokenOf: async (w, threadId) => ((must(await db.from("team_email_threads").select("token").eq("workspace_id", w).eq("thread_id", threadId).maybeSingle(), "Chat wasn't read") as { token: string } | null)?.token ?? null),
        startThread: async (w, t) => {
          must(await db.from("threads").insert({ id: t.id, workspace_id: w, title: t.title, created_by: t.createdBy }), "Chat wasn't started");
          must(await db.from("team_email_threads").insert({ thread_id: t.id, workspace_id: w, token: t.token, subject: t.subject }), "Chat's email wasn't saved");
        },
        recordMessage: async (w, threadId, messageId, direction) => {
          const { error } = await db.from("team_email_messages").insert({ workspace_id: w, thread_id: threadId, message_id: messageId, direction });
          if (error && (error as { code?: string }).code === "23505") return false;
          if (error) throw new Error(`Email wasn't saved: ${error.message}`);
          return true;
        },
        references: async (w, threadId) => ((must(await db.from("team_email_messages").select("message_id").eq("workspace_id", w).eq("thread_id", threadId).order("id", { ascending: true }).limit(200), "Chat's emails weren't read") ?? []) as { message_id: string }[]).map((r) => r.message_id),
        saveMessage: async (w, threadId, content, meta) => {
          must(await db.from("messages").insert({ thread_id: threadId, workspace_id: w, role: "user", agent: null, content, meta }), "Message wasn't saved");
        },
        saveAttachments: async (w, emailId) => {
          const { take, skip } = pickAttachments(await listReceivedAttachments(emailId, { key, fetch: net }));
          const files: StoredFile[] = [];
          const skipped = skip.map((a) => a.filename);
          for (const a of take) {
            try {
              // Resend's own short-lived download link, never an address from the email.
              if (!/^https:\/\//.test(a.download_url)) throw new Error("no download link");
              const res = await net(a.download_url, { signal: AbortSignal.timeout(30_000) });
              if (!res.ok) throw new Error(`download returned ${res.status}`);
              const r = await saveFile(db, w, a.filename, new Uint8Array(await res.arrayBuffer()), log);
              if (!r.ok) throw new Error(r.error);
              files.push(r.file);
            } catch (err) {
              log(`Team email ${emailId}: ${a.filename} wasn't kept: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
              skipped.push(a.filename);
            }
          }
          return { files, skipped };
        },
        runTurn: async (w, threadId, text, emit) => {
          const client = deps.client();
          const base = teamStore(db, w);
          // An email can be faked, so on an email turn every change waits for the owner's approval, even on autopilot.
          const store: TeamStore = { ...base, prefs: async () => capTrust(await base.prefs()) };
          await runTurn(
            { workspace, threadId, text },
            {
              client,
              router: client ? claudeRouter(client as Parameters<typeof claudeRouter>[0]) : null,
              store,
              emit,
              log,
              // The email's images and PDFs, saved as chat files above, read from storage once for the turn.
              files: fileReader(db, w, [], log),
              tools: teamTools(db, { log, extra: [brainTools(db, w)] }),
              context: teamContext(db, { text, log }),
            },
          );
        },
        approveLink: async (w, approvalId, userId) => {
          const nonce = newNonce();
          const { token, expiresAt } = makeApproveToken(envKeyring(env), { approvalId, workspaceId: w, userId, nonce, now: Date.now() });
          must(await db.from("approval_links").insert({ nonce, approval_id: approvalId, workspace_id: w, user_id: userId, expires_at: expiresAt }), "Approve link wasn't saved");
          return approveUrl(appUrl, approvalId, token);
        },
        send: async (to, mail, o) => {
          await sendBuilt([to], mail, { key, from: o.from, fetch: net }, { replyTo: o.replyTo, headers: o.headers, idempotencyKey: o.idempotencyKey });
        },
        newId: () => randomUUID(),
        log,
      };
      return processTeamEmail(job, d);
    },
  };
}
