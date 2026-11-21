"use client";

// Hestia's Inbox tab: the replies she wrote to customers, waiting or sent, and one drawer to edit, send, turn down or
// save one to Knowledge. The rules are in src/lib/inboxWork.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { emailInputWith } from "@/lib/cards";
import { appLogo } from "@/lib/composio/catalog";
import { ago } from "@/lib/home";
import { faqOf, inboxSummary, repliesOf, SUPPORT_APPS, type Reply } from "@/lib/inboxWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Row = Parameters<typeof repliesOf>[0][number];
const WORD: Record<Reply["status"], string> = { wait: "Waiting for your OK", sent: "Sent", failed: "Didn't send", denied: "Turned down" };

export function HestiaInbox({ sb, ws, editor, onAsk }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void }) {
  const [view, setView] = useState<"wait" | "sent">("wait");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    sb.from("approvals")
      .select("id, product, tool, title, input, status, result, created_at, finished_at")
      .eq("workspace_id", ws.id)
      .eq("agent", "support")
      .in("product", [...SUPPORT_APPS])
      .order("id", { ascending: false })
      .limit(100)
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setError("We couldn't load Hestia's replies. Try again.");
        setError("");
        setRows((data ?? []) as Row[]);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const replies = repliesOf(rows ?? []);
  const waiting = replies.filter((r) => r.status === "wait");
  const list = view === "wait" ? waiting : replies.filter((r) => r.status !== "wait");
  const summary = inboxSummary(replies);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
      setOpen(null);
      setNote(done);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  }
  const decide = (id: number, action: "approve" | "deny", input?: Record<string, unknown>) => callApi(sb, `/api/approvals/${id}`, { workspaceId: ws.id, action, ...(input ? { input } : {}) });

  return (
    <>
      {summary ? (
        <p className="po-sum">
          <Face agent="support" size={26} />
          <span>{summary}</span>
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}
      <div className="po-bar">
        <span className="seg" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" aria-checked={view === "wait"} onClick={() => setView("wait")}>
            Waiting <span className="seg-n">{waiting.length || ""}</span>
          </button>
          <button type="button" role="radio" aria-checked={view === "sent"} onClick={() => setView("sent")}>
            Sent <span className="seg-n">{replies.length - waiting.length || ""}</span>
          </button>
        </span>
        <span className="flex-1" />
        {editor && waiting.length ? (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                for (const r of waiting) await decide(r.approvalId, "approve");
              }, waiting.length === 1 ? "Sent." : `Sent ${waiting.length} replies.`)
            }
          >
            Approve {waiting.length} waiting
          </button>
        ) : null}
      </div>
      <div className="card list vis">
        {list.map((r) => (
          <button key={r.approvalId} type="button" className={`row${r.status === "wait" ? " wait" : ""}`} onClick={() => setOpen(r)}>
            <span className="lg-img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={appLogo(r.product)} alt="" width={20} height={20} />
            </span>
            <span className="main">
              <b>
                {r.to ? `${r.to}: ` : ""}
                {r.subject}
              </b>
              <small>{r.body.length > 140 ? `${r.body.slice(0, 140).replace(/\s+\S*$/, "")}...` : r.body}</small>
            </span>
            <span className="goal-r">
              {r.status === "wait" ? <span className="tag clay wt">Waiting for your OK</span> : r.status === "sent" ? <span className="tag green ok">Sent</span> : <span className="tag">{WORD[r.status]}</span>}
              <span className="hint-s">{ago(r.at)}</span>
            </span>
          </button>
        ))}
        {rows && !list.length ? (
          view === "wait" ? (
            <Empty title="All caught up">Hestia writes replies from your Knowledge and waits for your OK before anything goes to a customer.</Empty>
          ) : (
            <Empty title="Nothing sent yet">Replies you approve show up here.</Empty>
          )
        ) : null}
        {rows === null && !error ? <div className="empty">Loading...</div> : null}
      </div>

      <Drawer open={open !== null} title={open ? WORD[open.status] : ""} onClose={() => setOpen(null)}>
        {open ? (
          <ReplyDrawer
            key={open.approvalId}
            r={open}
            row={(rows ?? []).find((x) => x.id === open.approvalId) ?? null}
            editor={editor}
            busy={busy}
            onAsk={() => onAsk(`About the reply "${open.subject}": `)}
            onSend={(input) => run(() => decide(open.approvalId, "approve", input), "Sent.")}
            onDeny={() => run(() => decide(open.approvalId, "deny"), "Turned down. Nothing was sent.")}
            onFaq={() => run(() => callApi(sb, "/api/knowledge", { workspaceId: ws.id, agent: "support", ...faqOf(open) }), "Saved to Knowledge. Hestia uses it from now on.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function ReplyDrawer({
  r,
  row,
  editor,
  busy,
  onAsk,
  onSend,
  onDeny,
  onFaq,
}: {
  r: Reply;
  row: Row | null;
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onSend: (input?: Record<string, unknown>) => void;
  onDeny: () => void;
  onFaq: () => void;
}) {
  const [subject, setSubject] = useState(r.subject);
  const [body, setBody] = useState(r.body);
  const canEdit = editor && r.status === "wait";
  const edited = subject !== r.subject || body !== r.body;
  return (
    <>
      <div className="facts dsec">
        <div>
          <small>To</small>
          <b>{r.to ?? "The customer"}</b>
        </div>
        <div>
          <small>From</small>
          <b>{r.app}</b>
        </div>
        <div>
          <small>{r.status === "wait" ? "Written" : WORD[r.status]}</small>
          <b>{ago(r.at)}</b>
        </div>
      </div>
      {r.why ? <ErrorText>{r.why}</ErrorText> : null}
      {canEdit ? (
        <div className="po-f dsec">
          <label htmlFor="r-subj">Subject</label>
          <input id="r-subj" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label htmlFor="r-body" className="mt-3">
            Hestia&apos;s reply
          </label>
          <textarea id="r-body" value={body} style={{ minHeight: 180 }} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <div className="emprev dsec">
          <div className="subj">{r.subject}</div>
          <p>{r.body}</p>
        </div>
      )}
      <div className="po-foot">
        {canEdit ? (
          <>
            <button type="button" className="btn primary" disabled={busy || !body.trim()} onClick={() => onSend(edited && row?.input ? emailInputWith(row.input, { to: r.to ?? "", subject, body }) : undefined)}>
              Approve and send
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onDeny}>
              Don&apos;t send
            </button>
          </>
        ) : null}
        {editor && r.status === "sent" ? (
          <button type="button" className="btn" disabled={busy} onClick={onFaq}>
            Add to FAQ
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onAsk}>
          <Icon name="message" small />
          Ask Hestia
        </button>
      </div>
    </>
  );
}
