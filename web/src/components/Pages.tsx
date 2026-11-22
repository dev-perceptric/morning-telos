"use client";

// Archon's Pages tab: the pages and posts he made on the business's own site, waiting or done, and one drawer to
// read, approve, turn down or open one. The rules are in src/lib/pagesWork.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { appLogo } from "@/lib/composio/catalog";
import { ago } from "@/lib/home";
import { pagesOf, pagesSummary, SITE_PRODUCTS, type Page } from "@/lib/pagesWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

const WORD: Record<Page["status"], string> = { wait: "Waiting for your OK", done: "On your site", failed: "Didn't go through", denied: "Turned down" };

function SiteLogo({ product }: { product: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={appLogo(product)} alt="" width={20} height={20} />;
}

export function HephaestusPages({ sb, ws, editor, onAsk }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void }) {
  const [view, setView] = useState<"wait" | "done">("wait");
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    sb.from("approvals")
      .select("id, product, tool, title, input, status, result, created_at, finished_at")
      .eq("workspace_id", ws.id)
      .eq("agent", "web")
      .in("product", [...SITE_PRODUCTS])
      .order("id", { ascending: false })
      .limit(100)
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setError("We couldn't load Archon's pages. Try again.");
        setError("");
        setPages(pagesOf((data ?? []) as Parameters<typeof pagesOf>[0]));
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const all = pages ?? [];
  const waiting = all.filter((p) => p.status === "wait");
  const list = view === "wait" ? waiting : all.filter((p) => p.status !== "wait");
  const summary = pagesSummary(all);

  async function decide(ids: number[], action: "approve" | "deny", done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      for (const id of ids) await callApi(sb, `/api/approvals/${id}`, { workspaceId: ws.id, action });
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
      {summary ? (
        <p className="po-sum">
          <Face agent="web" size={26} />
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
          <button type="button" role="radio" aria-checked={view === "done"} onClick={() => setView("done")}>
            Done <span className="seg-n">{all.length - waiting.length || ""}</span>
          </button>
        </span>
        <span className="flex-1" />
        {editor && waiting.length ? (
          <button type="button" className="btn sm" disabled={busy} onClick={() => decide(waiting.map((p) => p.approvalId), "approve", waiting.length === 1 ? "Approved." : `Approved ${waiting.length}.`)}>
            Approve {waiting.length} waiting
          </button>
        ) : null}
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => onAsk("Write a page about ")}>
            <Icon name="plus" small />
            New page
          </button>
        ) : null}
      </div>
      <div className="card list vis">
        {list.map((p) => (
          <button key={p.approvalId} type="button" className={`row${p.status === "wait" ? " wait" : ""}`} onClick={() => setOpen(p)}>
            <span className="lg-img">
              <SiteLogo product={p.product} />
            </span>
            <span className="main">
              <b>{p.title}</b>
              <small>
                {p.change}, {ago(p.at)}
              </small>
            </span>
            {p.status === "wait" ? (
              <span className="tag clay wt">Waiting for your OK</span>
            ) : p.status === "done" ? (
              <span className={`tag ${p.live ? "green ok" : "amber"}`}>{p.live ? "Live" : "Draft on your site"}</span>
            ) : (
              <span className="tag">{WORD[p.status]}</span>
            )}
          </button>
        ))}
        {pages && !list.length ? (
          view === "wait" ? (
            <Empty title="Nothing waiting">Ask Archon for a page. He writes it as a draft on your site and waits for your OK.</Empty>
          ) : (
            <Empty title="No pages yet">Pages Archon put on your site show up here.</Empty>
          )
        ) : null}
        {pages === null && !error ? <div className="empty">Loading...</div> : null}
      </div>

      <Drawer open={open !== null} title={open ? WORD[open.status] : ""} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="webprev dsec">
              <div className="wp-bar">
                <SiteLogo product={open.product} />
                {open.site}
              </div>
              <div className="pg-in">
                <h3>{open.title}</h3>
                {open.preview ? <p>{open.preview}</p> : <p className="hint-s">No words to show yet.</p>}
              </div>
            </div>
            {open.why ? <ErrorText>{open.why}</ErrorText> : null}
            {open.status === "wait" ? (
              <p className="po-take">
                <Face agent="web" size={24} />
                <span>{open.live ? "This puts it live on your site when you approve it." : "This goes on your site as a draft when you approve it. You publish it there when you're happy."}</span>
              </p>
            ) : null}
            <div className="po-foot">
              {editor && open.status === "wait" ? (
                <>
                  <button type="button" className="btn primary" disabled={busy} onClick={() => decide([open.approvalId], "approve", open.live ? "Approved. It's live." : "Approved. It's on your site as a draft.")}>
                    {open.live ? "Approve and publish" : "Approve"}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => decide([open.approvalId], "deny", "Turned down. Nothing changed on your site.")}>
                    Don&apos;t add
                  </button>
                </>
              ) : null}
              {open.url ? (
                <a className="btn" href={open.url} target="_blank" rel="noopener noreferrer">
                  Open it
                </a>
              ) : null}
              <button type="button" className="btn" onClick={() => onAsk(`About "${open.title}": `)}>
                <Icon name="message" small />
                Ask Archon
              </button>
            </div>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
