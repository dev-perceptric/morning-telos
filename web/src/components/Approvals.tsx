"use client";

// Approvals on screen: the Approvals page (the current app's split list and review pane), one approval's review, and
// the card under an agent's reply in a chat. Ported from the old app's approvals screen (app/public/app.js reviewHTML).
// Approvals and activity are read straight from Supabase as the signed-in person (row level security: members read).
// Approve and Deny go through POST /api/approvals/:id, which runs the change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { fieldLabel, setPath, STATUS_LABEL, type Approval, type ApprovalStatus, type Path } from "@/lib/approvals";
import { AGENTS, isAgentKey, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { ago } from "@/lib/home";
import { editedApproval, reviewPosts } from "@/lib/socialWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { PostReview } from "./PostReview";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Dropdown, Empty, ErrorText, input, Notice, PageHead, to } from "./ui";
import { plainError } from "@/lib/plainError";

type Row = Pick<Approval, "id" | "thread_id" | "agent" | "product" | "tool" | "input" | "title" | "why" | "status" | "result" | "created_at" | "decided_at">;
const COLUMNS = "id, thread_id, agent, product, tool, input, title, why, status, result, created_at, decided_at";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const agentOf = (k: string): AgentKey => (isAgentKey(k) ? k : "chief");

const TONE: Record<ApprovalStatus, string> = { pending: "clay", approved: "", running: "", done: "green", denied: "", failed: "red" };

export function StatusTag({ status }: { status: ApprovalStatus }) {
  return <span className={`tag ${TONE[status] ?? "clay"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** A failed load says so in one plain line. The database's own words go to the console (plainError). */
const quiet = (e: { message: string }) => plainError(e, "We couldn't load approvals. Try again.");

function useApprovals(sb: SupabaseClient, workspaceId: string, open: boolean, limit: number, version: number) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const q = sb.from("approvals").select(COLUMNS).eq("workspace_id", workspaceId);
    (open ? q.eq("status", "pending") : q.neq("status", "pending"))
      .order("id", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setError(quiet(error));
        setError("");
        setRows((data ?? []) as Row[]);
      });
    return () => {
      live = false;
    };
  }, [sb, workspaceId, open, limit, version]);
  return { rows, error };
}

// ─────────────── the details, as fields ───────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Any value as something a person can read: fields with labels, lists, Yes and No. Never raw JSON. */
function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-ink-4">None</span>;
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  if (typeof v === "string" || typeof v === "number") return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-ink-4">None</span>;
    if (v.every((x) => !isObj(x) && !Array.isArray(x))) return <span className="break-words">{v.map((x) => (x === null ? "None" : String(x))).join(", ")}</span>;
    return (
      <ol className="flex flex-col gap-2">
        {v.map((x, i) => (
          <li key={i} className="kv-item">
            <p className="k">{v.length > 1 ? `Item ${i + 1}` : "Item"}</p>
            <Value v={x} />
          </li>
        ))}
      </ol>
    );
  }
  if (isObj(v)) return <Fields value={v} />;
  return <span>{String(v)}</span>;
}

export function Fields({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length) return <p className="v text-ink-4">No details.</p>;
  return (
    <dl className="kv2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="k">{fieldLabel(k)}</dt>
          <dd className="v">
            <Value v={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The same fields, editable. The shape stays the same: words, numbers and Yes or No can change. */
function EditValue({ v, path, onSet, name }: { v: unknown; path: Path; onSet: (path: Path, next: unknown) => void; name: string }) {
  const id = `f-${path.join("-")}`;
  if (typeof v === "boolean")
    return (
      <label className="flex items-center gap-2 text-[14px]">
        <input id={id} type="checkbox" checked={v} onChange={(e) => onSet(path, e.target.checked)} /> {name}
      </label>
    );
  if (typeof v === "number")
    return <input id={id} aria-label={name} type="number" className={input} value={Number.isFinite(v) ? v : 0} onChange={(e) => onSet(path, e.target.value === "" ? 0 : Number(e.target.value))} />;
  if (typeof v === "string" || v === null || v === undefined) {
    const text = v ?? "";
    return text.length > 60 || text.includes("\n") ? (
      <textarea id={id} aria-label={name} rows={Math.min(10, Math.max(3, Math.ceil(text.length / 60)))} className="ta" value={text} onChange={(e) => onSet(path, e.target.value)} />
    ) : (
      <input id={id} aria-label={name} className={input} value={text} placeholder={v === null ? "None" : undefined} onChange={(e) => onSet(path, v === null && !e.target.value ? null : e.target.value)} />
    );
  }
  if (Array.isArray(v))
    return (
      <ol className="flex flex-col gap-2">
        {v.map((x, i) => (
          <li key={i} className="kv-item flex flex-col gap-1">
            <p className="k">{`Item ${i + 1}`}</p>
            <EditValue v={x} path={[...path, i]} onSet={onSet} name={`${name}, item ${i + 1}`} />
          </li>
        ))}
      </ol>
    );
  if (isObj(v)) return <EditFields value={v} path={path} onSet={onSet} />;
  return <span>{String(v)}</span>;
}

function EditFields({ value, path, onSet }: { value: Record<string, unknown>; path: Path; onSet: (path: Path, next: unknown) => void }) {
  return (
    <div className="kv2">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-1">
          {typeof v === "boolean" ? null : (
            <label className="k" htmlFor={`f-${[...path, k].join("-")}`}>
              {fieldLabel(k)}
            </label>
          )}
          <EditValue v={v} path={[...path, k]} onSet={onSet} name={fieldLabel(k)} />
        </div>
      ))}
    </div>
  );
}

// ─────────────── one approval ───────────────

/** One approval: who prepared it, what it does, the details, and Approve, Edit and Deny for editors. */
export function Review({ sb, ws, ap, onDecided, compact }: { sb: SupabaseClient; ws: Workspace; ap: Row; onDecided: () => void; compact?: boolean }) {
  const editor = can(ws.role, "approve");
  const agent = agentOf(ap.agent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(ap.input ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const set = useCallback((path: Path, next: unknown) => setDraft((d) => setPath(d, path, next)), []);
  // Leo's posts show as posts, not fields.
  const posts = reviewPosts(ap.product, ap.tool, ap.input);

  const decide = async (action: "approve" | "deny") => {
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ status?: ApprovalStatus; result?: string }>(sb, `/api/approvals/${ap.id}`, { workspaceId: ws.id, action, ...(action === "approve" && editing ? { input: draft } : {}) });
      setSaid(out.status === "done" ? "Done." : out.status === "denied" ? `Not approved. ${AGENTS[agent].god} won't run it.` : `It didn't work. ${out.result ?? ""}`.trim());
      setEditing(false);
      track("approval_decided", { action, agent, edited: action === "approve" && editing });
      onDecided();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };

  return (
    <div className="review">
      <div className="rv-top">
        <Face agent={agent} size={40} />
        <div className="min-w-0 flex-1">
          <span className="eyebrow">
            {AGENTS[agent].god} · {AGENTS[agent].name}
          </span>
          <h3>{ap.title}</h3>
          <div className="rv-meta">
            <span>{ap.tool.replace(/_/g, " ")}</span>
            <span>{when(ap.created_at)}</span>
            <StatusTag status={ap.status} />
          </div>
        </div>
      </div>
      {ap.status === "pending" ? (
        <div className="why">
          <Icon name="alert" small />
          <span>
            {ap.why} Nothing runs until you approve.
          </span>
        </div>
      ) : (
        <div className="h-4" />
      )}
      {posts ? (
        <PostReview sb={sb} wsId={ws.id} posts={posts} editing={editing} onEdit={(index, edit) => setDraft((d) => editedApproval(ap.tool, d, index, edit))} />
      ) : (
        <div className={`draft${editing ? " editing" : ""}`}>{editing ? <EditFields value={draft} path={[]} onSet={set} /> : <Fields value={ap.input ?? {}} />}</div>
      )}
      {ap.result && ap.status !== "pending" ? (
        <div className="mt-3">
          <p className="kv-k">{ap.status === "failed" ? "What went wrong" : "Result"}</p>
          <p className="result">{ap.result}</p>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {said ? <Notice>{said}</Notice> : null}
      <div className="rv-act">
        {ap.status === "pending" && editor && !said ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => decide("approve")}>
              {busy ? "Working..." : editing ? "Approve with changes" : "Approve"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (editing) setDraft(ap.input ?? {});
                setEditing(!editing);
              }}
            >
              {editing ? "Cancel changes" : "Edit"}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => decide("deny")}>
              Deny
            </button>
          </>
        ) : null}
        {ap.status === "pending" && !editor ? <p className="text-[13px] text-ink-3">An editor, admin or the owner can approve this.</p> : null}
        {ap.thread_id && !compact ? (
          <span className="note">
            <a
              href={`/chat/${ap.thread_id}`}
              className="link"
              onClick={(e) => {
                e.preventDefault();
                navigate(`/chat/${ap.thread_id}`);
              }}
            >
              Open chat
            </a>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ListRow({ ap, picked, onPick }: { ap: Row; picked: boolean; onPick: () => void }) {
  const agent = agentOf(ap.agent);
  return (
    <button type="button" aria-current={picked ? "true" : undefined} className={`row${picked ? " sel" : ""}`} onClick={onPick}>
      <Face agent={agent} />
      <span className="main">
        <b>{ap.title}</b>
        <small>
          {AGENTS[agent].god} · {ap.tool.replace(/_/g, " ")}
        </small>
      </span>
      {ap.status === "pending" ? <span className="meta">{ago(ap.created_at)}</span> : <StatusTag status={ap.status} />}
    </button>
  );
}

// ─────────────── the Approvals page ───────────────

export function ApprovalsPage({ sb, ws, id, onDecided }: { sb: SupabaseClient; ws: Workspace; id: number | null; onDecided?: () => void }) {
  const [tab, setTab] = useState<"open" | "done">("open");
  const [who, setWho] = useState("all");
  const [version, setVersion] = useState(0);
  const list = useApprovals(sb, ws.id, tab === "open", 100, version);
  // An approval opened from a link may be in either list, so it is read on its own.
  const [linked, setLinked] = useState<Row | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    sb.from("approvals")
      .select(COLUMNS)
      .eq("workspace_id", ws.id)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => live && setLinked((data as Row | null) ?? null));
    return () => {
      live = false;
    };
  }, [sb, ws.id, id, version]);
  const all = list.rows ?? [];
  const agents = [...new Set(all.map((r) => agentOf(r.agent)))];
  const rows = who === "all" ? all : all.filter((r) => agentOf(r.agent) === who);
  const picked = (id ? (all.find((r) => r.id === id) ?? (linked?.id === id ? linked : null)) : rows[0]) ?? null;
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    onDecided?.();
  }, [onDecided]);

  return (
    <>
      <PageHead title="Approvals" sub="Changes your team prepared. Nothing runs until you approve it.">
        <span className="seg" role="tablist" aria-label="Approvals">
          {(
            [
              ["open", "Needs you"],
              ["done", "Handled"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                setWho("all");
                navigate("/approvals");
              }}
            >
              {l}
            </button>
          ))}
        </span>
        <Dropdown
          label="Filter by teammate"
          value={agents.includes(who as AgentKey) ? who : "all"}
          onChange={setWho}
          items={[{ v: "all", t: "All teammates", n: all.length }, ...agents.map((k) => ({ v: k, t: AGENTS[k].god, img: `/img/agents/${k}-f.webp`, n: all.filter((r) => agentOf(r.agent) === k).length }))]}
        />
      </PageHead>
      {list.error ? <ErrorText>{list.error}</ErrorText> : null}
      {list.rows !== null && !rows.length && !picked ? (
        // Nothing in the list: one empty card across the page, not an empty list beside an empty review pane.
        <div className="card">
          <Empty icon={tab === "open" ? "inbox" : "tick"} title={tab === "open" ? "All caught up" : "Nothing here yet"}>
            {tab === "open" ? "When your team prepares a change, it shows up here." : "Approved and denied changes show up here."}
          </Empty>
        </div>
      ) : (
      <div className={`split${id ? " has-pick" : ""}`}>
        <div className="card list">
          {list.rows === null ? null : rows.length ? (
            rows.map((r) => <ListRow key={r.id} ap={r} picked={picked?.id === r.id} onPick={() => navigate(`/approvals/${r.id}`)} />)
          ) : (
            <Empty title={tab === "open" ? "All caught up" : "Nothing here yet"}>{tab === "open" ? "When your team prepares a change, it shows up here." : "Approved and denied changes show up here."}</Empty>
          )}
        </div>
        <div className="card pad pane">
          <a
            className="back m-only"
            href={to("/approvals")}
            onClick={(e) => {
              e.preventDefault();
              navigate("/approvals");
            }}
          >
            <Icon name="back" small />
            Approvals
          </a>
          {picked ? <Review key={`${picked.id}:${picked.status}`} sb={sb} ws={ws} ap={picked} onDecided={refresh} /> : <Empty title="Nothing to review">New changes will show up here.</Empty>}
        </div>
      </div>
      )}
    </>
  );
}

// ─────────────── in a chat ───────────────

/** Under an agent's reply: the change it prepared, with its status. Review opens it right here. */
export function ApprovalCard({ sb, ws, id, title }: { sb: SupabaseClient; ws: Workspace; id: number; title: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    sb.from("approvals")
      .select(COLUMNS)
      .eq("workspace_id", ws.id)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => live && setRow((data as Row | null) ?? null));
    return () => {
      live = false;
    };
  }, [sb, ws.id, id, version]);
  const status: ApprovalStatus = row?.status ?? "pending";
  return (
    <div className="ap-wrap">
      <div className={`ap-inline${status === "pending" ? "" : " done"}`}>
        <span className="min-w-0 wrap">
          {status === "pending" ? "Saved for your approval: " : ""}
          <b>{row?.title ?? title}</b>
        </span>
        <StatusTag status={status} />
        {row ? (
          <button type="button" className={`btn sm${status === "pending" && !open ? " primary" : ""}`} onClick={() => setOpen(!open)}>
            {open ? "Close" : status === "pending" ? "Review" : "Details"}
          </button>
        ) : null}
      </div>
      {open && row ? (
        <div className="card pad ap-open">
          <Review key={`${row.id}:${row.status}`} sb={sb} ws={ws} ap={row} compact onDecided={() => setVersion((v) => v + 1)} />
        </div>
      ) : null}
    </div>
  );
}
