"use client";

// Approvals on screen: the "Needs you" list on Home, the Approvals page (a list and one approval at a time), and the
// card under an agent's reply in a chat. Ported from the old app's approvals screen (app/public/app.js reviewHTML).
// Approvals and activity are read straight from Supabase as the signed-in person (row level security: members read).
// Approve and Deny go through POST /api/approvals/:id, which runs the change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { fieldLabel, setPath, STATUS_LABEL, type Approval, type ApprovalStatus, type Path } from "@/lib/approvals";
import { AGENTS, isAgentKey, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Face } from "./Team";
import { btnPrimary, btnSmall, card, ErrorText, input, Notice } from "./ui";

type Row = Pick<Approval, "id" | "thread_id" | "agent" | "product" | "tool" | "input" | "title" | "why" | "status" | "result" | "created_at" | "decided_at">;
const COLUMNS = "id, thread_id, agent, product, tool, input, title, why, status, result, created_at, decided_at";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const agentOf = (k: string): AgentKey => (isAgentKey(k) ? k : "chief");

const TONE: Record<ApprovalStatus, string> = {
  pending: "bg-clay-bg text-clay-2",
  approved: "bg-sunk text-ink-2",
  running: "bg-sunk text-ink-2",
  done: "bg-[#e7f2ea] text-green",
  denied: "bg-sunk text-ink-3",
  failed: "bg-[#fbeae4] text-red",
};

export function StatusTag({ status }: { status: ApprovalStatus }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[status] ?? TONE.pending}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Before 013_approvals.sql runs there is no approvals table. Say nothing rather than show a database error. */
const quiet = (e: { message: string }) => (/approvals|activity/.test(e.message) ? "" : e.message);

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
          <li key={i} className="rounded-[10px] border border-line px-3 py-2">
            <p className="mb-1 text-[12px] font-semibold text-ink-4">{v.length > 1 ? `Item ${i + 1}` : "Item"}</p>
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
  if (!entries.length) return <p className="text-[14px] text-ink-4">No details.</p>;
  return (
    <dl className="flex flex-col gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[13px] font-medium text-ink-3">{fieldLabel(k)}</dt>
          <dd className="text-[15px] text-ink">
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
      <label className="flex items-center gap-2 text-[15px]">
        <input id={id} type="checkbox" checked={v} onChange={(e) => onSet(path, e.target.checked)} /> {name}
      </label>
    );
  if (typeof v === "number")
    return <input id={id} aria-label={name} type="number" className={input} value={Number.isFinite(v) ? v : 0} onChange={(e) => onSet(path, e.target.value === "" ? 0 : Number(e.target.value))} />;
  if (typeof v === "string" || v === null || v === undefined) {
    const text = v ?? "";
    return text.length > 60 || text.includes("\n") ? (
      <textarea id={id} aria-label={name} rows={Math.min(10, Math.max(3, Math.ceil(text.length / 60)))} className={`${input} h-auto py-2`} value={text} onChange={(e) => onSet(path, e.target.value)} />
    ) : (
      <input id={id} aria-label={name} className={input} value={text} placeholder={v === null ? "None" : undefined} onChange={(e) => onSet(path, v === null && !e.target.value ? null : e.target.value)} />
    );
  }
  if (Array.isArray(v))
    return (
      <ol className="flex flex-col gap-2">
        {v.map((x, i) => (
          <li key={i} className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2">
            <p className="text-[12px] font-semibold text-ink-4">{`Item ${i + 1}`}</p>
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
    <div className="flex flex-col gap-3">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-1">
          {typeof v === "boolean" ? null : (
            <label className="text-[13px] font-medium text-ink-3" htmlFor={`f-${[...path, k].join("-")}`}>
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

  const decide = async (action: "approve" | "deny") => {
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ status?: ApprovalStatus; result?: string }>(sb, `/api/approvals/${ap.id}`, { workspaceId: ws.id, action, ...(action === "approve" && editing ? { input: draft } : {}) });
      setSaid(out.status === "done" ? "Done." : out.status === "denied" ? `Not approved. ${AGENTS[agent].god} won't run it.` : `It didn't work. ${out.result ?? ""}`.trim());
      setEditing(false);
      onDecided();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };

  return (
    <div className={compact ? "flex flex-col gap-4" : `${card}`}>
      <div className="flex items-start gap-3">
        <Face agent={agent} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink-3">
            {AGENTS[agent].god}, {AGENTS[agent].name}
          </p>
          <h2 className="break-words text-[18px] font-semibold leading-snug">{ap.title}</h2>
          <p className="text-[13px] text-ink-4">{when(ap.created_at)}</p>
        </div>
        <StatusTag status={ap.status} />
      </div>
      {ap.status === "pending" ? (
        <Notice>
          {ap.why} Nothing runs until you approve.
        </Notice>
      ) : null}
      <div className="rounded-[12px] bg-sunk px-4 py-3">{editing ? <EditFields value={draft} path={[]} onSet={set} /> : <Fields value={ap.input ?? {}} />}</div>
      {ap.result && ap.status !== "pending" ? (
        <div>
          <p className="mb-1 text-[13px] font-medium text-ink-3">{ap.status === "failed" ? "What went wrong" : "Result"}</p>
          <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-line px-3 py-2 text-[14px] text-ink-2">{ap.result}</p>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {said ? <Notice>{said}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        {ap.status === "pending" && editor && !said ? (
          <>
            <button type="button" className={`${btnPrimary} h-10 w-auto px-4 text-[14px]`} disabled={busy} onClick={() => decide("approve")}>
              {busy ? "Working..." : editing ? "Approve with changes" : "Approve"}
            </button>
            <button
              type="button"
              className={btnSmall}
              disabled={busy}
              onClick={() => {
                if (editing) setDraft(ap.input ?? {});
                setEditing(!editing);
              }}
            >
              {editing ? "Cancel changes" : "Edit"}
            </button>
            <button type="button" className={btnSmall} disabled={busy} onClick={() => decide("deny")}>
              Deny
            </button>
          </>
        ) : null}
        {ap.status === "pending" && !editor ? <p className="text-[14px] text-ink-3">An editor, admin or the owner can approve this.</p> : null}
        {ap.thread_id && !compact ? (
          <a
            href={`/chat/${ap.thread_id}`}
            className="ml-auto text-[14px] font-medium text-clay-2 underline-offset-2 hover:underline"
            onClick={(e) => {
              e.preventDefault();
              navigate(`/chat/${ap.thread_id}`);
            }}
          >
            Open chat
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ListRow({ ap, picked, onPick }: { ap: Row; picked: boolean; onPick: () => void }) {
  const agent = agentOf(ap.agent);
  return (
    <li>
      <button type="button" aria-current={picked ? "true" : undefined} className={`flex w-full items-start gap-3 px-4 py-3 text-left ${picked ? "bg-sunk" : "hover:bg-sunk"}`} onClick={onPick}>
        <Face agent={agent} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-medium">{ap.title}</span>
          <span className="block text-[13px] text-ink-4">
            {AGENTS[agent].god}, {when(ap.created_at)}
          </span>
        </span>
        <StatusTag status={ap.status} />
      </button>
    </li>
  );
}

// ─────────────── the Approvals page ───────────────

export function ApprovalsPage({ sb, ws, id }: { sb: SupabaseClient; ws: Workspace; id: number | null }) {
  const [tab, setTab] = useState<"open" | "done">("open");
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
  const rows = list.rows ?? [];
  const picked = (id ? (rows.find((r) => r.id === id) ?? (linked?.id === id ? linked : null)) : rows[0]) ?? null;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <section className="flex flex-col gap-6 py-4">
      <div>
        <h1 className="font-serif text-[34px] leading-tight">Approvals</h1>
        <p className="text-[15px] text-ink-3">Changes your team prepared. Nothing runs until someone approves it.</p>
      </div>
      <div className="flex gap-2" role="tablist" aria-label="Approvals">
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
            className={`rounded-full px-3 py-1.5 text-[14px] ${tab === k ? "bg-ink text-white" : "border border-line bg-surface text-ink-2 hover:bg-sunk"}`}
            onClick={() => {
              setTab(k);
              navigate("/approvals");
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {list.error ? <ErrorText>{list.error}</ErrorText> : null}
      {list.rows && !rows.length && !picked ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[16px] font-semibold">{tab === "open" ? "All caught up" : "Nothing here yet"}</p>
          <p className="text-[14px] text-ink-3">{tab === "open" ? "When your team prepares a change, it shows up here." : "Approved and denied changes show up here."}</p>
        </div>
      ) : null}
      {rows.length || picked ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {rows.length ? (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface lg:w-72 lg:shrink-0">
              {rows.map((r) => (
                <ListRow key={r.id} ap={r} picked={picked?.id === r.id} onPick={() => navigate(`/approvals/${r.id}`)} />
              ))}
            </ul>
          ) : null}
          <div className="min-w-0 flex-1">{picked ? <Review key={`${picked.id}:${picked.status}`} sb={sb} ws={ws} ap={picked} onDecided={refresh} /> : null}</div>
        </div>
      ) : null}
    </section>
  );
}

// ─────────────── Home ───────────────

/** Home: changes waiting for a person, newest first. Nothing when there are none. */
export function NeedsYou({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const { rows } = useApprovals(sb, ws.id, true, 6, 0);
  if (!rows?.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-ink-4">Needs you</h2>
        <button type="button" className="text-[14px] font-medium text-clay-2 underline-offset-2 hover:underline" onClick={() => navigate("/approvals")}>
          See all
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.slice(0, 5).map((r) => (
          <ListRow key={r.id} ap={r} picked={false} onPick={() => navigate(`/approvals/${r.id}`)} />
        ))}
      </ul>
    </div>
  );
}

type ActivityRow = { id: number; agent: string | null; text: string; created_at: string };

/** Home: the last few things the team did (prepared, ran on autopilot, finished). */
export function RecentActivity({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  useEffect(() => {
    let live = true;
    sb.from("activity")
      .select("id, agent, text, created_at")
      .eq("workspace_id", ws.id)
      .order("id", { ascending: false })
      .limit(6)
      .then(({ data, error }) => live && !error && setRows((data ?? []) as ActivityRow[]));
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  if (!rows.length) return null;
  return (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold text-ink-4">Recent work</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const agent = agentOf(r.agent ?? "chief");
          return (
            <li key={r.id} className="flex items-start gap-2 text-[14px] text-ink-2">
              <Face agent={agent} size={20} />
              <span className="min-w-0 break-words">
                <span className="font-medium">{AGENTS[agent].god}</span> {r.text}
                <span className="text-ink-4">, {when(r.created_at)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
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
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 break-words text-[14px]">
          <span className="text-ink-3">{status === "pending" ? "Saved for your approval: " : ""}</span>
          <span className="font-semibold">{row?.title ?? title}</span>
        </span>
        <StatusTag status={status} />
        {row ? (
          <button type="button" className={btnSmall} onClick={() => setOpen(!open)}>
            {open ? "Close" : status === "pending" ? "Review" : "Details"}
          </button>
        ) : null}
      </div>
      {open && row ? <Review key={`${row.id}:${row.status}`} sb={sb} ws={ws} ap={row} compact onDecided={() => setVersion((v) => v + 1)} /> : null}
    </div>
  );
}
