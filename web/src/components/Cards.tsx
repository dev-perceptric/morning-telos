"use client";

// Answer cards on screen (src/lib/cards.ts): questions with options, quick replies, tables, charts, Connect buttons,
// social posts and emails to approve, goals, plans and progress, shaped like the approved Outcome Chat demo. Also the
// goal pinned at the top of its chat and the Goals list in the sidebar.
//
// Every word on a card is shown as text (React escapes it); nothing is put in as HTML. A card's buttons only send a
// message as the person, decide an approval through POST /api/approvals/:id, or start a goal or a plan, which the
// browser saves as the signed-in person (row level security: editors and up, supabase/024_goals.sql).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  approvalRequest,
  CHART_BOX,
  chartBoxFor,
  chartPoints,
  labelEvery,
  chartRange,
  chartSummary,
  choicesReady,
  choicesText,
  dayLabel,
  emailInputWith,
  GOAL_STATUS_LABEL,
  goalSentence,
  goalStartText,
  goalStatus,
  meterPercent,
  meterText,
  NETWORK_LIMIT,
  NETWORK_NAME,
  numLabel,
  picksFrom,
  planGoText,
  postInputWith,
  shiftMonths,
  togglePick,
  type Card,
  type ChartCard,
  type ChoicesCard,
  type ConnectCard,
  type EmailPreviewCard,
  type GoalCard,
  type GoalStatus,
  type Network,
  type PlanCard,
  type PostItem,
  type PostPreviewCard,
  type ProgressCard,
  type QuickRepliesCard,
  type TableCard,
} from "@/lib/cards";
import { connectName } from "@/lib/cardTools";
import { appLogo } from "@/lib/composio/catalog";
import { GOAL_COLUMNS, goalInsert, goalOf, startError, STEP_COLUMNS, stepInserts, type GoalRow, type StepRow } from "@/lib/goals";
import { STATUS_LABEL, type ApprovalStatus } from "@/lib/approvals";
import { AGENTS, type AgentKey } from "@/lib/team";
import { networkName, sameNetwork } from "@/lib/socialChannels";
import { can } from "@/lib/workspace";
import { Icon } from "./icons";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { NetworkChooser } from "./Social";
import { ErrorText } from "./ui";

type StepStatus = StepRow["status"];

/** What every card in a chat shares: who is looking, how to answer, and what changed live on the stream. */
export type CardsEnv = {
  sb: SupabaseClient;
  ws: Workspace;
  threadId: string | null;
  /** Sends the person's answer as their next message, to the teammate who showed the card. */
  reply: (text: string, agent: AgentKey) => void;
  busy: boolean;
  /** Steps moved on the stream (update_step), by plan and position. */
  steps: Record<string, Record<number, StepStatus>>;
  /** Goes up when a goal changes (log_progress, a goal started here), so goal views read it again. */
  goalTick: number;
  onGoal: () => void;
};
const CardsContext = createContext<CardsEnv | null>(null);
export const CardsProvider = CardsContext.Provider;
const useEnv = () => {
  const env = useContext(CardsContext);
  if (!env) throw new Error("Cards need a CardsProvider.");
  return env;
};

/**
 * The cards under one reply. `answer`: the person's next message after this reply, if any. A card that asked
 * something is locked once it is answered, and shows what was sent.
 */
export function AnswerCards({ cards, answer }: { cards: Card[]; answer: string | null }) {
  if (!cards.length) return null;
  return (
    <div className="acards">
      {cards.map((c) => (
        <CardView key={c.id} card={c} answer={answer} />
      ))}
    </div>
  );
}

function CardView({ card, answer }: { card: Card; answer: string | null }) {
  switch (card.kind) {
    case "choices":
      return <Choices card={card} answer={answer} />;
    case "quick_replies":
      return <QuickReplies card={card} answered={answer !== null} />;
    case "table":
      return <TableView card={card} />;
    case "chart":
      return <ChartView card={card} />;
    case "connect":
      return <Connect card={card} answered={answer !== null} />;
    case "post_preview":
      return <PostPreview card={card} />;
    case "email_preview":
      return <EmailPreview card={card} />;
    case "goal":
      return <GoalView card={card} answered={answer !== null} />;
    case "plan":
      return <PlanView card={card} answered={answer !== null} />;
    case "progress":
      return <ProgressView card={card} />;
  }
}

/** The card's frame: a small gray heading on the left, a note on the right, then its body. */
function Shell({ title, note, accent, children, label }: { title: string; note?: React.ReactNode; accent?: boolean; label?: string; children: React.ReactNode }) {
  return (
    <section className={`acard${accent ? " accent" : ""}`} aria-label={label ?? title}>
      <div className="acard-h">
        <span>{title}</span>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

const Done = ({ children }: { children: React.ReactNode }) => (
  <div className="acard-ok" role="status">
    <Icon name="tick" small />
    <span className="wrap">{children}</span>
  </div>
);

// ─────────────── choices and quick replies ───────────────

function Choices({ card, answer }: { card: ChoicesCard; answer: string | null }) {
  const env = useEnv();
  const editor = can(env.ws.role, "chat");
  const [picks, setPicks] = useState<string[][]>(() => card.questions.map((q) => q.picked));
  const [sent, setSent] = useState(false);
  const locked = sent || answer !== null || !editor;
  // Answered before this page opened: show what was sent.
  const shown = answer !== null && !sent ? picksFrom(card, answer) : picks;
  const send = () => {
    if (locked || env.busy || !choicesReady(card, picks)) return;
    setSent(true);
    env.reply(choicesText(card, picks), card.agent);
  };
  return (
    <Shell title={card.title ?? "A few choices"} note={card.note}>
      {card.questions.map((q, i) => (
        <div key={i} className="aq" role="group" aria-labelledby={`${card.id}-q${i}`}>
          <span id={`${card.id}-q${i}`} className="aq-l">
            {q.label}
            {q.multi ? <small> Pick any</small> : null}
          </span>
          <div className="aopts">
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                className={`aopt${shown[i]?.includes(o) ? " on" : ""}`}
                aria-pressed={shown[i]?.includes(o) ?? false}
                disabled={locked}
                onClick={() => setPicks((p) => p.map((x, j) => (j === i ? togglePick(q, x, o) : x)))}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!editor ? null : (
        <div className="acard-b">
          <button type="button" className="btn primary sm" disabled={locked || env.busy || !choicesReady(card, picks)} onClick={send}>
            {card.submit}
          </button>
        </div>
      )}
    </Shell>
  );
}

function QuickReplies({ card, answered }: { card: QuickRepliesCard; answered: boolean }) {
  const env = useEnv();
  const [gone, setGone] = useState(false);
  if (answered || gone || !can(env.ws.role, "chat")) return null;
  return (
    <div className="aqr" role="group" aria-label={card.title ?? "Quick replies"}>
      {card.replies.map((r) => (
        <button
          key={r}
          type="button"
          disabled={env.busy}
          onClick={() => {
            setGone(true);
            env.reply(r, card.agent);
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// ─────────────── table and chart ───────────────

function TableView({ card }: { card: TableCard }) {
  const env = useEnv();
  const editor = can(env.ws.role, "chat");
  const hasRowActions = editor && card.rows.some((r) => r.action);
  return (
    <Shell title={card.title ?? "Table"} note={card.note ?? `${card.rows.length} row${card.rows.length === 1 ? "" : "s"}`}>
      <div className="md-table atable" role="region" aria-label={card.title ?? "Table"} tabIndex={0}>
        <table>
          <thead>
            <tr>
              {card.columns.map((c, i) => (
                <th key={i} scope="col" className={card.numeric[i] ? "num al-r" : undefined}>
                  {c}
                </th>
              ))}
              {hasRowActions ? (
                <th scope="col">
                  <span className="sr">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, j) => (
              <tr key={j}>
                {r.cells.map((c, i) => (
                  <td key={i} className={card.numeric[i] ? "num al-r" : undefined}>
                    {typeof c === "number" ? numLabel(c) : c}
                  </td>
                ))}
                {hasRowActions ? (
                  <td className="al-r">
                    {r.action ? (
                      <button type="button" className="btn sm" disabled={env.busy} onClick={() => env.reply(r.action!.message, card.agent)}>
                        {r.action.label}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editor && card.actions.length ? (
        <div className="acard-b">
          {card.actions.map((a, i) => (
            <button key={a.label} type="button" className={`btn sm${i === 0 ? " primary" : ""}`} disabled={env.busy} onClick={() => env.reply(a.message, card.agent)}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </Shell>
  );
}

/** A line or bars in the brand's accent, with the values in a hidden table for screen readers. */
function ChartView({ card }: { card: ChartCard }) {
  const range = chartRange(card.values);
  // The box follows the card's width, so a phone gets a narrower box and labels it can read.
  const ref = useRef<SVGSVGElement>(null);
  const [B, setB] = useState(CHART_BOX);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    setB(chartBoxFor(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setB(chartBoxFor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = chartPoints(card.values, range, B);
  const base = chartPoints([Math.max(range.min, 0)], range, B)[0].y;
  const every = labelEvery(card.labels.length, B);
  const slot = (B.w - B.left - B.right) / card.values.length;
  const bars = card.type === "bar" ? chartPoints(card.values, range, { ...B, left: B.left + slot / 2, right: B.right + slot / 2 }) : pts;
  return (
    <Shell title={card.title ?? "Chart"} note={card.note ?? card.unit ?? undefined}>
      <svg ref={ref} className="achart" viewBox={`0 0 ${B.w} ${B.h}`} role="img" aria-label={chartSummary(card)}>
        <line x1={B.left} x2={B.w - B.right} y1={base} y2={base} className="ax" />
        <line x1={B.left} x2={B.w - B.right} y1={B.top} y2={B.top} className="grid" />
        <text x={B.left - 6} y={B.top + 4} textAnchor="end">
          {numLabel(range.max)}
        </text>
        <text x={B.left - 6} y={base + 4} textAnchor="end">
          {numLabel(Math.max(range.min, 0))}
        </text>
        {card.type === "bar" ? (
          bars.map((p, i) => <rect key={i} x={p.x - slot * 0.32} width={slot * 0.64} y={Math.min(p.y, base)} height={Math.abs(base - p.y)} rx={3} className="bar" />)
        ) : (
          <>
            <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} className="line" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} className="dot" />
            ))}
          </>
        )}
        {(card.type === "bar" ? bars : pts).map((p, i) =>
          i % every === 0 || i === card.labels.length - 1 ? (
            <text key={i} x={p.x} y={B.h - 6} textAnchor="middle">
              {card.labels[i]}
            </text>
          ) : null,
        )}
      </svg>
      <table className="sr">
        <tbody>
          {card.labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              <td>{numLabel(card.values[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

// ─────────────── connect ───────────────

/** True when the app is connected now, read as the signed-in person. */
async function isConnected(sb: SupabaseClient, ws: string, app: string, network = ""): Promise<boolean> {
  if (app === "social") {
    // One network when the person picked one in the chooser, else any.
    const r = await sb.from("social_channels").select("network").eq("workspace_id", ws).eq("status", "connected");
    return !r.error && ((r.data ?? []) as { network: string }[]).some((c) => !network || sameNetwork(c.network, network));
  }
  if (app === "wordpress") {
    const r = await sb.from("wordpress_sites").select("status").eq("workspace_id", ws).maybeSingle();
    return !r.error && (r.data as { status?: string } | null)?.status === "active";
  }
  const r = await sb.from("app_connections").select("status").eq("workspace_id", ws).eq("toolkit", app).maybeSingle();
  return !r.error && (r.data as { status?: string } | null)?.status === "active";
}

/** How long a Connect waits for the sign-in in the other tab. */
const CONNECT_WAIT_MS = 15 * 60_000;

function Connect({ card, answered }: { card: ConnectCard; answered: boolean }) {
  const env = useEnv();
  const name = connectName(card.app);
  const allowed = can(env.ws.role, card.app === "social" ? "connectSocial" : "connectApps");
  const [state, setState] = useState<"idle" | "opening" | "waiting" | "done">("idle");
  const [error, setError] = useState("");
  const [site, setSite] = useState("");
  const [already, setAlready] = useState(false);
  // The network picked in the chooser (social only), so the chat carries on once that one is in.
  const [network, setNetwork] = useState("");
  const { sb, ws, reply } = env;

  useEffect(() => {
    let live = true;
    isConnected(sb, ws.id, card.app).then((yes) => live && setAlready(yes));
    return () => {
      live = false;
    };
  }, [sb, ws.id, card.app]);

  // While the sign-in is open in another tab: look every few seconds, and as soon as this tab is back in view.
  useEffect(() => {
    if (state !== "waiting") return;
    const until = Date.now() + CONNECT_WAIT_MS;
    let live = true;
    const look = async () => {
      if (!live) return;
      if (Date.now() > until) return setState("idle");
      if (await isConnected(sb, ws.id, card.app, network)) {
        if (!live) return;
        setState("done");
        reply(`${network ? networkName(network) : name} is connected. Please carry on.`, card.agent);
      }
    };
    const t = setInterval(look, 4000);
    const back = () => document.visibilityState === "visible" && look();
    document.addEventListener("visibilitychange", back);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [state, sb, ws.id, card.app, card.agent, name, network, reply]);

  const open = async () => {
    setError("");
    setState("opening");
    // The tab opens on the click, so pop-up blockers let it through.
    const tab = window.open("", "_blank");
    try {
      const { url } =
        card.app === "wordpress"
            ? await callApi<{ url: string }>(sb, "/api/apps/wordpress", { workspaceId: ws.id, action: "connect", site })
            : await callApi<{ url: string }>(sb, "/api/apps/connect", { workspaceId: ws.id, toolkit: card.app });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, "_blank", "noopener");
      setState("waiting");
    } catch (e) {
      tab?.close();
      setError(message(e));
      setState("idle");
    }
  };

  if (state === "done") return <Done>{network ? networkName(network) : name} connected. Carrying on.</Done>;
  return (
    <Shell title={card.title ?? "One step"} note={card.note} accent label={`Connect ${name}`}>
      <div className="aconn">
        {card.app === "social" ? (
          <span className="aconn-ic" aria-hidden>
            <Icon name="team" small />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={appLogo(card.app)} alt="" width={32} height={32} className="aconn-ic" />
        )}
        <span className="wrap">{card.text}</span>
      </div>
      {already && (answered || state === "idle") ? (
        <Done>{name} is connected.</Done>
      ) : !allowed ? (
        <p className="acard-hint">Ask an admin or the owner to connect {name}.</p>
      ) : card.app === "social" ? (
        // Our own chooser of networks. The sign-in opens in a new tab and this card waits for the account.
        <div className="acard-b col">
          <NetworkChooser
            sb={sb}
            ws={ws}
            from={{ to: "chat", thread: env.threadId ?? "", agent: card.agent }}
            onOpened={(n) => {
              setNetwork(n);
              setState("waiting");
            }}
          />
          {state === "waiting" ? <span className="acard-hint">Finish in the new tab. We carry on when it&apos;s done.</span> : null}
        </div>
      ) : (
        <div className="acard-b">
          {card.app === "wordpress" ? (
            <input className="inp aconn-site" aria-label="Your WordPress site's address" placeholder="yoursite.com" value={site} onChange={(e) => setSite(e.target.value)} />
          ) : null}
          <button type="button" className="btn primary sm" disabled={state === "opening" || (card.app === "wordpress" && !site.trim())} onClick={open}>
            {state === "opening" ? "Opening..." : state === "waiting" ? `Open ${name} again` : `Connect ${name}`}
          </button>
          {state === "waiting" ? <span className="acard-hint">Finish in the new tab. We carry on when it&apos;s done.</span> : null}
        </div>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Shell>
  );
}

// ─────────────── approvals behind previews ───────────────

type ApRow = { id: number; status: ApprovalStatus; input: Record<string, unknown>; result: string | null };

/** The approvals a preview points at, read as the signed-in person, and a way to decide one. */
function useApprovalRows(ids: number[]) {
  const { sb, ws } = useEnv();
  const [rows, setRows] = useState<Record<number, ApRow>>({});
  const key = ids.join(",");
  useEffect(() => {
    const list = key ? key.split(",").map(Number) : [];
    if (!list.length) return;
    let live = true;
    sb.from("approvals")
      .select("id, status, input, result")
      .eq("workspace_id", ws.id)
      .in("id", list)
      .then(({ data }) => live && setRows(Object.fromEntries(((data ?? []) as ApRow[]).map((r) => [r.id, r]))));
    return () => {
      live = false;
    };
  }, [sb, ws.id, key]);
  const decide = useCallback(
    async (id: number, action: "approve" | "deny", input?: Record<string, unknown> | null) => {
      const req = approvalRequest(ws.id, id, action, input);
      const out = await callApi<{ status?: ApprovalStatus; result?: string }>(sb, req.path, req.body);
      setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { id, input: {}, result: null }), status: out.status ?? (action === "deny" ? "denied" : "done"), result: out.result ?? null } }));
      return out;
    },
    [sb, ws.id],
  );
  return { rows, decide };
}

const decided = (s: ApprovalStatus | undefined) => s !== undefined && s !== "pending";
const approvedish = (s: ApprovalStatus | undefined) => s === "done" || s === "approved" || s === "running";

// ─────────────── social posts ───────────────

/** A post as its network shows it, in CSS. The words can be edited in place. */
function PostFrame({ post, brand, text, onText, editable }: { post: PostItem; brand: string; text: string; onText: (t: string) => void; editable: boolean }) {
  const n: Network = post.network;
  const initial = (brand.trim()[0] ?? "B").toUpperCase();
  const handle = brand.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 15) || "business";
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [text]);
  const words = (
    <textarea
      ref={ref}
      className="pf-text"
      aria-label={`${NETWORK_NAME[n]} post text`}
      value={text}
      readOnly={!editable}
      // A first guess at the height, before the effect above measures it.
      rows={Math.min(30, Math.max(2, text.split("\n").length + Math.floor(text.length / 70)))}
      maxLength={NETWORK_LIMIT[n]}
      spellCheck
      onChange={(e) => onText(e.target.value)}
    />
  );
  const image = post.image_text ? <div className={`pf-img ${n}`}>{post.image_text}</div> : null;
  const head = (
    <div className="pf-head">
      <span className={`pf-av ${n}`} aria-hidden>
        {initial}
      </span>
      <span className="min-w-0">
        <b className="wrap">{brand}</b>
        <small>{n === "x" ? `@${handle}${post.when ? ` · ${post.when}` : ""}` : `${post.when ?? "Draft"}${n === "linkedin" ? " · scheduled" : ""}`}</small>
      </span>
    </div>
  );
  const foot: Record<Network, string[]> = { linkedin: ["Like", "Comment", "Repost", "Send"], facebook: ["Like", "Comment", "Share"], instagram: ["Like", "Comment", "Share", "Save"], x: ["Reply", "Repost", "Like", "Views"] };
  return (
    <div className={`pframe ${n}`}>
      {head}
      {n === "instagram" ? (
        <>
          <div className="pf-img instagram sq">{post.image_text ?? brand}</div>
          <div className="pf-foot" aria-hidden>
            {foot[n].map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          <div className="pf-cap">
            <b>{handle}</b>
            {words}
          </div>
        </>
      ) : (
        <>
          {words}
          {image}
          <div className="pf-foot" aria-hidden>
            {foot[n].map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </>
      )}
      {n === "x" ? <small className={`pf-count${text.length > NETWORK_LIMIT.x ? " over" : ""}`}>{text.length} / {NETWORK_LIMIT.x}</small> : null}
    </div>
  );
}

function PostPreview({ card }: { card: PostPreviewCard }) {
  const env = useEnv();
  const editor = can(env.ws.role, "approve");
  const ids = card.posts.map((p) => p.approval_id).filter((x): x is number => x !== null);
  const { rows, decide } = useApprovalRows(ids);
  const [texts, setTexts] = useState<string[]>(() => card.posts.map((p) => p.text));
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const brand = card.brand || env.ws.name;
  const statusOf = (p: PostItem) => (p.approval_id === null ? undefined : rows[p.approval_id]?.status);
  // The first post still waiting, unless the person moved on with Skip or Approve.
  const firstOpen = card.posts.findIndex((p) => p.approval_id !== null && !decided(statusOf(p)));
  const i = at ?? (firstOpen >= 0 ? firstOpen : 0);
  const post = card.posts[i];
  const loaded = ids.every((id) => rows[id]);
  const allDone = ids.length > 0 && loaded && card.posts.every((p) => p.approval_id === null || decided(statusOf(p)));
  const approved = card.posts.filter((p) => approvedish(statusOf(p))).length;

  const act = async (action: "approve" | "deny") => {
    if (!post.approval_id) return;
    setBusy(true);
    setError("");
    try {
      const ap = rows[post.approval_id];
      const edited = texts[i] !== card.posts[i].text;
      const out = await decide(post.approval_id, action, action === "approve" && edited ? postInputWith(ap?.input ?? {}, post.index, texts[i]) : null);
      if (out.status === "failed") setError(`It didn't work. ${out.result ?? ""}`.trim());
      const next = card.posts.findIndex((p, j) => j > i && p.approval_id !== null && !decided(statusOf(p)));
      setAt(next >= 0 ? next : null);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };

  if (allDone)
    return (
      <Done>
        {approved} of {card.posts.length} post{card.posts.length === 1 ? "" : "s"} approved{approved ? " and scheduled" : ""}
      </Done>
    );
  const st = statusOf(post);
  return (
    <Shell
      title={`${card.posts.length > 1 ? `Post ${i + 1} of ${card.posts.length}` : "Post"} · ${NETWORK_NAME[post.network]}`}
      note={post.when ?? undefined}
      label={`${NETWORK_NAME[post.network]} post preview`}
    >
      <PostFrame post={post} brand={brand} text={texts[i]} editable={editor && st === "pending" && !busy} onText={(t) => setTexts((xs) => xs.map((x, j) => (j === i ? t : x)))} />
      {post.approval_id === null ? (
        <p className="acard-hint">Preview only.</p>
      ) : st && st !== "pending" ? (
        <p className="acard-hint">{STATUS_LABEL[st]}</p>
      ) : editor ? (
        <div className="acard-b">
          <button type="button" className="btn primary sm" disabled={busy || !st || texts[i].trim() === ""} onClick={() => act("approve")}>
            {busy ? "Working..." : "Approve"}
          </button>
          <button type="button" className="btn sm" disabled={busy || !st} onClick={() => act("deny")}>
            Skip
          </button>
          {card.posts.length > 1 ? (
            <span className="apager">
              <button type="button" className="icon-btn" aria-label="Previous post" disabled={i === 0} onClick={() => setAt(i - 1)}>
                <Icon name="back" small />
              </button>
              <button type="button" className="icon-btn" aria-label="Next post" disabled={i === card.posts.length - 1} onClick={() => setAt(i + 1)}>
                <Icon name="next" small />
              </button>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="acard-hint">An editor, admin or the owner can approve this.</p>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Shell>
  );
}

// ─────────────── email ───────────────

function EmailPreview({ card }: { card: EmailPreviewCard }) {
  const env = useEnv();
  const editor = can(env.ws.role, "approve");
  const { rows, decide } = useApprovalRows(card.approval_id ? [card.approval_id] : []);
  const [mail, setMail] = useState({ to: card.to, subject: card.subject, body: card.body });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const row = card.approval_id ? rows[card.approval_id] : undefined;
  const open = editor && row?.status === "pending" && !busy;
  const act = async (action: "approve" | "deny") => {
    if (!card.approval_id) return;
    setBusy(true);
    setError("");
    try {
      const edited = mail.to !== card.to || mail.subject !== card.subject || mail.body !== card.body;
      const out = await decide(card.approval_id, action, action === "approve" && edited ? emailInputWith(row?.input ?? {}, mail) : null);
      if (out.status === "failed") setError(`It didn't work. ${out.result ?? ""}`.trim());
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  if (row && approvedish(row.status)) return <Done>Email approved: {card.subject}</Done>;
  return (
    <Shell title={card.title ?? "Email"} note={card.note ?? (row && row.status !== "pending" ? STATUS_LABEL[row.status] : undefined)}>
      <div className="amail">
        <label>
          <span>To</span>
          <input className="inp" value={mail.to} readOnly={!open} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
        </label>
        <label>
          <span>Subject</span>
          <input className="inp" value={mail.subject} readOnly={!open} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
        </label>
        <label>
          <span className="sr">Email text</span>
          <textarea className="ta" rows={Math.min(14, Math.max(4, mail.body.split("\n").length + 1))} value={mail.body} readOnly={!open} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
        </label>
      </div>
      {card.approval_id === null ? (
        <p className="acard-hint">Preview only.</p>
      ) : open ? (
        <div className="acard-b">
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => act("approve")}>
            {busy ? "Working..." : "Approve and send"}
          </button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => act("deny")}>
            Skip
          </button>
        </div>
      ) : row?.status === "pending" && !editor ? (
        <p className="acard-hint">An editor, admin or the owner can approve this.</p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Shell>
  );
}

// ─────────────── goals ───────────────

/** A number or a date with − and + on either side. */
function Stepper({ label, value, onLess, onMore, lessOff, moreOff, wide }: { label: string; value: string; onLess: () => void; onMore: () => void; lessOff?: boolean; moreOff?: boolean; wide?: boolean }) {
  return (
    <span className="astep" role="group" aria-label={label}>
      <button type="button" aria-label={`Less: ${label}`} disabled={lessOff} onClick={onLess}>
        −
      </button>
      <b className={wide ? "wide" : undefined} aria-live="polite">
        {value}
      </b>
      <button type="button" aria-label={`More: ${label}`} disabled={moreOff} onClick={onMore}>
        +
      </button>
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function GoalView({ card, answered }: { card: GoalCard; answered: boolean }) {
  const env = useEnv();
  const editor = can(env.ws.role, "chat");
  const [target, setTarget] = useState(card.target);
  const [due, setDue] = useState(card.due);
  const [row, setRow] = useState<GoalRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { sb, ws, goalTick } = env;
  useEffect(() => {
    let live = true;
    sb.from("goals")
      .select(GOAL_COLUMNS)
      .eq("workspace_id", ws.id)
      .eq("card_id", card.id)
      .maybeSingle()
      .then(({ data }) => live && data && setRow(goalOf(data as Record<string, unknown>)));
    return () => {
      live = false;
    };
  }, [sb, ws.id, card.id, goalTick]);
  const locked = Boolean(row) || answered || !editor || busy;
  const start = async () => {
    if (locked || !env.threadId) return;
    setBusy(true);
    setError("");
    const { error: e } = await sb.from("goals").insert(goalInsert({ workspaceId: ws.id, threadId: env.threadId, card, target, due }));
    if (e && e.code !== "23505") {
      setError(startError(e, "goal"));
      setBusy(false);
      return;
    }
    setBusy(false);
    env.onGoal();
    env.reply(goalStartText({ lead: card.lead, target, unit: card.unit, due }), card.agent);
  };
  const shown = row ? { target: row.target, due: row.due_date } : { target, due };
  return (
    <Shell title={card.title ?? "Goal"} note={locked ? (row ? "Started" : undefined) : (card.note ?? "Change the number or the date")}>
      <div className="agoal">
        <span>{card.lead}</span>
        {locked ? (
          <b>{numLabel(shown.target)}</b>
        ) : (
          <Stepper label={card.unit} value={numLabel(target)} lessOff={target - card.step < card.step} onLess={() => setTarget((t) => Math.max(card.step, Math.round((t - card.step) * 100) / 100))} onMore={() => setTarget((t) => Math.round((t + card.step) * 100) / 100)} />
        )}
        <span>{card.unit} by</span>
        {locked ? (
          <b>{dayLabel(shown.due)}</b>
        ) : (
          <Stepper
            label="Due date"
            wide
            value={dayLabel(due)}
            lessOff={shiftMonths(due, -1) <= today()}
            moreOff={shiftMonths(due, 1) > plusDays(730)}
            onLess={() => setDue((d) => shiftMonths(d, -1))}
            onMore={() => setDue((d) => shiftMonths(d, 1))}
          />
        )}
      </div>
      {locked ? null : (
        <div className="acard-b">
          <button type="button" className="btn primary sm" disabled={busy || env.busy} onClick={start}>
            {busy ? "Starting..." : "Start"}
          </button>
        </div>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Shell>
  );
}

/** A step's mark: an empty ring, a turning ring while it runs, a green tick when done. */
const StepMark = ({ status }: { status: StepStatus }) => (
  <span className={`amark ${status}`} aria-hidden>
    {status === "done" ? <Icon name="tick" small /> : null}
  </span>
);
const STEP_WORDS: Record<StepStatus, string> = { todo: "To do", running: "Running", done: "Done" };

function PlanView({ card, answered }: { card: PlanCard; answered: boolean }) {
  const env = useEnv();
  const editor = can(env.ws.role, "chat");
  const [kept, setKept] = useState<boolean[]>(() => card.steps.map(() => true));
  const [rows, setRows] = useState<StepRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { sb, ws } = env;
  const [loadTick, setLoadTick] = useState(0);
  useEffect(() => {
    let live = true;
    sb.from("goal_steps")
      .select(STEP_COLUMNS)
      .eq("workspace_id", ws.id)
      .eq("plan_id", card.id)
      .order("position")
      .then(({ data, error: e }) => live && !e && setRows((data ?? []) as StepRow[]));
    return () => {
      live = false;
    };
  }, [sb, ws.id, card.id, loadTick]);
  const started = Boolean(rows?.length);
  const live = env.steps[card.id] ?? {};
  const locked = started || answered || !editor || busy;
  const go = async () => {
    if (locked || !env.threadId) return;
    const steps = card.steps.filter((_, i) => kept[i]);
    if (!steps.length) return;
    setBusy(true);
    setError("");
    const goal = await sb.from("goals").select("id").eq("workspace_id", ws.id).eq("thread_id", env.threadId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const goalId = (goal.data as { id?: string } | null)?.id ?? null;
    const { error: e } = await sb
      .from("goal_steps")
      .insert(stepInserts({ workspaceId: ws.id, threadId: env.threadId, goalId, planId: card.id, steps }));
    if (e && e.code !== "23505") {
      setError(startError(e, "plan"));
      setBusy(false);
      return;
    }
    setBusy(false);
    setLoadTick((n) => n + 1);
    env.reply(planGoText(steps), card.agent);
  };
  const list = started
    ? rows!.map((r) => ({ key: r.id, title: r.title, agent: r.agent, note: card.steps.find((s) => s.title === r.title)?.note ?? null, status: live[r.position] ?? r.status, i: -1 }))
    : card.steps.map((s, i) => ({ key: String(i), title: s.title, agent: s.agent, note: s.note, status: "todo" as StepStatus, i })).filter((s) => kept[s.i]);
  return (
    <Shell title={card.title ?? "Plan"} note={`${list.length} step${list.length === 1 ? "" : "s"}`}>
      <ol className="asteps">
        {list.map((s) => (
          <li key={s.key} className={`astp ${s.status}`}>
            <StepMark status={s.status} />
            <span className="min-w-0 flex-1">
              <b className="wrap">{s.title}</b>
              <small>
                {AGENTS[s.agent].god}
                {s.note ? ` · ${s.note}` : ""}
                <span className="sr">. {STEP_WORDS[s.status]}</span>
              </small>
            </span>
            {!locked && list.length > 1 ? (
              <button type="button" className="icon-btn" aria-label={`Remove step: ${s.title}`} onClick={() => setKept((k) => k.map((x, j) => (j === s.i ? false : x)))}>
                <Icon name="close" small />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {locked ? null : (
        <div className="acard-b">
          <button type="button" className="btn primary sm" disabled={busy || env.busy} onClick={go}>
            {busy ? "Starting..." : card.go}
          </button>
        </div>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Shell>
  );
}

const STATUS_TONE: Record<GoalStatus, string> = { on_track: "green", needs_you: "clay", done: "green" };

function Meter({ current, target }: { current: number; target: number }) {
  return (
    <div className="ameter" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.max(0, current)} aria-label="Progress">
      <i style={{ width: `${meterPercent(current, target)}%` }} />
    </div>
  );
}

/** Where the goal stands: the number, a meter, and a chart of the way so far with the expected path dashed. */
function ProgressView({ card }: { card: ProgressCard }) {
  const B = CHART_BOX;
  const start = Date.parse(`${card.start}T00:00:00Z`);
  const end = Date.parse(`${card.due}T00:00:00Z`);
  const span = Math.max(1, end - start);
  const range = chartRange([card.target, ...card.points.map((p) => p.value)]);
  const iw = B.w - B.left - B.right;
  const ih = B.h - B.top - B.bottom;
  const x = (day: string) => B.left + Math.min(1, Math.max(0, (Date.parse(`${day}T00:00:00Z`) - start) / span)) * iw;
  const y = (v: number) => B.top + ih - ((v - range.min) / (range.max - range.min)) * ih;
  const pts = [{ at: card.start, value: 0 }, ...card.points.filter((p) => p.at >= card.start)];
  const last = pts[pts.length - 1];
  return (
    <Shell title={card.title ?? "Progress"} note={<span className={`tag ${STATUS_TONE[card.status]}`}>{GOAL_STATUS_LABEL[card.status]}</span>}>
      <div className="aprog">
        <span>
          <b>{numLabel(Math.max(0, card.current))}</b> of {numLabel(card.target)} {card.unit}
        </span>
        <span>by {dayLabel(card.due)}</span>
      </div>
      <Meter current={card.current} target={card.target} />
      <svg className="achart" viewBox={`0 0 ${B.w} ${B.h}`} role="img" aria-label={`${meterText(card.current, card.target, card.unit)}. Expected to reach ${numLabel(card.target)} by ${dayLabel(card.due)}.`}>
        <line x1={B.left} x2={B.w - B.right} y1={y(0)} y2={y(0)} className="ax" />
        <line x1={B.left} x2={B.w - B.right} y1={y(card.target)} y2={y(card.target)} className="grid" />
        <text x={B.left - 6} y={y(card.target) + 4} textAnchor="end">
          {numLabel(card.target)}
        </text>
        <text x={B.left - 6} y={y(0) + 4} textAnchor="end">
          0
        </text>
        <line x1={x(card.start)} y1={y(0)} x2={x(card.due)} y2={y(card.target)} className="line dash" />
        <polyline points={pts.map((p) => `${x(p.at)},${y(p.value)}`).join(" ")} className="line" />
        <circle cx={x(last.at)} cy={y(last.value)} r={4.5} className="dot" />
        <text x={B.left} y={B.h - 6}>
          {dayLabel(card.start)}
        </text>
        <text x={B.w - B.right} y={B.h - 6} textAnchor="end">
          {dayLabel(card.due)}
        </text>
      </svg>
    </Shell>
  );
}

// ─────────────── the goal pinned at the top of its chat ───────────────

/** The chat's newest goal, read again when `tick` goes up. */
function useThreadGoal(sb: SupabaseClient, ws: string, threadId: string | null, tick: number) {
  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    Promise.all([
      sb.from("goals").select(GOAL_COLUMNS).eq("workspace_id", ws).eq("thread_id", threadId).neq("status", "stopped").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("thread_id", threadId).eq("status", "pending"),
    ]).then(([g, a]) => {
      if (!live) return;
      setGoal(g.error || !g.data ? null : goalOf(g.data as Record<string, unknown>));
      setPending(a.error ? 0 : (a.count ?? 0));
    });
    return () => {
      live = false;
    };
  }, [sb, ws, threadId, tick]);
  return { goal, pending };
}

export function GoalPin({ sb, ws, threadId, tick, style }: { sb: SupabaseClient; ws: string; threadId: string | null; tick: number; style?: React.CSSProperties }) {
  const { goal, pending } = useThreadGoal(sb, ws, threadId, tick);
  if (!goal) return null;
  const status = goalStatus(goal, { pending });
  return (
    <div className="agpin" style={style} role="status" aria-label="This chat's goal">
      <div className="agpin-c">
        <b className="wrap">{goalSentence({ lead: goal.title, target: goal.target, unit: goal.unit, due: goal.due_date })}</b>
        <Meter current={goal.current} target={goal.target} />
        <small>{meterText(goal.current, goal.target, goal.unit)}</small>
        <span className={`tag ${STATUS_TONE[status]}`}>{GOAL_STATUS_LABEL[status]}</span>
      </div>
    </div>
  );
}

// ─────────────── the Goals list in the sidebar ───────────────

/** The workspace's goals under the nav, each with where it stands. Opens the goal's chat. */
export function GoalsNav({ sb, ws, reloadKey, current }: { sb: SupabaseClient; ws: string; reloadKey: string; current: string | null }) {
  const [list, setList] = useState<{ goal: GoalRow; status: GoalStatus }[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([
      sb.from("goals").select(GOAL_COLUMNS).eq("workspace_id", ws).in("status", ["active", "done"]).order("created_at", { ascending: false }).limit(8),
      sb.from("approvals").select("thread_id").eq("workspace_id", ws).eq("status", "pending").limit(200),
    ]).then(([g, a]) => {
      if (!live || g.error) return;
      const waiting = new Map<string, number>();
      for (const r of (a.data ?? []) as { thread_id: string | null }[]) if (r.thread_id) waiting.set(r.thread_id, (waiting.get(r.thread_id) ?? 0) + 1);
      const goals = ((g.data ?? []) as Record<string, unknown>[]).map(goalOf);
      setList(goals.map((goal) => ({ goal, status: goalStatus(goal, { pending: waiting.get(goal.thread_id) ?? 0 }) })));
    });
    return () => {
      live = false;
    };
  }, [sb, ws, reloadKey]);
  if (!list.length) return null;
  return (
    <div className="grp">
      <h6>Goals</h6>
      {list.map(({ goal, status }) => (
        <a
          key={goal.id}
          className={`rc agoal-nav${current === goal.thread_id ? " on" : ""}`}
          href={`/chat/${goal.thread_id}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate(`/chat/${goal.thread_id}`);
          }}
        >
          <span>
            {goal.title} {numLabel(goal.target)} {goal.unit}
          </span>
          <small className={`gst ${status}`}>{GOAL_STATUS_LABEL[status]}</small>
        </a>
      ))}
    </div>
  );
}
