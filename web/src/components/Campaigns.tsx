"use client";

// Iris's Campaigns tab and her mailing list settings. Drafts are written and canceled straight in the database under
// the campaigns policies (029_campaigns.sql); approving one schedules it through /api/work/email, which checks the
// address, the inbox and the list first. The worker sends it a few at a time (src/lib/campaignSend.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { fromInputs, inputsOf } from "@/lib/calendar";
import { CAMPAIGN_COLUMNS, campaignsSummary, cleanAddress, cleanCampaign, DEFAULT_LIST, emailFor, footer, parseContacts, type Campaign } from "@/lib/campaigns";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Setup = { address: string | null; inbox: "gmail" | "outlook" | null; lists: { list: string; people: number }[]; people: number };
const VIEW_OF: Record<Campaign["status"], "draft" | "out" | "sent"> = { draft: "draft", scheduled: "out", sending: "out", sent: "sent", canceled: "sent" };
const when = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** The mailing list's lists, people who can get email, the address and the inbox, for the tab and the settings. */
async function loadSetup(sb: SupabaseClient, ws: string): Promise<Setup> {
  const [c, p, a] = await Promise.all([
    sb.from("contacts").select("list").eq("workspace_id", ws).is("unsubscribed_at", null).limit(20000),
    sb.from("agent_prefs").select("settings").eq("workspace_id", ws).eq("agent", "email").maybeSingle(),
    sb.from("app_connections").select("toolkit, status").eq("workspace_id", ws).in("toolkit", ["gmail", "outlook"]),
  ]);
  const n = new Map<string, number>();
  for (const r of (c.data ?? []) as { list: string }[]) n.set(r.list, (n.get(r.list) ?? 0) + 1);
  const conns = ((a.data ?? []) as { toolkit: string; status: string }[]).filter((x) => x.status === "active");
  return {
    address: cleanAddress((p.data as { settings?: Record<string, unknown> } | null)?.settings?.mail_address),
    inbox: conns.some((x) => x.toolkit === "gmail") ? "gmail" : conns.some((x) => x.toolkit === "outlook") ? "outlook" : null,
    lists: [...n].map(([list, people]) => ({ list, people })).sort((x, y) => y.people - x.people),
    people: (c.data ?? []).length,
  };
}

export function IrisCampaigns({ sb, ws, editor, onAsk, onSettings }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void; onSettings: () => void }) {
  const [view, setView] = useState<"draft" | "out" | "sent">("draft");
  const [list, setList] = useState<Campaign[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<{ c: Campaign | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([sb.from("campaigns").select(CAMPAIGN_COLUMNS).eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(200), loadSetup(sb, ws.id)]).then(([c, s]) => {
      if (!live) return;
      if (c.error) return setError("We couldn't load Iris's campaigns. Try again.");
      setError("");
      setList((c.data ?? []) as Campaign[]);
      setSetup(s);
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const all = list ?? [];
  const shown = all.filter((c) => VIEW_OF[c.status] === view);
  const counts = { draft: 0, out: 0, sent: 0 };
  for (const c of all) counts[VIEW_OF[c.status]]++;
  const summary = campaignsSummary(all, setup?.people ?? 0);

  async function run(fn: () => PromiseLike<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = (await fn()) as { error?: { message: string } | null } | undefined;
      if (r && r.error) throw new Error("That didn't save. Try again.");
      setOpen(null);
      setNote(done);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  }

  return (
    <>
      {setup && !setup.address ? (
        <div className="ag-alert">
          <span>Add your mailing address so campaigns can go out. The law requires it on marketing emails.</span>
          <button type="button" className="btn sm" onClick={onSettings}>
            Add address
          </button>
        </div>
      ) : null}
      {setup && !setup.inbox ? (
        <div className="ag-alert">
          <span>Connect Gmail or Outlook. Campaigns go out from your own inbox.</span>
          <button type="button" className="btn sm" onClick={() => navigate("/settings/apps")}>
            Connect
          </button>
        </div>
      ) : null}
      {summary ? (
        <p className="po-sum">
          <Face agent="email" size={26} />
          <span>{summary}</span>
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}
      <div className="po-bar">
        <span className="seg" role="radiogroup" aria-label="Show">
          {(
            [
              ["draft", "Drafts"],
              ["out", "Going out"],
              ["sent", "Sent"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {l} <span className="seg-n">{counts[v] || ""}</span>
            </button>
          ))}
        </span>
        <span className="flex-1" />
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => setOpen({ c: null })}>
            <Icon name="plus" small />
            New campaign
          </button>
        ) : null}
      </div>
      <div className="card list vis">
        {shown.map((c) => (
          <button key={c.id} type="button" className="row" onClick={() => setOpen({ c })}>
            <span className="lg-img">
              <Icon name="mail" small />
            </span>
            <span className="main">
              <b>{c.subject}</b>
              <small>
                {c.list ?? "Everyone"}
                {c.source === "iris" ? ", written by Iris" : ""}
              </small>
            </span>
            <span className="goal-r">
              {c.status === "draft" ? <span className="tag">Draft</span> : null}
              {c.status === "scheduled" && c.send_at ? <span className="tag amber">Goes out {when(c.send_at)}</span> : null}
              {c.status === "sending" ? <span className="tag amber">Sending, {c.sent_count.toLocaleString()} so far</span> : null}
              {c.status === "sent" ? <span className="tag green ok">Sent to {c.sent_count.toLocaleString()}</span> : null}
              {c.status === "canceled" ? <span className="tag">Canceled</span> : null}
            </span>
          </button>
        ))}
        {list && !shown.length ? (
          view === "draft" ? (
            <Empty title="No drafts">Ask Iris to write a campaign, or write one yourself.</Empty>
          ) : view === "out" ? (
            <Empty title="Nothing going out">Campaigns you approve go out from your inbox a few at a time.</Empty>
          ) : (
            <Empty title="Nothing sent yet">Sent campaigns show up here.</Empty>
          )
        ) : null}
        {list === null && !error ? <div className="empty">Loading...</div> : null}
      </div>

      <Drawer open={open !== null} title={open?.c ? (open.c.status === "draft" ? "Draft" : open.c.status === "scheduled" || open.c.status === "sending" ? "Going out" : "Campaign") : "New campaign"} onClose={() => setOpen(null)}>
        {open && setup ? (
          <CampaignDrawer
            key={open.c?.id ?? "new"}
            c={open.c}
            setup={setup}
            business={ws.name}
            editor={editor}
            busy={busy}
            onAsk={() => onAsk(open.c ? `About the campaign "${open.c.subject}": ` : "Write a campaign about ")}
            onSave={(v) =>
              run(
                () =>
                  open.c
                    ? sb.from("campaigns").update({ ...v, updated_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("id", open.c.id)
                    : sb.from("campaigns").insert({ ...v, workspace_id: ws.id }),
                "Draft saved.",
              )
            }
            onSchedule={async (v, sendAt) => {
              if (!open.c) return;
              await run(async () => {
                const saved = await sb.from("campaigns").update({ ...v, updated_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("id", open.c!.id);
                if (saved.error) throw new Error("That didn't save. Try again.");
                const r = await callApi<{ people: number }>(sb, "/api/work/email", { workspaceId: ws.id, action: "schedule", campaignId: open.c!.id, sendAt });
                return r;
              }, "Approved. It goes out from your inbox a few at a time.");
            }}
            onTest={() => open.c && run(() => callApi<{ to: string }>(sb, "/api/work/email", { workspaceId: ws.id, action: "test", campaignId: open.c!.id }), "Test sent to your email.")}
            onStatus={(status) => open.c && run(() => sb.from("campaigns").update({ status, updated_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("id", open.c!.id), status === "draft" ? "Moved back to drafts." : "Canceled. Nothing more goes out.")}
            onDelete={() => open.c && run(() => sb.from("campaigns").delete().eq("workspace_id", ws.id).eq("id", open.c!.id), "Draft deleted.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function CampaignDrawer({
  c,
  setup,
  business,
  editor,
  busy,
  onAsk,
  onSave,
  onSchedule,
  onTest,
  onStatus,
  onDelete,
}: {
  c: Campaign | null;
  setup: Setup;
  business: string;
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onSave: (v: { subject: string; body: string; list: string | null }) => void;
  onSchedule: (v: { subject: string; body: string; list: string | null }, sendAt: string | null) => void;
  onTest: () => void;
  onStatus: (s: "draft" | "canceled") => void;
  onDelete: () => void;
}) {
  const [subject, setSubject] = useState(c?.subject ?? "");
  const [body, setBody] = useState(c?.body ?? "Hi {{first_name}},\n\n");
  const [list, setList] = useState<string | null>(c?.list ?? null);
  const [day, setDay] = useState(() => inputsOf(new Date(Date.now() + 3600_000)).day);
  const [time, setTime] = useState("09:00");
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const draft = !c || c.status === "draft";
  const canEdit = editor && draft;
  const people = list ? (setup.lists.find((l) => l.list === list)?.people ?? 0) : setup.people;
  const preview = emailFor({ name: "Maria Lopez" }, { subject: subject || "Subject", body }, footer(business, setup.address ?? "Your mailing address", "https://..."));
  const values = () => {
    const v = cleanCampaign({ subject, body, list });
    if (!v.ok) {
      setProblem(v.error);
      return null;
    }
    setProblem("");
    return v.value;
  };

  return (
    <>
      {c && !draft ? (
        <div className="facts dsec">
          <div>
            <small>{c.status === "sent" ? "Sent to" : c.status === "canceled" ? "Went to" : "So far"}</small>
            <b>{c.sent_count.toLocaleString()} people</b>
          </div>
          <div>
            <small>Didn&apos;t go out</small>
            <b>{c.failed_count.toLocaleString()}</b>
          </div>
          <div>
            <small>{c.status === "scheduled" ? "Goes out" : "From"}</small>
            <b>{c.status === "scheduled" && c.send_at ? when(c.send_at) : c.from_app === "outlook" ? "Outlook" : "Gmail"}</b>
          </div>
        </div>
      ) : null}
      <div className="emprev dsec">
        <div className="hint-s" style={{ marginBottom: 4 }}>
          To Maria Lopez, from your {setup.inbox === "outlook" ? "Outlook" : "Gmail"}
        </div>
        <div className="subj">{preview.subject}</div>
        <p>{preview.body}</p>
      </div>
      {canEdit ? (
        <div className="po-f dsec">
          <label htmlFor="c-subj">Subject</label>
          <input id="c-subj" type="text" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <label htmlFor="c-body" className="mt-3">
            Email
          </label>
          <textarea id="c-body" value={body} maxLength={20000} style={{ minHeight: 200 }} onChange={(e) => setBody(e.target.value)} />
          <p className="hint-s">{"{{first_name}}"} becomes each person&apos;s first name. Your address and an unsubscribe link are added at the end.</p>
          <label className="mt-3">Who gets it</label>
          <div className="pick" role="group" aria-label="Who gets it">
            <button type="button" aria-pressed={list === null} onClick={() => setList(null)}>
              Everyone, {setup.people.toLocaleString()}
            </button>
            {setup.lists.map((l) => (
              <button key={l.list} type="button" aria-pressed={list === l.list} onClick={() => setList(l.list)}>
                {l.list}, {l.people.toLocaleString()}
              </button>
            ))}
          </div>
          {c ? (
            <div className="row2">
              <div>
                <label htmlFor="c-day">Day</label>
                <input id="c-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </div>
              <div>
                <label htmlFor="c-time">Time</label>
                <input id="c-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {problem ? <ErrorText>{problem}</ErrorText> : null}
      <div className="po-foot">
        {canEdit && c ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !people}
            title={people ? "" : "Nobody on this list yet"}
            onClick={() => {
              const v = values();
              if (v) onSchedule(v, fromInputs(day, time));
            }}
          >
            Approve for {people.toLocaleString()} {people === 1 ? "person" : "people"}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className={`btn${c ? "" : " primary"}`}
            disabled={busy}
            onClick={() => {
              const v = values();
              if (v) onSave(v);
            }}
          >
            Save draft
          </button>
        ) : null}
        {editor && c && c.status !== "sent" && c.status !== "canceled" ? (
          <button type="button" className="btn" disabled={busy} onClick={onTest}>
            Send a test to me
          </button>
        ) : null}
        {editor && c?.status === "scheduled" ? (
          <button type="button" className="btn" disabled={busy} onClick={() => onStatus("draft")}>
            Move back to drafts
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onAsk}>
          <Icon name="message" small />
          {c ? "Ask Iris" : "Ask Iris to write it"}
        </button>
        <span className="sp" />
        {editor && c && (c.status === "draft" || c.status === "canceled") ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={onDelete}>
                Delete
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Delete campaign" title="Delete campaign" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}

/** Iris's Settings: the mailing address every campaign ends with, and the mailing list. */
export function MailingSettings({ sb, ws, admin, editor }: { sb: SupabaseClient; ws: Workspace; admin: boolean; editor: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [address, setAddress] = useState("");
  const [listName, setListName] = useState(DEFAULT_LIST);
  const [one, setOne] = useState({ email: "", name: "" });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([loadSetup(sb, ws.id), sb.from("agent_prefs").select("settings").eq("workspace_id", ws.id).eq("agent", "email").maybeSingle()]).then(([s, p]) => {
      if (!live) return;
      const st = ((p.data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>;
      setSetup(s);
      setSettings(st);
      setAddress(typeof st.mail_address === "string" ? st.mail_address : "");
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const done = (text: string) => {
    setNote(text);
    setVersion((v) => v + 1);
  };
  async function saveAddress() {
    const a = cleanAddress(address);
    if (!a) return setError("Write the full mailing address, with the street number and city.");
    setBusy(true);
    setError("");
    const next = { ...settings, mail_address: a };
    const { error: e } = await sb.from("agent_prefs").upsert({ workspace_id: ws.id, agent: "email", settings: next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,agent" });
    setBusy(false);
    if (e) return setError("That didn't save. Try again.");
    done("Address saved. It goes at the end of every campaign.");
  }
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setNote("");
    const { rows, bad } = parseContacts(await file.text(), listName.trim() || DEFAULT_LIST);
    if (!rows.length) {
      setBusy(false);
      return setError("We didn't find any emails in that file. It needs a column of email addresses.");
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await sb.from("contacts").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, workspace_id: ws.id })), { onConflict: "workspace_id,email", ignoreDuplicates: true });
      if (e) {
        setBusy(false);
        return setError(/20,000/.test(e.message) ? "Your list is full at 20,000 people. Delete some first." : "Some contacts didn't save. Try again.");
      }
    }
    setBusy(false);
    done(`Imported ${rows.length.toLocaleString()} ${rows.length === 1 ? "person" : "people"}${bad ? `. ${bad.toLocaleString()} rows had no good email and were skipped` : ""}.`);
  }
  async function addOne() {
    const { rows } = parseContacts(`email,name\n${one.email},"${one.name.replace(/"/g, "")}"`, listName.trim() || DEFAULT_LIST);
    if (!rows.length) return setError("That email doesn't look right.");
    setBusy(true);
    setError("");
    const { error: e } = await sb.from("contacts").upsert(rows.map((r) => ({ ...r, workspace_id: ws.id })), { onConflict: "workspace_id,email", ignoreDuplicates: true });
    setBusy(false);
    if (e) return setError("That didn't save. Try again.");
    setOne({ email: "", name: "" });
    done("Added.");
  }

  if (!setup) return null;
  return (
    <section className="sec">
      <div className="sh">
        <h2>Mailing list</h2>
      </div>
      <div className="card book-r">
        <div className="po-f">
          <label htmlFor="m-addr">Your mailing address</label>
          <textarea id="m-addr" value={address} maxLength={300} style={{ minHeight: 70 }} disabled={!admin} placeholder={"123 Main St\nAustin, TX 78701"} onChange={(e) => setAddress(e.target.value)} />
          <p className="hint-s">The law requires it at the end of marketing emails.</p>
          {admin ? (
            <div className="po-foot" style={{ marginTop: 8 }}>
              <button type="button" className="btn sm" disabled={busy} onClick={saveAddress}>
                Save address
              </button>
            </div>
          ) : null}
        </div>
        <div className="dsec mt-3">
          <h4>Lists</h4>
          {setup.lists.length ? (
            <div className="chips">
              {setup.lists.map((l) => (
                <span key={l.list} className="tag">
                  {l.list}, {l.people.toLocaleString()}
                </span>
              ))}
            </div>
          ) : (
            <p className="hint-s">Nobody on the list yet.</p>
          )}
        </div>
        {editor ? (
          <div className="po-f">
            <div className="row2" style={{ marginTop: 0 }}>
              <div>
                <label htmlFor="m-list">List name</label>
                <input id="m-list" type="text" value={listName} maxLength={60} onChange={(e) => setListName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="m-file">Import a CSV</label>
                <input
                  id="m-file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div className="row2">
              <div>
                <label htmlFor="m-email">Add one person</label>
                <input id="m-email" type="email" value={one.email} placeholder="name@business.com" onChange={(e) => setOne({ ...one, email: e.target.value })} />
              </div>
              <div>
                <label htmlFor="m-name">Name</label>
                <input id="m-name" type="text" value={one.name} maxLength={120} onChange={(e) => setOne({ ...one, name: e.target.value })} />
              </div>
            </div>
            <div className="po-foot" style={{ marginTop: 8 }}>
              <button type="button" className="btn sm" disabled={busy || !one.email.trim()} onClick={addOne}>
                Add
              </button>
            </div>
            <p className="hint-s">Only add people who know your business or asked to hear from you. Anyone who unsubscribes is never emailed again.</p>
          </div>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {note ? <Notice>{note}</Notice> : null}
      </div>
    </section>
  );
}
