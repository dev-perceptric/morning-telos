"use client";

// Knowledge: what the team knows about the business (supabase/012_knowledge.sql), laid out like the current app's
// Knowledge page: the docs on the left and the open doc on the right. Everyone in the workspace reads the docs; editors
// and up add, change, delete and upload them, and can have the website read again.
// The list and search run as the signed-in person, so row level security decides what they see and change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ago } from "@/lib/home";
import { agentName, cleanDoc, DOC_AGENTS, SOURCE_LABEL, UPLOAD_TYPES, type KnowledgeDoc } from "@/lib/knowledge";
import { can } from "@/lib/workspace";
import { Icon } from "./icons";
import { message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Empty, ErrorText, input, label, Notice, PageHead, to } from "./ui";

const COLUMNS = "id, title, body, agent, source, source_url, updated_at";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type Hit = { id: string; title: string; snippet: string; rank: number };

export function KnowledgePage({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const editor = can(ws.role, "editKnowledge");
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The doc open on the right: "new", a doc id, or nothing (a new doc for editors on a computer).
  const [open, setOpen] = useState<string | null>(null);
  // Bumped when someone starts a website scan, so the status line looks again.
  const [scans, setScans] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "upload" | "scan">("");

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

  const done = (text: string, id: string | null = null) => {
    setOpen(id);
    setNotice(text);
    load();
  };

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
      done(`Added "${out.doc?.title ?? file.name}" to Knowledge.${out.note ? ` ${out.note}` : ""}`);
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
    setNotice(data ? "We're reading your website now. It takes about a minute." : "Your website is already being read. It takes about a minute.");
    setScans((n) => n + 1);
  }

  const current = open && open !== "new" ? (docs?.find((d) => d.id === open) ?? null) : null;

  return (
    <>
      <PageHead title="Knowledge" sub="What your team knows: services, prices, voice and rules. Every teammate reads it before they act.">
        {editor ? (
          <>
            {ws.website ? (
              <button type="button" className="btn" onClick={scan} disabled={busy !== ""}>
                <Icon name="refresh" small />
                {busy === "scan" ? "Starting..." : "Scan my website again"}
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy !== ""} title={`Files can be ${UPLOAD_TYPES.join(", ")}, up to 5 MB.`}>
              <Icon name="upload" small />
              {busy === "upload" ? "Uploading..." : "Upload a file"}
            </button>
            <button type="button" className="btn" onClick={() => setOpen("new")}>
              <Icon name="plus" small />
              New doc
            </button>
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
          </>
        ) : null}
      </PageHead>
      {notice ? (
        <div className="note-box flex items-start justify-between gap-3" role="status">
          <span>{notice}</span>
          <button type="button" className="text-ink-4 hover:text-ink" aria-label="Close" onClick={() => setNotice("")}>
            <Icon name="close" small />
          </button>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <WebsiteScan key={scans} sb={sb} ws={ws} onFinished={load} />

      <div className={`split${open ? " has-pick" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3">
          <Search sb={sb} workspaceId={ws.id} onOpen={setOpen}>
            <div className="card list">
              {docs === null ? null : docs.length ? (
                docs.map((d) => (
                  <button key={d.id} type="button" className={`row${d.id === open ? " sel" : ""}`} onClick={() => setOpen(d.id)}>
                    <span className={`ki${d.agent ? " l" : d.source === "website" ? " s" : d.source === "file" ? " a" : ""}`}>DOC</span>
                    <span className="main">
                      <b>{d.title}</b>
                      <small>
                        {d.agent ? `Only ${agentName(d.agent)}` : "Everyone"} · {ago(d.updated_at)}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <Empty title="Nothing yet">{editor ? "Start with your services, prices, service area and brand voice." : "Editors can add what the team should know about the business."}</Empty>
              )}
            </div>
          </Search>
          {editor ? <p className="hint-s">Files can be .txt, .md, .csv or .pdf, up to 5 MB.</p> : null}
        </div>
        <div className="card pad pane">
          <a
            className="back m-only"
            href={to("/knowledge")}
            onClick={(e) => {
              e.preventDefault();
              setOpen(null);
            }}
          >
            <Icon name="back" small />
            Knowledge
          </a>
          {current || editor ? (
            <DocEditor key={open ?? "new"} sb={sb} ws={ws} doc={current} editor={editor} onClose={() => setOpen(null)} onDone={done} />
          ) : (
            <Empty title="Pick a doc">Its details show here.</Empty>
          )}
        </div>
      </div>
    </>
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
        const next = error ? null : (((data ?? [])[0] as ScanStatus) ?? null);
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
      <div className="note-box">
        Add your website in Settings, and your team will read it to learn about your business.{" "}
        <button type="button" className="link-u" onClick={() => navigate("/settings")}>
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
    <div className={`note-box${state.status === "failed" ? " warn" : ""}`} role="status">
      {text}
    </div>
  );
}

/** Search the docs as you type. Shows the matches in place of the list. */
function Search({ sb, workspaceId, onOpen, children }: { sb: SupabaseClient; workspaceId: string; onOpen: (id: string) => void; children: React.ReactNode }) {
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
    <>
      <label className="field">
        <Icon name="search" small />
        <span className="sr">Search your docs</span>
        <input type="search" placeholder="Search your docs" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {hits ? (
        <div className="card list">
          {hits.map((h) => (
            <button key={h.id} type="button" className="row items-start" onClick={() => onOpen(h.id)}>
              <span className="ki">DOC</span>
              <span className="main">
                <b>{h.title}</b>
                {h.snippet ? <small className="wrap">{h.snippet}</small> : null}
              </span>
            </button>
          ))}
          {hits.length === 0 ? <Empty title="No matches">No docs match that.</Empty> : null}
        </div>
      ) : (
        children
      )}
    </>
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
  onDone: (notice: string, id?: string | null) => void;
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
    const { data, error } = doc
      ? await sb.from("knowledge_docs").update(clean.value).eq("id", doc.id).eq("workspace_id", ws.id).select("id").maybeSingle()
      : await sb
          .from("knowledge_docs")
          .insert({ workspace_id: ws.id, ...clean.value, source: "manual" })
          .select("id")
          .maybeSingle();
    setBusy(false);
    if (error) return setError(message(error));
    onDone(doc ? "Saved. Your team will use it from now on." : `Added "${clean.value.title}" to Knowledge.`, (data as { id: string } | null)?.id ?? null);
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
      <article className="flex flex-col gap-3">
        <div className="tl-h">
          <span className="ki">DOC</span>
          <div className="min-w-0">
            <b>{doc.title}</b>
            <small>
              For {agentName(doc.agent)}. {SOURCE_LABEL[doc.source]}.
            </small>
          </div>
        </div>
        <p className="kbody">{doc.body || "This doc is empty."}</p>
      </article>
    );
  }

  return (
    <form onSubmit={save}>
      {doc?.source === "website" ? (
        <div className="mb-3">
          <Notice>We made this doc from your website. Scanning your website again replaces it.</Notice>
        </div>
      ) : null}
      <div className="fld">
        <label className={label} htmlFor="kn-title">
          Title
        </label>
        <input id="kn-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="Services and prices" />
      </div>
      <div className="fld">
        <label className={label} htmlFor="kn-agent">
          Who uses it
        </label>
        <select id="kn-agent" className="sel" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Everyone</option>
          {DOC_AGENTS.map((a) => (
            <option key={a.key} value={a.key}>
              Only {a.name} ({a.job})
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label className={label} htmlFor="kn-body">
          Details
        </label>
        <textarea id="kn-body" className="ta" style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50_000} placeholder="Write it like you'd brief a new hire." />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="rv-act">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
        {doc ? (
          <button type="button" className="btn ghost m-hide" onClick={onClose} disabled={busy}>
            New doc
          </button>
        ) : null}
        {doc ? (
          confirming ? (
            <span className="note flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-2">Delete this doc for everyone?</span>
              <button type="button" className="btn sm danger" onClick={remove} disabled={busy}>
                Delete
              </button>
              <button type="button" className="btn sm" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="btn ghost" onClick={() => setConfirming(true)} disabled={busy}>
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
