"use client";

// Artemis's Visibility tab: the AI questions she tracks and the content plan, from Arrowsterr, with one drawer for
// any question or topic. The data and the rules are in src/lib/seoWork.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { appLogo } from "@/lib/composio/catalog";
import { ENGINES, type Question, type Topic, type Visibility as Vis } from "@/lib/seoWork";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { callApi, getApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Data = {
  ready: boolean;
  questions: Question[];
  plan: Topic[];
  visibility?: Vis | null;
  summary: string | null;
  fetchedAt: string | null;
  approvals: { id: number; tool: string }[];
  limit: number;
  error?: string;
};
type Answer = { model: string; rank: number | null; named: string[]; sites: string[]; text: string | null };
type Open = { kind: "q"; item: Question | null } | { kind: "t"; item: Topic | null };

/** Each AI tool's logo, from the same place the Apps page gets its logos. */
const ENGINE_LOGO: Record<string, string> = { ChatGPT: "openai", Perplexity: "perplexityai", Gemini: "gemini", Claude: "claude", "AI Overview": "googleaioverview" };
const STATUS_WORD: Record<string, string> = { planned: "Planned", writing: "Writing", review: "In review", published: "Published" };
const STATUS_TONE: Record<string, string> = { writing: "amber", review: "amber", published: "green" };

const named = (v: string | undefined) => Boolean(v && v.startsWith("#"));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function EngineLogo({ engine, on = true }: { engine: string; on?: boolean }) {
  const id = ENGINE_LOGO[engine];
  if (!id) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={appLogo(id)} alt="" width={20} height={20} className={`eng-lg${on ? "" : " off"}`} title={`${engine}${on ? " names you" : " doesn't name you"}`} />;
}

export function SeoVisibility({ sb, ws, editor, onAsk, onAskWeb }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: () => void; onAskWeb: (text: string) => void }) {
  const [view, setView] = useState<"q" | "t">("q");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    getApi<Data>(sb, `/api/work/seo?${new URLSearchParams({ workspaceId: ws.id })}`).then(
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
  }, [sb, ws.id, version]);

  const questions = data?.questions ?? [];
  const plan = data?.plan ?? [];
  const waiting = [...questions, ...plan].filter((x) => x.wait);
  const waitingIds = [...new Set(waiting.map((x) => x.wait!.approvalId))];
  const engines = ENGINES.filter((e) => data?.visibility?.byModel.some((m) => m.model === e) || questions.some((q) => q.latest[e] !== undefined));
  const tracked = questions.filter((q) => !q.wait).length;

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
  const act = (body: Record<string, unknown>) => callApi(sb, "/api/work/seo", { workspaceId: ws.id, ...body });

  return (
    <div className="vis">
      {data?.summary ? (
        <p className="po-sum">
          <Face agent="seo" size={26} />
          <span>{data.summary}</span>
        </p>
      ) : null}
      {data && !data.ready ? <Notice>Artemis&apos;s SEO tools are still setting up. Check back in a few minutes.</Notice> : null}
      {error || data?.error ? <ErrorText>{error || data?.error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}

      <div className="po-bar">
        <span className="seg" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" aria-checked={view === "q"} onClick={() => setView("q")}>
            Questions <span className="seg-n">{questions.length || ""}</span>
          </button>
          <button type="button" role="radio" aria-checked={view === "t"} onClick={() => setView("t")}>
            Content plan <span className="seg-n">{plan.length || ""}</span>
          </button>
        </span>
        <span className="flex-1" />
        {editor && waitingIds.length ? (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                for (const id of waitingIds) await decide(id, "approve");
              }, `Approved ${waiting.length}.`)
            }
          >
            Approve {waiting.length} waiting
          </button>
        ) : null}
        {editor && data?.ready ? (
          <button type="button" className="btn primary sm" onClick={() => setOpen(view === "q" ? { kind: "q", item: null } : { kind: "t", item: null })}>
            <Icon name="plus" small />
            {view === "q" ? "Track a question" : "Add topic"}
          </button>
        ) : null}
      </div>

      {view === "q" ? (
        <div className="card list">
          {questions.map((q) => (
            <button key={`${q.prompt}:${q.wait?.approvalId ?? ""}`} type="button" className={`row${q.wait ? " wait" : ""}`} onClick={() => setOpen({ kind: "q", item: q })}>
              <span className="lg-img">
                <Icon name="search" small />
              </span>
              <span className="main">
                <b>{q.prompt}</b>
                <small>{q.wait ? "Artemis wants to track this" : q.position !== null ? `You show up at #${Math.round(q.position)} when you're named` : "No AI names you yet"}</small>
              </span>
              {q.wait ? (
                <span className="tag clay wt">Waiting for your OK</span>
              ) : (
                <span className="eng">
                  {engines.map((e) => (
                    <EngineLogo key={e} engine={e} on={named(q.latest[e])} />
                  ))}
                </span>
              )}
            </button>
          ))}
          {data && !questions.length ? (
            <Empty title="No questions yet">Artemis asks ChatGPT, Perplexity and Gemini these every day. Your first results show up the day after you add one.</Empty>
          ) : null}
          {data === null && !error ? <div className="empty">Loading...</div> : null}
        </div>
      ) : (
        <div className="card list">
          {plan.map((t) => (
            <button key={`${t.id ?? t.keyword}:${t.wait?.approvalId ?? ""}`} type="button" className={`row${t.wait ? " wait" : ""}`} onClick={() => setOpen({ kind: "t", item: t })}>
              <span className="lg-img">
                <Icon name="file" small />
              </span>
              <span className="main">
                <b>{t.keyword}</b>
                <small>{t.volume !== null ? `${t.volume.toLocaleString()} searches a month` : "Search volume not known yet"}</small>
              </span>
              {t.wait ? <span className="tag clay wt">Waiting for your OK</span> : <span className={`tag ${STATUS_TONE[t.status] ?? ""}`}>{STATUS_WORD[t.status] ?? t.status}</span>}
            </button>
          ))}
          {data && !plan.length ? <Empty title="No topics yet">Artemis plans what to write next from the questions people ask.</Empty> : null}
          {data === null && !error ? <div className="empty">Loading...</div> : null}
        </div>
      )}
      {editor && view === "q" && data?.ready && data.limit ? (
        <p className="hint-s mt-3">
          {tracked} of {data.limit} questions on your plan
        </p>
      ) : null}

      <Drawer
        open={open !== null}
        title={open ? (open.kind === "q" ? (open.item ? (open.item.wait ? "Waiting for your OK" : "AI answers") : "Track a question") : open.item ? (open.item.wait ? "Waiting for your OK" : "Topic") : "Add topic") : ""}
        onClose={() => setOpen(null)}
      >
        {open?.kind === "q" ? (
          <QuestionDrawer
            key={open.item?.prompt ?? "new"}
            sb={sb}
            ws={ws}
            item={open.item}
            editor={editor}
            busy={busy}
            onAsk={onAsk}
            onTrack={(question) => run(() => act({ action: "track", question }), "Artemis starts asking it tomorrow.")}
            onDecide={(action) => open.item?.wait && run(() => decide(open.item!.wait!.approvalId, action), action === "approve" ? "Approved." : "Turned down.")}
          />
        ) : open?.kind === "t" ? (
          <TopicDrawer
            key={open.item?.id ?? open.item?.keyword ?? "new"}
            item={open.item}
            editor={editor}
            busy={busy}
            onAsk={onAsk}
            onAdd={(keyword, notes) => run(() => act({ action: "add_topic", keyword, notes }), "Added to the content plan.")}
            onWrite={(t) =>
              run(async () => {
                if (t.id) await act({ action: "status", id: t.id, status: "writing" });
                onAskWeb(`Write a page for "${t.keyword}"${t.notes ? `. Notes from Artemis: ${t.notes}` : ""}`);
              }, "Hephaestus is on it.")
            }
            onRemove={(t) => t.id && run(() => act({ action: "remove_topic", id: t.id }), "Removed from the content plan.")}
            onDecide={(action) => open.item?.wait && run(() => decide(open.item!.wait!.approvalId, action), action === "approve" ? "Approved." : "Turned down.")}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function QuestionDrawer({
  sb,
  ws,
  item,
  editor,
  busy,
  onAsk,
  onTrack,
  onDecide,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  item: Question | null;
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onTrack: (q: string) => void;
  onDecide: (a: "approve" | "deny") => void;
}) {
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [error, setError] = useState("");
  const prompt = item && !item.wait ? item.prompt : null;
  useEffect(() => {
    if (!prompt) return;
    let live = true;
    getApi<{ answers: Answer[] }>(sb, `/api/work/seo?${new URLSearchParams({ workspaceId: ws.id, prompt })}`).then(
      (r) => live && setAnswers(r.answers),
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [sb, ws.id, prompt]);

  if (!item)
    return (
      <>
        <div className="po-f">
          <label htmlFor="q-text">A question people ask an AI</label>
          <input id="q-text" type="text" value={text} maxLength={300} placeholder="Best bakery near downtown Austin" onChange={(e) => setText(e.target.value)} />
        </div>
        <p className="po-take">
          <Face agent="seo" size={24} />
          <span>I&apos;ll ask ChatGPT, Perplexity and Gemini every day and show you who they name.</span>
        </p>
        <div className="po-foot">
          <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => onTrack(text.trim())}>
            Track it
          </button>
        </div>
      </>
    );

  return (
    <>
      <p className="dq">{item.prompt}</p>
      {item.wait ? (
        <p className="po-take">
          <Face agent="seo" size={24} />
          <span>Artemis wants to track this question. It counts toward your plan once you approve it.</span>
        </p>
      ) : (
        <>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {answers === null && !error ? <div className="empty">Loading...</div> : null}
          {answers?.length ? (
            <div className="dsec">
              <h4>What each AI says today</h4>
              <div className="ans">
                {answers.map((a) => (
                  <div key={a.model}>
                    <div className="hd">
                      <EngineLogo engine={a.model} />
                      {a.model}
                      {a.rank !== null ? <span className="tag green ok">Names you at #{a.rank}</span> : <span className="tag">Doesn&apos;t name you</span>}
                    </div>
                    {a.named.length ? <p className="ans-n">{a.named.join(", ")}</p> : null}
                    {a.text ? <p>{a.text.length > 400 ? `${a.text.slice(0, 400).replace(/\s+\S*$/, "")}...` : a.text}</p> : null}
                    {a.sites.length ? (
                      <div className="chips">
                        {a.sites.slice(0, 4).map((s) => (
                          <span key={s} className="tag">
                            {host(s)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : answers ? (
            <Empty title="No answers yet">Artemis asks this tomorrow.</Empty>
          ) : null}
          {item.mostNamed.length ? (
            <div className="dsec">
              <h4>Named most often</h4>
              <div className="chips">
                {item.mostNamed.map((n) => (
                  <span key={n} className="tag">
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div className="po-foot">
        {editor && item.wait ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onDecide("approve")}>
              Approve
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide("deny")}>
              Don&apos;t track
            </button>
          </>
        ) : null}
        <button type="button" className="btn" onClick={onAsk}>
          <Icon name="message" small />
          Ask Artemis
        </button>
      </div>
    </>
  );
}

function TopicDrawer({
  item,
  editor,
  busy,
  onAsk,
  onAdd,
  onWrite,
  onRemove,
  onDecide,
}: {
  item: Topic | null;
  editor: boolean;
  busy: boolean;
  onAsk: () => void;
  onAdd: (keyword: string, notes: string) => void;
  onWrite: (t: Topic) => void;
  onRemove: (t: Topic) => void;
  onDecide: (a: "approve" | "deny") => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [notes, setNotes] = useState("");
  const [asking, setAsking] = useState(false);
  if (!item)
    return (
      <>
        <div className="po-f">
          <label htmlFor="t-kw">Keyword</label>
          <input id="t-kw" type="text" value={keyword} maxLength={200} placeholder="ai seo audit" onChange={(e) => setKeyword(e.target.value)} />
          <label htmlFor="t-notes" className="mt-3">
            Notes for the writer
          </label>
          <textarea id="t-notes" value={notes} maxLength={2000} style={{ minHeight: 100 }} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="po-foot">
          <button type="button" className="btn primary" disabled={busy || !keyword.trim()} onClick={() => onAdd(keyword.trim(), notes.trim())}>
            Add
          </button>
        </div>
      </>
    );
  return (
    <>
      <p className="dq">{item.keyword}</p>
      <div className="facts dsec">
        <div>
          <small>Searches a month</small>
          <b>{item.volume !== null ? item.volume.toLocaleString() : "Not known"}</b>
        </div>
        <div>
          <small>Difficulty</small>
          <b>{item.difficulty !== null ? `${item.difficulty} of 100` : "Not known"}</b>
        </div>
        <div>
          <small>Status</small>
          <b>{item.wait ? "Waiting" : (STATUS_WORD[item.status] ?? item.status)}</b>
        </div>
      </div>
      {item.notes ? (
        <p className="po-take">
          <Face agent="seo" size={24} />
          <span>{item.notes}</span>
        </p>
      ) : null}
      {item.url ? (
        <p className="dsec">
          <a className="link-u" href={item.url} target="_blank" rel="noopener noreferrer">
            {host(item.url)}
          </a>
        </p>
      ) : null}
      <div className="po-foot">
        {editor && item.wait ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onDecide("approve")}>
              Approve
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide("deny")}>
              Don&apos;t add
            </button>
          </>
        ) : editor && item.status === "planned" ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => onWrite(item)}>
            Write this
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onAsk}>
          <Icon name="message" small />
          Ask Artemis
        </button>
        <span className="sp" />
        {editor && item.id && !item.wait ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={() => onRemove(item)}>
                Remove topic
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Remove topic" title="Remove topic" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}
