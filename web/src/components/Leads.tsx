"use client";

// Hermes's Leads tab: the business's leads and open quotes (028_leads.sql), his follow-ups waiting for the person's
// OK, and one drawer to change, close, delete or follow up on a lead. Editors change leads straight in the database
// under its policies. The rules are in src/lib/leads.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { emailInputWith } from "@/lib/cards";
import { ago } from "@/lib/home";
import { cleanLead, followupsByEmail, LEAD_COLUMNS, leadsSummary, type Lead, type Stage } from "@/lib/leads";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Followup = { approvalId: number; to: string; subject: string | null; body: string | null; input: Record<string, unknown> };
const STAGE_WORD: Record<Stage, string> = { open: "Open", won: "Won", lost: "Lost" };
const money = (n: number | null) => (n === null ? "" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const initials = (n: string) => n.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function HermesLeads({ sb, ws, editor, onAsk }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void }) {
  const [view, setView] = useState<Stage>("open");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [follow, setFollow] = useState<Map<string, Followup[]>>(new Map());
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<{ lead: Lead | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      sb.from("leads").select(LEAD_COLUMNS).eq("workspace_id", ws.id).order("next_date", { ascending: true, nullsFirst: false }).order("updated_at", { ascending: false }).limit(500),
      sb.from("approvals").select("id, product, input, status").eq("workspace_id", ws.id).eq("agent", "sales").eq("status", "pending").in("product", ["gmail", "outlook"]).limit(200),
    ]).then(([l, a]) => {
      if (!live) return;
      if (l.error) return setError("We couldn't load Hermes's leads. Try again.");
      setError("");
      setLeads(((l.data ?? []) as Lead[]).map((x) => ({ ...x, value: x.value === null ? null : Number(x.value) })));
      setFollow(followupsByEmail((a.data ?? []) as Parameters<typeof followupsByEmail>[0]));
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const all = leads ?? [];
  const list = all.filter((l) => l.stage === view);
  const waitingFor = (l: Lead) => (l.email ? (follow.get(l.email.toLowerCase()) ?? []) : []);
  const waitingCount = [...new Set([...follow.values()].flat().map((f) => f.approvalId))].length;
  const summary = leadsSummary(all, waitingCount);

  async function run(fn: () => PromiseLike<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = (await fn()) as { error?: { message: string } | null } | undefined;
      if (r && r.error) throw new Error(/leads_ws_email_idx/.test(r.error.message) ? "A lead with that email is already on the list." : "That didn't save. Try again.");
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
          <Face agent="sales" size={26} />
          <span>{summary}</span>
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}
      <div className="po-bar">
        <span className="seg" role="radiogroup" aria-label="Show">
          {(["open", "won", "lost"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={view === s} onClick={() => setView(s)}>
              {STAGE_WORD[s]} <span className="seg-n">{all.filter((l) => l.stage === s).length || ""}</span>
            </button>
          ))}
        </span>
        <span className="flex-1" />
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => setOpen({ lead: null })}>
            <Icon name="plus" small />
            Add lead
          </button>
        ) : null}
      </div>
      <div className="card list vis">
        {list.map((l) => {
          const w = waitingFor(l).length;
          return (
            <button key={l.id} type="button" className={`row${w ? " wait" : ""}`} onClick={() => setOpen({ lead: l })}>
              <span className="av-i">{initials(l.name)}</span>
              <span className="main">
                <b>
                  {l.name}
                  {l.company ? `, ${l.company}` : ""}
                </b>
                <small>
                  {l.last_contact ? `Last contact ${ago(l.last_contact)}` : "No contact yet"}
                  {l.next_step ? `. Next: ${l.next_step}${l.next_date ? `, ${dayText(l.next_date)}` : ""}` : ""}
                </small>
              </span>
              <span className="goal-r">
                {w ? <span className="tag clay wt">Follow-up waiting</span> : null}
                {l.value !== null ? <b className="lead-v">{money(l.value)}</b> : null}
              </span>
            </button>
          );
        })}
        {leads && !list.length ? (
          view === "open" ? (
            <Empty title="No open leads">Hermes adds every new lead he finds in your inbox. You can add one too.</Empty>
          ) : (
            <Empty title={view === "won" ? "No wins yet" : "Nothing lost"}>{view === "won" ? "Deals you win show up here." : "Deals that didn't happen show up here."}</Empty>
          )
        ) : null}
        {leads === null && !error ? <div className="empty">Loading...</div> : null}
      </div>

      <Drawer open={open !== null} title={open?.lead ? `${open.lead.name}${open.lead.company ? `, ${open.lead.company}` : ""}` : "Add lead"} onClose={() => setOpen(null)}>
        {open ? (
          <LeadDrawer
            key={open.lead?.id ?? "new"}
            lead={open.lead}
            follow={open.lead ? waitingFor(open.lead) : []}
            editor={editor}
            busy={busy}
            onAsk={() => onAsk(open.lead ? `About ${open.lead.name}${open.lead.company ? ` at ${open.lead.company}` : ""}: ` : undefined)}
            onSave={(f) =>
              run(
                () =>
                  open.lead
                    ? sb.from("leads").update({ ...f, updated_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("id", open.lead.id)
                    : sb.from("leads").insert({ ...f, workspace_id: ws.id, source: "person" }),
                open.lead ? "Saved." : "Lead added. Hermes will follow up.",
              )
            }
            onStage={(stage) => open.lead && run(() => sb.from("leads").update({ stage, updated_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("id", open.lead!.id), stage === "won" ? "Marked won." : stage === "lost" ? "Marked lost." : "Opened again.")}
            onDelete={() => open.lead && run(() => sb.from("leads").delete().eq("workspace_id", ws.id).eq("id", open.lead!.id), "Lead deleted.")}
            onFollow={(f, action, input) => run(() => decide(f.approvalId, action, input), action === "approve" ? "Follow-up sent." : "Turned down. Nothing was sent.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function LeadDrawer({
  lead,
  follow,
  editor,
  busy,
  onAsk,
  onSave,
  onStage,
  onDelete,
  onFollow,
}: {
  lead: Lead | null;
  follow: Followup[];
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onSave: (f: Record<string, unknown>) => void;
  onStage: (s: Stage) => void;
  onDelete: () => void;
  onFollow: (f: Followup, action: "approve" | "deny", input?: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({
    name: lead?.name ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    value: lead?.value === null || lead?.value === undefined ? "" : String(lead.value),
    next_step: lead?.next_step ?? "",
    next_date: lead?.next_date ?? "",
    notes: lead?.notes ?? "",
  });
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const first = follow[0] ?? null;
  const [draft, setDraft] = useState(first?.body ?? "");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const c = cleanLead(f);
    if (!c.ok) return setProblem(c.error);
    setProblem("");
    onSave(c.value);
  };

  return (
    <>
      {first ? (
        <div className="dsec">
          <h4>Hermes&apos;s follow-up, waiting for your OK</h4>
          <div className="po-f">
            {first.subject ? <p className="hint-s">Subject: {first.subject}</p> : null}
            <textarea aria-label="Follow-up email" value={draft} style={{ minHeight: 140 }} disabled={!editor} onChange={(e) => setDraft(e.target.value)} />
          </div>
          {editor ? (
            <div className="po-foot" style={{ marginTop: 10 }}>
              <button type="button" className="btn primary" disabled={busy || !draft.trim()} onClick={() => onFollow(first, "approve", draft !== first.body ? emailInputWith(first.input, { to: first.to, subject: first.subject ?? "", body: draft }) : undefined)}>
                Approve and send
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => onFollow(first, "deny")}>
                Don&apos;t send
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {editor ? (
        <div className="po-f dsec">
          <div className="row2" style={{ marginTop: 0 }}>
            <div>
              <label htmlFor="l-name">Name</label>
              <input id="l-name" type="text" value={f.name} maxLength={120} onChange={set("name")} />
            </div>
            <div>
              <label htmlFor="l-co">Business</label>
              <input id="l-co" type="text" value={f.company} maxLength={120} onChange={set("company")} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label htmlFor="l-mail">Email</label>
              <input id="l-mail" type="email" value={f.email} maxLength={200} onChange={set("email")} />
            </div>
            <div>
              <label htmlFor="l-val">Deal value</label>
              <input id="l-val" type="text" inputMode="decimal" value={f.value} placeholder="$2,000" onChange={set("value")} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label htmlFor="l-next">Next step</label>
              <input id="l-next" type="text" value={f.next_step} maxLength={200} placeholder="Follow up on the quote" onChange={set("next_step")} />
            </div>
            <div>
              <label htmlFor="l-date">When</label>
              <input id="l-date" type="date" value={f.next_date} onChange={set("next_date")} />
            </div>
          </div>
          <label htmlFor="l-notes" className="mt-3">
            Notes
          </label>
          <textarea id="l-notes" value={f.notes} maxLength={4000} style={{ minHeight: 90 }} onChange={set("notes")} />
        </div>
      ) : lead ? (
        <div className="facts dsec">
          <div>
            <small>Deal value</small>
            <b>{money(lead.value) || "Not set"}</b>
          </div>
          <div>
            <small>Next step</small>
            <b>{lead.next_step || "None yet"}</b>
          </div>
          <div>
            <small>Email</small>
            <b className="wrap-any">{lead.email ?? "None"}</b>
          </div>
        </div>
      ) : null}
      {problem ? <ErrorText>{problem}</ErrorText> : null}
      <div className="po-foot">
        {editor ? (
          <button type="button" className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>
            {lead ? "Save" : "Add lead"}
          </button>
        ) : null}
        {editor && lead && lead.stage === "open" ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => onStage("won")}>
              Mark won
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onStage("lost")}>
              Mark lost
            </button>
          </>
        ) : editor && lead ? (
          <button type="button" className="btn" disabled={busy} onClick={() => onStage("open")}>
            Open again
          </button>
        ) : null}
        {lead ? (
          <button type="button" className="btn" onClick={onAsk}>
            <Icon name="message" small />
            Ask Hermes
          </button>
        ) : null}
        <span className="sp" />
        {editor && lead ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={onDelete}>
                Delete lead
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Delete lead" title="Delete lead" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}
