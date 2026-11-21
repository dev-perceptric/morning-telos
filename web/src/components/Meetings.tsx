"use client";

// Hora's Calendar tab: the business's meetings, busy time and Hora's waiting invites on one calendar, one drawer for
// any meeting, and her booking rules on the Settings tab. The data and the rules are in src/lib/formsWork.ts and
// src/lib/booking.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { bookingProblem, cleanBooking, DAY_NAMES, GAPS, LENGTHS, type Booking } from "@/lib/booking";
import { fromInputs, inputsOf, sameDay, startOfDay, step, timeOf, viewDays, viewTitle, weekStart } from "@/lib/calendar";
import { appName } from "@/lib/composio/catalog";
import type { Meeting } from "@/lib/formsWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, getApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, ErrorText, Notice } from "./ui";

type Data = { source: "googlecalendar" | "calendly" | null; lost: string[]; meetings: Meeting[]; summary: string | null; error?: string | null };

const WORD: Record<Meeting["status"], string> = { wait: "Invite waiting for your OK", booked: "Meeting", busy: "Busy", done: "Meeting done" };
const minutes = (m: Meeting) => Math.round((Date.parse(m.end) - Date.parse(m.start)) / 60_000);

export function HoraMeetings({ sb, ws, editor, onAsk }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const range = viewDays(view, cursor);
  const cursorMs = cursor.getTime();

  useEffect(() => {
    let live = true;
    const r = viewDays(view, new Date(cursorMs));
    getApi<Data>(sb, `/api/work/forms?${new URLSearchParams({ workspaceId: ws.id, from: r.from.toISOString(), to: r.to.toISOString() })}`).then(
      (d) => {
        if (!live) return;
        setError("");
        setData(d);
      },
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [sb, ws.id, view, cursorMs, version]);

  const meetings = data?.meetings ?? [];
  const waiting = meetings.filter((m) => m.status === "wait" && m.approvalId !== null);

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
  const decide = (id: number, action: "approve" | "deny") => callApi(sb, `/api/approvals/${id}`, { workspaceId: ws.id, action });
  const dayItems = (d: Date) => meetings.filter((m) => sameDay(new Date(m.start), d)).sort((a, b) => a.start.localeCompare(b.start));
  const home = () => (view === "week" ? weekStart(today) : new Date(today.getFullYear(), today.getMonth(), 1));

  return (
    <>
      {(data?.lost ?? []).map((t) => (
        <div key={t} className="ag-alert">
          <span>{appName(t)} stopped working. Hora can&apos;t see new meetings until you reconnect.</span>
          <button type="button" className="btn sm" onClick={() => navigate("/settings/apps")}>
            Reconnect
          </button>
        </div>
      ))}
      {data?.summary ? (
        <p className="po-sum">
          <Face agent="forms" size={26} />
          <span>{data.summary}</span>
        </p>
      ) : null}
      {data && !data.source && !data.lost.length ? (
        <div className="ag-alert">
          <span>Connect Google Calendar or Calendly so Hora can see your meetings.</span>
          <button type="button" className="btn sm" onClick={() => navigate("/settings/apps")}>
            Connect a calendar
          </button>
        </div>
      ) : null}
      {error || (data?.source && data.error) ? <ErrorText>{error || data?.error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}

      <div className="po-bar">
        <div className="po-nav">
          <button type="button" className="icon-btn" aria-label="Back" title="Back" onClick={() => setCursor(step(view, cursor, -1))}>
            <Icon name="back" />
          </button>
          <button type="button" className="icon-btn" aria-label="Next" title="Next" onClick={() => setCursor(step(view, cursor, 1))}>
            <Icon name="next" />
          </button>
          <b>{viewTitle(view, cursor)}</b>
          <button type="button" className="btn sm ghost" onClick={() => setCursor(home())}>
            Today
          </button>
        </div>
        <span className="seg" role="radiogroup" aria-label="View">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => {
                setView(v);
                setCursor(v === "week" ? weekStart(today) : new Date(today.getFullYear(), today.getMonth(), 1));
              }}
            >
              {v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </span>
        {editor && waiting.length ? (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                for (const m of waiting) await decide(m.approvalId!, "approve");
              }, waiting.length === 1 ? "Invite sent." : `${waiting.length} invites sent.`)
            }
          >
            Approve {waiting.length} waiting
          </button>
        ) : null}
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => onAsk("Book a meeting with ")}>
            <Icon name="plus" small />
            Book a meeting
          </button>
        ) : null}
      </div>

      {view === "week" ? (
        <div className="po-cal po-week" aria-busy={data === null}>
          {range.days.map((d) => {
            const list = dayItems(d);
            return (
              <div key={d.toISOString()} className={`po-day${sameDay(d, today) ? " today" : ""}${d < today ? " past" : ""}${list.length ? "" : " empty"}`}>
                <div className="dh">
                  {d.toLocaleDateString("en-US", { weekday: "short" })} <b>{d.getDate()}</b>
                </div>
                {list.map((m) =>
                  m.status === "busy" ? (
                    <div key={m.key} className="po-pill busy">
                      <span className="top">{timeOf(new Date(m.start))}</span>
                      <span className="tx">{m.title}</span>
                    </div>
                  ) : (
                    <button key={m.key} type="button" className={`po-pill ${m.status === "booked" ? "sched" : m.status}`} onClick={() => setOpen(m)} aria-label={`${WORD[m.status]}: ${m.title}`}>
                      <span className="top">
                        {timeOf(new Date(m.start))}
                        <i className="st" title={WORD[m.status]} />
                      </span>
                      <span className="tx">{m.title}</span>
                      <span className="res">{minutes(m)} minutes</span>
                    </button>
                  ),
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="po-cal po-month" aria-busy={data === null}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => (
            <div key={n} className="mh">
              {n}
            </div>
          ))}
          {range.days.map((d) => {
            const list = dayItems(d).filter((m) => m.status !== "busy");
            return (
              <div key={d.toISOString()} className={`po-mday${d.getMonth() !== range.month ? " out" : ""}${sameDay(d, today) ? " today" : ""}`}>
                <span className="dn">{d.getDate()}</span>
                {list.slice(0, 3).map((m) => (
                  <button key={m.key} type="button" className={`po-mpill ${m.status === "booked" ? "sched" : m.status}`} onClick={() => setOpen(m)} title={m.title}>
                    <span>{timeOf(new Date(m.start))}</span>
                  </button>
                ))}
                {list.length > 3 ? <span className="po-more">{list.length - 3} more</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <Drawer open={open !== null} title={open ? WORD[open.status] : ""} onClose={() => setOpen(null)}>
        {open ? (
          <MeetingDrawer
            key={open.key}
            m={open}
            editor={editor}
            busy={busy}
            onAsk={() => onAsk(`About "${open.title}": `)}
            onDecide={(a) => open.approvalId !== null && run(() => decide(open.approvalId!, a), a === "approve" ? "Invite sent." : "Turned down. Nothing was sent.")}
            onMove={(start, end) => run(() => callApi(sb, "/api/work/forms", { workspaceId: ws.id, action: "move", source: open.source, id: open.id, start, end }), "Moved. Guests got the new time.")}
            onCancel={() => run(() => callApi(sb, "/api/work/forms", { workspaceId: ws.id, action: "cancel", source: open.source, id: open.id }), "Canceled. Guests were told.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function MeetingDrawer({
  m,
  editor,
  busy,
  onAsk,
  onDecide,
  onMove,
  onCancel,
}: {
  m: Meeting;
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onDecide: (a: "approve" | "deny") => void;
  onMove: (start: string, end: string) => void;
  onCancel: () => void;
}) {
  const s = inputsOf(new Date(m.start));
  const e = inputsOf(new Date(m.end));
  const [day, setDay] = useState(s.day);
  const [from, setFrom] = useState(s.time);
  const [to, setTo] = useState(e.time);
  const [asking, setAsking] = useState(false);
  const canMove = editor && m.status === "booked" && m.source === "googlecalendar" && m.id;
  const canCancel = editor && m.status === "booked" && m.id;
  const when = `${new Date(m.start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}, ${timeOf(new Date(m.start))} to ${timeOf(new Date(m.end))}`;

  return (
    <>
      <p className="dq">{m.title}</p>
      <div className="facts dsec">
        <div>
          <small>When</small>
          <b>{when}</b>
        </div>
        <div>
          <small>Length</small>
          <b>{minutes(m)} minutes</b>
        </div>
        <div>
          <small>From</small>
          <b>{appName(m.source)}</b>
        </div>
      </div>
      {m.guests.length ? (
        <div className="dsec">
          <h4>Guests</h4>
          <div className="chips">
            {m.guests.map((g) => (
              <span key={g} className="tag">
                {g}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {m.status === "wait" ? (
        <p className="po-take">
          <Face agent="forms" size={24} />
          <span>Hora made this invite. Nothing goes to the guests until you approve it.</span>
        </p>
      ) : null}
      {canMove ? (
        <div className="po-f dsec">
          <div className="row3">
            <div>
              <label htmlFor="m-day">Day</label>
              <input id="m-day" type="date" value={day} onChange={(x) => setDay(x.target.value)} />
            </div>
            <div>
              <label htmlFor="m-from">Starts</label>
              <input id="m-from" type="time" value={from} onChange={(x) => setFrom(x.target.value)} />
            </div>
            <div>
              <label htmlFor="m-to">Ends</label>
              <input id="m-to" type="time" value={to} onChange={(x) => setTo(x.target.value)} />
            </div>
          </div>
        </div>
      ) : null}
      <div className="po-foot">
        {editor && m.status === "wait" ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onDecide("approve")}>
              Approve and send invite
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide("deny")}>
              Don&apos;t send
            </button>
          </>
        ) : canMove ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || (day === s.day && from === s.time && to === e.time)}
            onClick={() => {
              const start = fromInputs(day, from), end = fromInputs(day, to);
              if (start && end) onMove(start, end);
            }}
          >
            Move meeting
          </button>
        ) : null}
        {m.link ? (
          <a className="btn" href={m.link} target="_blank" rel="noopener noreferrer">
            Join
          </a>
        ) : null}
        <button type="button" className="btn" onClick={onAsk}>
          <Icon name="message" small />
          Ask Hora
        </button>
        <span className="sp" />
        {canCancel ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={onCancel}>
                Cancel meeting
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Cancel meeting" title="Cancel meeting" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}

/** Hora's booking rules on her Settings tab. Owners and admins change them; everyone else sees them. */
export function BookingRules({ sb, ws, admin }: { sb: SupabaseClient; ws: Workspace; admin: boolean }) {
  const [rules, setRules] = useState<Booking | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    sb.from("agent_prefs")
      .select("settings")
      .eq("workspace_id", ws.id)
      .eq("agent", "forms")
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setError("We couldn't load Hora's booking rules. Try again.");
        const s = ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>;
        setSettings(s);
        setRules(cleanBooking(s.booking));
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  if (!rules) return error ? <ErrorText>{error}</ErrorText> : null;
  const set = (p: Partial<Booking>) => {
    setNote("");
    setRules({ ...rules, ...p });
  };
  const problem = bookingProblem(rules);
  async function save() {
    if (!rules || problem) return;
    setBusy(true);
    setError("");
    const next = { ...settings, booking: rules };
    const { error: e } = await sb.from("agent_prefs").upsert({ workspace_id: ws.id, agent: "forms", settings: next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,agent" });
    setBusy(false);
    if (e) return setError("That didn't save. Try again.");
    setSettings(next);
    setNote("Saved. Hora books inside these rules from now on.");
  }

  return (
    <section className="sec">
      <div className="sh">
        <h2>Booking rules</h2>
      </div>
      <div className="card book-r">
        <div className="po-f">
          <label>Days</label>
          <div className="pick" role="group" aria-label="Days Hora books meetings">
            {DAY_NAMES.map((n, i) => {
              const on = rules.days.includes(i + 1);
              return (
                <button key={n} type="button" aria-pressed={on} disabled={!admin} onClick={() => set({ days: on ? rules.days.filter((d) => d !== i + 1) : [...rules.days, i + 1].sort() })}>
                  {n.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <div className="row3">
            <div>
              <label htmlFor="b-start">From</label>
              <input id="b-start" type="time" value={rules.start} disabled={!admin} onChange={(e) => set({ start: e.target.value })} />
            </div>
            <div>
              <label htmlFor="b-end">To</label>
              <input id="b-end" type="time" value={rules.end} disabled={!admin} onChange={(e) => set({ end: e.target.value })} />
            </div>
            <div />
          </div>
          <label>Meeting length</label>
          <span className="seg" role="radiogroup" aria-label="Meeting length">
            {LENGTHS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rules.length === n} disabled={!admin} onClick={() => set({ length: n })}>
                {n} min
              </button>
            ))}
          </span>
          <label className="mt-3">Gap between meetings</label>
          <span className="seg" role="radiogroup" aria-label="Gap between meetings">
            {GAPS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rules.gap === n} disabled={!admin} onClick={() => set({ gap: n })}>
                {n ? `${n} min` : "None"}
              </button>
            ))}
          </span>
        </div>
        {problem ? <ErrorText>{problem}</ErrorText> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {note ? <Notice>{note}</Notice> : null}
        {admin ? (
          <div className="po-foot">
            <button type="button" className="btn primary sm" disabled={busy || Boolean(problem)} onClick={save}>
              Save rules
            </button>
          </div>
        ) : (
          <p className="hint-s">Owners and admins can change these.</p>
        )}
      </div>
    </section>
  );
}
