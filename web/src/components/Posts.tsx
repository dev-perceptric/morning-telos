"use client";

// Aphrodite's Posts tab: her accounts, one calendar of what's waiting, scheduled and posted, and one drawer for any
// post. The data and the rules are in src/lib/socialWork.ts; the calendar dates in src/lib/calendar.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { addDays, fromInputs, inputsOf, sameDay, startOfDay, step, timeOf, viewDays, viewTitle, weekStart } from "@/lib/calendar";
import { networkName } from "@/lib/socialChannels";
import { editedApproval, type Channel, type PostItem } from "@/lib/socialWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, getApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { NetworkMark } from "./Social";
import { Drawer, ErrorText, Notice } from "./ui";

type Data = {
  ready: boolean;
  items: PostItem[];
  approvals: { id: number; tool: string; input: Record<string, unknown> }[];
  channels: Channel[];
  summary: string | null;
  error?: string;
};
type Open = { item: PostItem } | { item: null };

const WORD: Record<PostItem["status"], string> = { wait: "Waiting for your OK", draft: "Draft", sched: "Scheduled", done: "Posted", failed: "Didn't go out" };
const MAX = 3000;

/** The day a post shows on: its time, or today when it goes out as soon as it's approved. */
const dayOf = (p: PostItem, today: Date) => (p.at ? new Date(p.at) : today);

export function SocialPosts({ sb, ws, editor, onAsk, onReconnect }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: () => void; onReconnect: (network: string) => void }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const range = viewDays(view, cursor);
  const cursorMs = cursor.getTime();

  useEffect(() => {
    let live = true;
    const r = viewDays(view, new Date(cursorMs));
    const q = new URLSearchParams({ workspaceId: ws.id, from: r.from.toISOString(), to: r.to.toISOString() });
    getApi<Data>(sb, `/api/work/social?${q}`).then(
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

  const items = data?.items ?? [];
  const waiting = items.filter((p) => p.status === "wait");
  const waitingApprovals = [...new Set(waiting.map((p) => p.approvalId).filter((x): x is number => x !== null))];
  const lost = (data?.channels ?? []).filter((c) => c.status === "lost");
  const live = (data?.channels ?? []).filter((c) => c.status === "connected");
  const netOf = (id: string) => data?.channels.find((c) => c.id === id)?.network ?? "";

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
  const approve = (id: number, input?: Record<string, unknown>) => callApi(sb, `/api/approvals/${id}`, { workspaceId: ws.id, action: "approve", ...(input ? { input } : {}) });
  const approveAll = () =>
    run(async () => {
      for (const id of waitingApprovals) await approve(id);
    }, waitingApprovals.length === 1 ? "Approved." : `Approved ${waitingApprovals.length}.`);

  const dayItems = (d: Date) => items.filter((p) => sameDay(dayOf(p, today), d)).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  return (
    <>
      {lost.map((c) => (
        <div key={c.id} className="ag-alert">
          <span>
            {c.name || networkName(c.network)} on {networkName(c.network)} stopped working. Posts to it are on hold until you reconnect.
          </span>
          <button type="button" className="btn sm" onClick={() => onReconnect(c.network)}>
            Reconnect
          </button>
        </div>
      ))}
      {data?.summary ? (
        <p className="po-sum">
          <Face agent="social" size={26} />
          <span>{data.summary}</span>
        </p>
      ) : null}
      {data && !data.ready ? <Notice>Aphrodite&apos;s social media is still setting up. Check back in a few minutes.</Notice> : null}
      {error || data?.error ? <ErrorText>{error || data?.error}</ErrorText> : null}
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
          <button type="button" className="btn sm ghost" onClick={() => setCursor(view === "week" ? weekStart(today) : new Date(today.getFullYear(), today.getMonth(), 1))}>
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
        {editor && waitingApprovals.length ? (
          <button type="button" className="btn sm" disabled={busy} onClick={approveAll}>
            Approve {waiting.length} waiting
          </button>
        ) : null}
        {editor && data?.ready ? (
          <button type="button" className="btn primary sm" disabled={!live.length} onClick={() => setOpen({ item: null })}>
            <Icon name="plus" small />
            New post
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
                {list.map((p) => (
                  <button key={p.key} type="button" className={`po-pill ${p.status}`} onClick={() => setOpen({ item: p })} aria-label={`${WORD[p.status]}: ${p.text}`}>
                    <span className="top">
                      <Nets ids={p.channelIds} netOf={netOf} />
                      {p.at ? timeOf(new Date(p.at)) : "When approved"}
                      <i className="st" title={WORD[p.status]} />
                    </span>
                    <span className="tx">{p.text}</span>
                    {p.engagements !== null ? <span className="res">{p.engagements.toLocaleString()} likes, comments and shares</span> : null}
                  </button>
                ))}
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
            const list = dayItems(d);
            return (
              <div key={d.toISOString()} className={`po-mday${d.getMonth() !== range.month ? " out" : ""}${sameDay(d, today) ? " today" : ""}`}>
                <span className="dn">{d.getDate()}</span>
                {list.slice(0, 3).map((p) => (
                  <button key={p.key} type="button" className={`po-mpill ${p.status}`} onClick={() => setOpen({ item: p })} title={p.text}>
                    <Nets ids={p.channelIds.slice(0, 1)} netOf={netOf} />
                    <span>{p.at ? timeOf(new Date(p.at)) : "When approved"}</span>
                  </button>
                ))}
                {list.length > 3 ? <span className="po-more">{list.length - 3} more</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <Drawer open={open !== null} title={open ? (open.item ? WORD[open.item.status] : "New post") : ""} onClose={() => setOpen(null)}>
        {open ? (
          <PostDrawer
            key={open.item?.key ?? "new"}
            item={open.item}
            data={data}
            editor={editor}
            busy={busy}
            today={today}
            netOf={netOf}
            onAsk={onAsk}
            onApprove={(input) => open.item?.approvalId && run(() => approve(open.item!.approvalId!, input), "Approved. It goes out on time.")}
            onDeny={() => open.item?.approvalId && run(() => callApi(sb, `/api/approvals/${open.item!.approvalId}`, { workspaceId: ws.id, action: "deny" }), "Turned down. It won't go out.")}
            onSave={(post) =>
              run(
                () => callApi(sb, "/api/work/social", { workspaceId: ws.id, action: open.item ? "save" : "create", postId: open.item?.postId, ...post }),
                open.item ? "Saved." : "Scheduled.",
              )
            }
            onDelete={() => open.item?.postId && run(() => callApi(sb, "/api/work/social", { workspaceId: ws.id, action: "delete", postId: open.item!.postId }), "Post deleted.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function Nets({ ids, netOf }: { ids: string[]; netOf: (id: string) => string }) {
  const nets = [...new Set(ids.map(netOf).filter(Boolean))];
  if (!nets.length) return null;
  return (
    <span className="po-nets">
      {nets.map((n) => (
        <NetworkMark key={n} network={n} size={18} />
      ))}
    </span>
  );
}

type Post = { text: string; at: string | null; channelIds: string[] };

function PostDrawer({
  item,
  data,
  editor,
  busy,
  today,
  netOf,
  onAsk,
  onApprove,
  onDeny,
  onSave,
  onDelete,
}: {
  item: PostItem | null;
  data: Data | null;
  editor: boolean;
  busy: boolean;
  today: Date;
  netOf: (id: string) => string;
  onAsk: () => void;
  onApprove: (input?: Record<string, unknown>) => void;
  onDeny: () => void;
  onSave: (p: Post) => void;
  onDelete: () => void;
}) {
  const start = inputsOf(item?.at ? new Date(item.at) : addDays(today, 1));
  const [text, setText] = useState(item?.text ?? "");
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(item?.at ? start.time : "09:00");
  const live = (data?.channels ?? []).filter((c) => c.status === "connected");
  const [picked, setPicked] = useState<string[]>(item?.channelIds.length ? item.channelIds : live.slice(0, 1).map((c) => c.id));
  const [asking, setAsking] = useState(false);
  const status = item?.status ?? "new";
  const canEdit = editor && (status === "new" || status === "wait" || status === "sched" || status === "draft");
  const first = data?.channels.find((c) => c.id === (item?.channelIds[0] ?? picked[0]));

  const post = (): Post => ({ text: text.trim(), at: fromInputs(day, time), channelIds: picked });
  const edits = (): Record<string, unknown> | undefined => {
    const ap = data?.approvals.find((a) => a.id === item?.approvalId);
    if (!ap || !item) return undefined;
    const p = post();
    return editedApproval(ap.tool, ap.input, item.index, { text: p.text, at: p.at, channelIds: p.channelIds });
  };

  return (
    <>
      {status === "failed" && item?.error ? <ErrorText>{item.error}</ErrorText> : null}
      {status === "done" && item?.engagements !== null && item?.engagements !== undefined ? (
        <p className="po-take">
          <Face agent="social" size={24} />
          <span>{item.engagements.toLocaleString()} likes, comments and shares so far.</span>
        </p>
      ) : null}
      {item ? (
        <div className="po-prev">
          <div className="who">
            {first ? <NetworkMark network={first.network} size={36} /> : null}
            <span>
              <b>{first?.name || (first ? networkName(first.network) : "Your account")}</b>
              <small>
                {item.at ? `${new Date(item.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${timeOf(new Date(item.at))}` : "As soon as you approve it"}
                {first ? ` on ${networkName(netOf(first.id))}` : ""}
              </small>
            </span>
          </div>
          <p>{canEdit ? text : item.text}</p>
        </div>
      ) : null}

      {canEdit ? (
        <div className="po-f">
          <div className="po-tabs" role="group" aria-label="Where it goes">
            {live.map((c) => {
              const on = picked.includes(c.id);
              return (
                <button key={c.id} type="button" className={`po-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])}>
                  <NetworkMark network={c.network} size={24} />
                  {c.name || networkName(c.network)}
                </button>
              );
            })}
          </div>
          <label htmlFor="po-text">Post</label>
          <textarea id="po-text" value={text} maxLength={MAX} placeholder="Write it yourself, or ask Aphrodite to write it." onChange={(e) => setText(e.target.value)} />
          <div className="cnt">
            {text.length.toLocaleString()} of {MAX.toLocaleString()}
          </div>
          <div className="row2">
            <div>
              <label htmlFor="po-day">Day</label>
              <input id="po-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div>
              <label htmlFor="po-time">Time</label>
              <input id="po-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="po-foot">
        {canEdit && status === "wait" ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onApprove(edits())}>
              Approve
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onDeny}>
              Don&apos;t post
            </button>
          </>
        ) : canEdit ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => onSave(post())}>
            {status === "new" ? "Schedule" : "Save"}
          </button>
        ) : null}
        {status !== "wait" ? (
          <button type="button" className="btn" onClick={onAsk}>
            <Icon name="message" small />
            {status === "new" ? "Ask Aphrodite to write it" : "Ask Aphrodite"}
          </button>
        ) : null}
        {item?.url ? (
          <a className="btn" href={item.url} target="_blank" rel="noopener noreferrer">
            See it on {networkName(netOf(item.channelIds[0] ?? ""))}
          </a>
        ) : null}
        <span className="sp" />
        {editor && item?.postId && status !== "done" && status !== "wait" ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={onDelete}>
                Delete post
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Delete post" title="Delete post" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}
