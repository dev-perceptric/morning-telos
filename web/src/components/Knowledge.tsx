"use client";

// Knowledge: what the team knows about the business (supabase/012_knowledge.sql). Everyone in the workspace reads the
// docs; editors and up add, change, delete and upload them, and can have the website read again.
// The list and search run as the signed-in person, so row level security decides what they see and change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentName, cleanDoc, DOC_AGENTS, SOURCE_LABEL, UPLOAD_TYPES, type KnowledgeDoc } from "@/lib/knowledge";
import { can } from "@/lib/workspace";
import { message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { btnDanger, btnPrimary, btnSecondary, btnSmall, card, ErrorText, input, label, Notice } from "./ui";

const COLUMNS = "id, title, body, agent, source, source_url, updated_at";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type Hit = { id: string; title: string; snippet: string; rank: number };

export function KnowledgePage({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const editor = can(ws.role, "editKnowledge");
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The doc open in the editor: "new", a doc id, or nothing.
  const [open, setOpen] = useState<string | null>(null);
  // Bumped when someone starts a website scan, so the status line looks again.
  const [scans, setScans] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("knowledge_docs").select(COLUMNS).eq("workspace_id", ws.id).order("updated_at", { ascending: false });
    if (error) return setError(/knowledge_docs/.test(error.message) ? "Knowledge isn't set up yet. Try again soon." : error.message);
    setError("");
    setDocs((data ?? []) as KnowledgeDoc[]);
  }, [sb, ws.id]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const done = (text: string) => {
    setOpen(null);
    setNotice(text);
    load();
  };
  const current = open && open !== "new" ? docs?.find((d) => d.id === open) ?? null : null;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 font-serif text-[30px] leading-tight">Knowledge</h1>
        <p className="text-[15px] text-ink-3">What your team knows about {ws.name}. Every teammate reads these docs before they work, so keep them true and up to date.</p>
      </div>
      {notice ? (
        <div className="flex items-start justify-between gap-3 rounded-[10px] bg-clay-bg px-3 py-2 text-[14px] text-ink-2" role="status">
          <span>{notice}</span>
          <button type="button" className="text-ink-4 hover:text-ink" aria-label="Close" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      {open ? (
        <DocEditor key={open} sb={sb} ws={ws} doc={current} editor={editor} onClose={() => setOpen(null)} onDone={done} />
      ) : (
        <>
          {editor ? (
            <Actions
              sb={sb}
              ws={ws}
              onNew={() => setOpen("new")}
              onDone={done}
              onScan={(text) => {
                setNotice(text);
                setScans((n) => n + 1);
              }}
            />
          ) : null}
          <WebsiteScan key={scans} sb={sb} ws={ws} onFinished={load} />
          <Search sb={sb} workspaceId={ws.id} onOpen={setOpen} />
          <DocList docs={docs} editor={editor} onOpen={setOpen} />
        </>
      )}
    </section>
  );
}

/** Add a doc, upload a file, read the website again. Editors and up. */
function Actions({ sb, ws, onNew, onDone, onScan }: { sb: SupabaseClient; ws: Workspace; onNew: () => void; onDone: (notice: string) => void; onScan: (notice: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "upload" | "scan">("");
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const form = new FormData();
      form.set("workspaceId", ws.id);
      form.set("file", file);
      const res = await fetch("/api/knowledge/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }).catch(() => null);
      if (!res) throw new Error("Couldn't reach the server. Check your connection and try again.");
      const out = (await res.json().catch(() => ({}))) as { error?: string; doc?: { title: string }; note?: string | null };
      if (!res.ok) throw new Error(out.error || "Something went wrong. Try again.");
      onDone(`Added "${out.doc?.title ?? file.name}" to Knowledge.${out.note ? ` ${out.note}` : ""}`);
    } catch (e) {
      setError(message(e));
    }
    setBusy("");
  }

  async function scan() {
    setBusy("scan");
    setError("");
    const { data, error } = await sb.rpc("rescan_website", { ws: ws.id });
    setBusy("");
    if (error) return setError(message(error));
    onScan(data ? "We're reading your website now. It takes about a minute." : "Your website is already being read. It takes about a minute.");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${btnPrimary} sm:w-auto`} onClick={onNew}>
          Add a doc
        </button>
        <button type="button" className={`${btnSecondary} sm:w-auto`} onClick={() => fileRef.current?.click()} disabled={busy !== ""}>
          {busy === "upload" ? "Uploading..." : "Upload a file"}
        </button>
        {ws.website ? (
          <button type="button" className={`${btnSecondary} sm:w-auto`} onClick={scan} disabled={busy !== ""}>
            {busy === "scan" ? "Starting..." : "Scan my website again"}
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={UPLOAD_TYPES.join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </div>
      <p className="text-[13px] text-ink-4">Files can be .txt, .md, .csv or .pdf, up to 5 MB.</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

type ScanStatus = { status: "queued" | "running" | "done" | "failed"; finished_at: string | null } | null;

/** Where reading the website is. Checks again every 5 seconds while it waits or runs, and reloads the docs when it ends. */
function WebsiteScan({ sb, ws, onFinished }: { sb: SupabaseClient; ws: Workspace; onFinished: () => void }) {
  const [state, setState] = useState<ScanStatus | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      sb.rpc("website_scan_status", { ws: ws.id }).then(({ data, error }) => {
        if (!live) return;
        // Before 012_knowledge.sql runs, or on a hiccup, say nothing rather than show an error here.
        const next = error ? null : ((data ?? [])[0] as ScanStatus) ?? null;
        const working = next?.status === "queued" || next?.status === "running";
        if (busy.current && !working) onFinished();
        busy.current = working;
        setState(next);
        if (working) timer = setTimeout(check, 5_000);
      });
    };
    check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sb, ws.id, onFinished]);

  if (!ws.website) {
    return (
      <div className="rounded-[12px] bg-sunk px-4 py-3 text-[14px] text-ink-3">
        Add your website in Settings, and your team will read it to learn about your business.{" "}
        <button type="button" className="font-medium text-clay-2 underline-offset-2 hover:underline" onClick={() => navigate("/settings")}>
          Add your website
        </button>
      </div>
    );
  }
  if (state === undefined || state === null) return null;
  const text =
    state.status === "queued"
      ? `Waiting to read ${ws.website}.`
      : state.status === "running"
        ? `Reading ${ws.website} now.`
        : state.status === "failed"
          ? `We couldn't read ${ws.website}. Check the address in Settings, then try again. You can also add facts by hand.`
          : `We read ${ws.website}${state.finished_at ? ` on ${shortDate(state.finished_at)}` : ""}.`;
  return (
    <div className={`${state.status === "failed" ? "bg-clay-bg" : "bg-sunk"} rounded-[12px] px-4 py-3 text-[14px] text-ink-2`} role="status">
      {text}
    </div>
  );
}

/** Search the docs as you type. */
function Search({ sb, workspaceId, onOpen }: { sb: SupabaseClient; workspaceId: string; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const text = q.trim();
    let live = true;
    const timer = setTimeout(
      async () => {
        if (!text) return live && setHits(null);
        const { data, error } = await sb.rpc("search_knowledge", { ws: workspaceId, q: text, n: 8 });
        if (!live) return;
        setError(error ? message(error) : "");
        setHits(error ? null : ((data ?? []) as Hit[]));
      },
      text ? 300 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sb, workspaceId, q]);

  return (
    <div className="flex flex-col gap-3">
      <label className="sr-only" htmlFor="kn-search">
        Search your docs
      </label>
      <input id="kn-search" type="search" className={input} placeholder="Search your docs" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {hits ? (
        <ul className="flex flex-col divide-y divide-line rounded-[12px] border border-line bg-surface">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-sunk" onClick={() => onOpen(h.id)}>
                <span className="break-words text-[15px] font-semibold">{h.title}</span>
                {h.snippet ? <span className="break-words text-[14px] text-ink-3">{h.snippet}</span> : null}
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li className="px-4 py-3 text-[14px] text-ink-4">No docs match that.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function DocList({ docs, editor, onOpen }: { docs: KnowledgeDoc[] | null; editor: boolean; onOpen: (id: string) => void }) {
  if (docs === null) return <p className="text-[14px] text-ink-4">Loading...</p>;
  if (!docs.length) {
    return (
      <div className={card}>
        <h2 className="text-[18px] font-semibold">No docs yet</h2>
        <p className="text-[14px] text-ink-3">
          {editor
            ? "Add what your team should know: what you sell, your prices and hours, and how you like to talk to customers."
            : "Editors can add what the team should know about the business."}
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-[15px] font-semibold">{d.title}</p>
            <p className="flex flex-wrap gap-x-3 text-[13px] text-ink-4">
              <span>For {agentName(d.agent)}</span>
              <span>{SOURCE_LABEL[d.source]}</span>
              <span>Changed {shortDate(d.updated_at)}</span>
            </p>
            {d.body ? <p className="mt-1 line-clamp-2 break-words text-[14px] text-ink-3">{d.body.slice(0, 300)}</p> : null}
          </div>
          <button type="button" className={`${btnSmall} shrink-0`} onClick={() => onOpen(d.id)}>
            {editor ? "Edit" : "Open"}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Add or change one doc. Viewers see it read only. */
function DocEditor({
  sb,
  ws,
  doc,
  editor,
  onClose,
  onDone,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  doc: KnowledgeDoc | null;
  editor: boolean;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const [title, setTitle] = useState(doc?.title ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  const [agent, setAgent] = useState(doc?.agent ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanDoc({ title, body, agent });
    if (!clean.ok) return setError(clean.error);
    setBusy(true);
    setError("");
    const { error } = doc
      ? await sb.from("knowledge_docs").update(clean.value).eq("id", doc.id).eq("workspace_id", ws.id)
      : await sb.from("knowledge_docs").insert({ workspace_id: ws.id, ...clean.value, source: "manual" });
    setBusy(false);
    if (error) return setError(message(error));
    onDone(doc ? "Saved." : `Added "${clean.value.title}" to Knowledge.`);
  }

  async function remove() {
    if (!doc) return;
    setBusy(true);
    const { error } = await sb.from("knowledge_docs").delete().eq("id", doc.id).eq("workspace_id", ws.id);
    setBusy(false);
    if (error) return setError(message(error));
    onDone(`Deleted "${doc.title}".`);
  }

  if (!editor && doc) {
    return (
      <article className={card}>
        <div>
          <h2 className="break-words text-[20px] font-semibold">{doc.title}</h2>
          <p className="text-[13px] text-ink-4">
            For {agentName(doc.agent)}. {SOURCE_LABEL[doc.source]}.
          </p>
        </div>
        <p className="whitespace-pre-wrap break-words text-[15px] text-ink-2">{doc.body || "This doc is empty."}</p>
        <button type="button" className={`${btnSecondary} sm:w-auto sm:self-start`} onClick={onClose}>
          Back to Knowledge
        </button>
      </article>
    );
  }

  return (
    <form onSubmit={save} className={card}>
      <h2 className="text-[18px] font-semibold">{doc ? "Edit doc" : "Add a doc"}</h2>
      {doc?.source === "website" ? <Notice>We made this doc from your website. Scanning your website again replaces it.</Notice> : null}
      <div>
        <label className={label} htmlFor="kn-title">
          Title
        </label>
        <input id="kn-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus={!doc} placeholder="Our prices" />
      </div>
      <div>
        <label className={label} htmlFor="kn-agent">
          Who uses it
        </label>
        <select id="kn-agent" className={input} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Everyone on the team</option>
          {DOC_AGENTS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.name}, {a.job.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="kn-body">
          What the team should know
        </label>
        <textarea
          id="kn-body"
          className={`${input} h-auto min-h-[280px] py-2 leading-relaxed`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={50_000}
          placeholder="Write it the way you would explain it to a new team member."
        />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={`${btnPrimary} sm:w-auto`} disabled={busy}>
          {busy ? "Saving..." : doc ? "Save" : "Add doc"}
        </button>
        <button type="button" className={`${btnSecondary} sm:w-auto`} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {doc ? (
          confirming ? (
            <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <span className="text-[14px] text-ink-2">Delete this doc for everyone?</span>
              <button type="button" className={btnDanger} onClick={remove} disabled={busy}>
                Delete
              </button>
              <button type="button" className={btnSmall} onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className={`${btnSmall} sm:ml-auto`} onClick={() => setConfirming(true)} disabled={busy}>
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
