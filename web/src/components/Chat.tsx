"use client";

// Talking to the team: the message box, a chat thread that streams replies, and how a reply looks.
// Ported from the old app's chat (app/public/app.js runChat, renderStored, the @ menu and the model picker), with its
// classes (.composer, .msgs, .msg, .dock). Chats are read straight from Supabase as the signed-in person, so row
// level security decides what they see. Sending goes through POST /api/chat, which streams NDJSON (src/lib/chat.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, StoredMessage } from "@/lib/agentLoop";
import { readLines } from "@/lib/chat";
import { IDLE, LIVE_WORDS, started as startLive, step, type Live } from "@/lib/liveReply";
import { answerTheme, BRAND_COLUMNS, DEFAULT_THEME, type AnswerTheme, type BrandRow } from "@/lib/brand";
import { hideNames, storedCards, type Card } from "@/lib/cards";
import { CHECKIN_LABEL } from "@/lib/goals";
import { parseMarkdown, partialMarkdown, type Block, type Inline, type List, type Table } from "@/lib/markdown";
import { MODEL_CHOICES, type ModelChoice } from "@/lib/models";
import { PLANS, type PaidPlan } from "@/lib/plans";
import { usedNote } from "@/lib/progress";
import { quickRoute } from "@/lib/router";
import { insertSkill, matchSkills, menuAgent, skillsFor, slashQuery, type SkillRow } from "@/lib/skills";
import { agentFace, AGENTS, agentByGod, insertMention, isAgentKey, LEAD, mentionMatches, mentionQuery, workingAgents, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { ApprovalCard } from "./Approvals";
import { AnswerCards, CardsProvider, GoalPin, type CardsEnv } from "./Cards";
import { Icon } from "./icons";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { ErrorText, Notice, to } from "./ui";

type Item =
  /** page: what the person attached from the Chrome extension (meta.page), shown as a link under their words. */
  | { kind: "user"; text: string; page?: { url: string; title: string } | null }
  /** stopped: the person pressed Stop while it was written. used: the tools it used, for the "Used: ..." note. cards: answer cards under it. */
  | { kind: "agent"; agent: AgentKey; text: string; error?: boolean; blocked?: string; stopped?: boolean; used?: string[]; cards?: Card[] }
  | { kind: "note"; agent: AgentKey; text: string; full?: boolean }
  | { kind: "tool"; agent: AgentKey; text: string }
  | { kind: "approval"; id: number; title: string };

type MessageRow = { id: number; role: "user" | "agent" | "note"; agent: string | null; content: string; meta: Record<string, unknown> | null };

/** A teammate's round face. */
export function Face({ agent, size = 32, className = "" }: { agent: AgentKey; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={agentFace(agent)} alt="" width={size} height={size} className={`av ${className}`} style={{ width: size, height: size }} />;
}

/** The person's words, with tagged teammates marked. */
export function WithTags({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@\w+)/g).map((part, i) =>
        part.startsWith("@") && agentByGod(part.slice(1)) ? (
          <span key={i} className="mention">
            @{AGENTS[agentByGod(part.slice(1))!].god}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "bold" ? (
          // A bold number ("**1,240**", "**+18%**") takes the accent color.
          <b key={i} className={/\d/.test(p.text) ? "n" : undefined}>
            {p.text}
          </b>
        ) : p.kind === "italic" ? (
          <em key={i}>{p.text}</em>
        ) : p.kind === "code" ? (
          <code key={i}>{p.text}</code>
        ) : p.kind === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function ListView({ list }: { list: List }) {
  const items = list.items.map((it, j) => (
    <li key={j}>
      <Inlines parts={it.parts} />
      {it.sub ? <ListView list={it.sub} /> : null}
    </li>
  ));
  return list.kind === "ul" ? <ul>{items}</ul> : <ol start={list.start}>{items}</ol>;
}

const ALIGN = { left: undefined, center: "al-c", right: "al-r" } as const;

/** A table in its own box, which scrolls sideways on a phone instead of making the page wider. */
function TableView({ t }: { t: Table }) {
  const cls = (i: number) => [ALIGN[t.align[i]], t.numeric[i] ? "num" : ""].filter(Boolean).join(" ") || undefined;
  return (
    // A table wider than the chat scrolls, so it takes focus to scroll with the keyboard.
    <div className="md-table" role="region" aria-label="Table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {t.head.map((h, i) => (
              <th key={i} scope="col" className={cls(i)}>
                <Inlines parts={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, j) => (
            <tr key={j}>
              {r.map((c, i) => (
                <td key={i} className={cls(i)}>
                  <Inlines parts={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case "p":
      return (
        <p>
          {b.lines.map((l, j) => (
            <Fragment key={j}>
              {j ? <br /> : null}
              <Inlines parts={l} />
            </Fragment>
          ))}
        </p>
      );
    case "h": {
      const H = (`h${b.level}` as "h2" | "h3" | "h4");
      return (
        <H>
          <Inlines parts={b.parts} />
        </H>
      );
    }
    case "ul":
    case "ol":
      return <ListView list={b} />;
    case "quote":
      return (
        <blockquote>
          {b.blocks.map((x, i) => (
            <BlockView key={i} b={x} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr />;
    case "code":
      return (
        <pre>
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return <TableView t={b} />;
  }
}

/**
 * A reply: paragraphs, headings, lists, quotes, rules, code and tables, with bold, italic, code and links. Built from
 * data (src/lib/markdown.ts), never HTML. Its colors and heading font come from the CSS variables around it
 * (useAnswerTheme), or the Morning Telos look. `writing`: the reply is still coming, so a soft cursor follows it
 * (pass the text through partialMarkdown first).
 */
export function Markdown({ text, writing }: { text: string; writing?: boolean }) {
  return (
    <div className={writing ? "md writing" : "md"}>
      {parseMarkdown(text).map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}

/**
 * How answers look in this workspace: its brand (supabase/021_brand.sql) when "Use my brand in answers" is on, or
 * the Morning Telos look. Read as the signed-in person, so row level security decides. No brand, or a table that
 * isn't there yet, is the default.
 */
export function useAnswerTheme(sb: SupabaseClient, workspaceId: string): AnswerTheme {
  const [theme, setTheme] = useState<AnswerTheme>(DEFAULT_THEME);
  useEffect(() => {
    let live = true;
    sb.from("brand_kits")
      .select(BRAND_COLUMNS)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (live) setTheme(error ? DEFAULT_THEME : answerTheme(data as BrandRow | null));
      });
    return () => {
      live = false;
    };
  }, [sb, workspaceId]);
  return theme;
}

/** The brand's heading font, from Google Fonts only (answerTheme checks the name). React puts the link in the head once. */
export function ThemeFont({ theme }: { theme: AnswerTheme }) {
  return theme.fontHref ? <link rel="stylesheet" href={theme.fontHref} precedence="brand" /> : null;
}

// ─────────────── the message box ───────────────

const MODEL_INFO: Record<ModelChoice, [string, string, string]> = {
  auto: ["Auto", "Opus 5.5 for everything", "Best"],
  opus: ["Opus 5.5", "Smartest, for plans and research", "Slower"],
  sonnet: ["Sonnet 5.5", "Great writing, quicker", "Fast"],
  haiku: ["Haiku 5.5", "Short tasks and quick answers", "Fastest"],
};

/** The model chip under the Home box, and its menu. */
function ModelPicker({ value, onChange }: { value: ModelChoice; onChange: (m: ModelChoice) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <span ref={box} className="mp-wrap">
      <button type="button" className="tool-b" aria-haspopup="listbox" aria-expanded={open} aria-label={`AI model: ${MODEL_INFO[value][0]}`} onClick={() => setOpen(!open)}>
        <span>{MODEL_INFO[value][0]}</span>
        <Icon name="down" small />
      </button>
      <div className={`mp${open ? " on" : ""}`} role="listbox" aria-label="Choose your AI model">
        <h5>Choose your AI model</h5>
        {MODEL_CHOICES.map((m, i) => (
          <Fragment key={m}>
            {i === 1 ? <h6>Claude</h6> : null}
            <button
              type="button"
              role="option"
              aria-selected={value === m}
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
            >
              <span className="mi">{i ? "✳" : "✦"}</span>
              <span>
                <b>{MODEL_INFO[m][0]}</b>
                <br />
                <small>{MODEL_INFO[m][1]}</small>
              </span>
              <span className="rt">
                {MODEL_INFO[m][2]}
                {value === m ? " ✓" : ""}
              </span>
            </button>
          </Fragment>
        ))}
      </div>
    </span>
  );
}

/**
 * A message box like the current app's: one rounded box, @ Tag (and the model on Home) at the bottom left and a round
 * send button. Typing @ opens a menu of teammates, and / a menu of the tagged teammate's skills (Athena's, or
 * `agent`'s, when nobody is tagged). Enter sends and Shift+Enter starts a new line.
 */
export function Composer({
  id = "composer",
  value,
  onChange,
  onSend,
  disabled,
  busy,
  placeholder,
  autoFocus,
  skills = [],
  agent = LEAD,
  down,
  rows = 1,
  model,
  onModel,
  onStop,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  /** The workspace's own skills. The System skills are always there. */
  skills?: SkillRow[];
  /** Whose skills / shows when the message tags nobody. */
  agent?: AgentKey;
  /** Menus open below the box (Home), not above it. */
  down?: boolean;
  rows?: number;
  model?: ModelChoice;
  onModel?: (m: ModelChoice) => void;
  /** While busy, Stop takes Send's place and calls this. */
  onStop?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ kind: "mention" | "skill"; q: string } | null>(null);
  const [pick, setPick] = useState(0);
  const skillAgent = menuAgent(value, agent);
  const people = query?.kind === "mention" ? mentionMatches(query.q) : [];
  const found = query?.kind === "skill" ? matchSkills(skillsFor(skillAgent, skills), query.q).slice(0, 8) : [];
  const count = people.length || found.length;
  const open = count > 0;

  // Grow with the text, up to a limit, like the current app.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [value]);

  const look = (ta: HTMLTextAreaElement) => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = mentionQuery(before);
    const k = m === null ? slashQuery(before) : null;
    setQuery(m !== null ? { kind: "mention", q: m } : k !== null ? { kind: "skill", q: k } : null);
    setPick(0);
  };
  const place = (next: { text: string; cursor: number }) => {
    const ta = ref.current;
    onChange(next.text);
    setQuery(null);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const choose = (k: AgentKey) => {
    const ta = ref.current;
    if (ta) place(insertMention(ta.value, ta.selectionStart, k));
  };
  const chooseSkill = (name: string) => {
    const ta = ref.current;
    if (ta) place(insertSkill(ta.value, ta.selectionStart, name));
  };
  const chooseAt = (i: number) => {
    if (people.length) choose(people[Math.min(i, people.length - 1)]);
    else if (found.length) chooseSkill(found[Math.min(i, found.length - 1)].name);
  };
  const send = () => {
    const t = value.trim();
    if (!t || disabled || busy) return;
    onSend(t);
    setQuery(null);
  };
  const tag = () => {
    const v = value && !value.endsWith(" ") ? `${value} @` : `${value}@`;
    onChange(v);
    setQuery({ kind: "mention", q: "" });
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(v.length, v.length);
    });
  };

  return (
    <form
      className={`composer${down ? " down" : ""}${disabled ? " off" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {open && people.length ? (
        <div role="listbox" aria-label="AI team" className="mpop on">
          <h5>AI team</h5>
          {people.map((k, i) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={i === pick ? "on" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(k);
              }}
            >
              <Face agent={k} size={28} />
              <span>
                <b>{AGENTS[k].god}</b>
                <small>
                  {AGENTS[k].name}
                  {AGENTS[k].soon ? ". Coming soon" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {open && found.length ? (
        <div role="listbox" aria-label={`${AGENTS[skillAgent].god}'s skills`} className="mpop on wide">
          <h5>{AGENTS[skillAgent].god}&apos;s skills</h5>
          {found.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={i === pick ? "on" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                chooseSkill(x.name);
              }}
            >
              <span className="min-w-0">
                <b>/{x.name}</b>
                <small className="wrap">{x.description.split(". ")[0].replace(/\.$/, "")}.</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="sr" htmlFor={id}>
        Message your team
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target);
        }}
        onClick={(e) => look(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setPick((p) => (p + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              chooseAt(pick);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="ctools">
        <button type="button" className="tool-b" onClick={tag} disabled={disabled}>
          <span className="at">@</span>Tag
        </button>
        {model && onModel ? <ModelPicker value={model} onChange={onModel} /> : null}
        {busy && onStop ? (
          <button type="button" className="send stop" aria-label="Stop" title="Stop" onClick={onStop}>
            <Icon name="stop" className="fill" />
          </button>
        ) : (
          <button type="submit" className="send" aria-label={busy ? "Working" : "Send"} disabled={disabled || busy}>
            {busy ? <span className="spin" aria-hidden /> : <Icon name="up" />}
          </button>
        )}
      </div>
    </form>
  );
}

/** The workspace's own skills, for the / menu. Empty until 014_routines_skills_memory.sql runs. */
export function useSkillRows(sb: SupabaseClient, workspaceId: string): SkillRow[] {
  const [rows, setRows] = useState<SkillRow[]>([]);
  useEffect(() => {
    let live = true;
    sb.from("skills")
      .select("id, agent, name, description, body")
      .eq("workspace_id", workspaceId)
      .then(({ data, error }) => {
        if (live && !error) setRows((data ?? []) as SkillRow[]);
      });
    return () => {
      live = false;
    };
  }, [sb, workspaceId]);
  return rows;
}

/** The first message of a new chat: typed on Home, or a routine started with Run now. */
export type StartChat = { text: string; routineId?: string; title?: string };

// ─────────────── a thread ───────────────

/** The approvals an agent's reply prepared (meta.approvals, saved by the agent loop), as cards under it. */
const approvalsIn = (meta: Record<string, unknown> | null): Item[] =>
  (Array.isArray(meta?.approvals) ? (meta.approvals as { id?: unknown; title?: unknown }[]) : [])
    .filter((a) => typeof a?.id === "number")
    .map((a) => ({ kind: "approval" as const, id: a.id as number, title: typeof a.title === "string" ? a.title : "A change" }));

const toItems = (m: MessageRow): Item[] => {
  const agent = isAgentKey(m.agent) ? m.agent : "chief";
  if (m.role === "user") {
    const p = m.meta?.page as { url?: unknown; title?: unknown } | undefined;
    const page = p && typeof p.url === "string" && /^https?:\/\//.test(p.url) ? { url: p.url, title: typeof p.title === "string" && p.title ? p.title : p.url } : null;
    return [{ kind: "user", text: m.content, page }];
  }
  // A note about an approval ("Approved and done: ...") is shown whole. A handoff note shows who handed it to whom.
  // A goal's Monday check-in shows one short line.
  if (m.role === "note" && m.meta?.checkin) return [{ kind: "note", agent, text: CHECKIN_LABEL, full: true }];
  if (m.role === "note") return [{ kind: "note", agent, text: m.content, full: m.meta?.approval !== undefined }];
  const used = Array.isArray(m.meta?.used) ? (m.meta.used as unknown[]).filter((u): u is string => typeof u === "string") : undefined;
  return [{ kind: "agent", agent, text: m.content, error: Boolean(m.meta?.error), blocked: typeof m.meta?.blocked === "string" ? m.meta.blocked : undefined, stopped: m.meta?.stopped === true, used, cards: storedCards(m.meta) }, ...approvalsIn(m.meta)];
};

/**
 * POST /api/chat and read its NDJSON stream. Calls onEvent for each line. Throws the route's error message.
 * Aborting `signal` (Stop) cancels the request; the server then stops the reply and saves what was written.
 */
async function streamChat(sb: SupabaseClient, body: Record<string, unknown>, onEvent: (e: ChatEvent) => void, signal: AbortSignal) {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  }).catch((e) => {
    if (signal.aborted) throw e;
    return null;
  });
  if (!res) throw new Error("Couldn't reach the server. Check your connection and try again.");
  if (!res.ok || !res.body) {
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(out.error || "Something went wrong. Try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = readLines(buffer);
    buffer = rest;
    events.forEach(onEvent);
  }
  readLines(`${buffer}\n`).events.forEach(onEvent);
}

/** The thread on screen as the router reads it, for the line shown before the server answers. */
const asHistory = (items: Item[]): StoredMessage[] =>
  items.flatMap((x): StoredMessage[] =>
    x.kind === "user" ? [{ role: "user", agent: null, content: x.text }] : x.kind === "agent" ? [{ role: "agent", agent: x.agent, content: x.text, meta: x.error || x.blocked ? { error: true } : null }] : [],
  );

/** Close enough to the bottom to count as reading the newest message. */
const NEAR_BOTTOM = 80;
const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_BOTTOM;

/** What send() can be told: a routine to start, a teammate to ask, or to answer the last message again. */
type SendOpts = { routine?: { id: string; title: string }; agent?: AgentKey; again?: boolean };

/** One chat. Loads its messages, sends new ones and shows replies as they are written. `start` is the first message of a new chat. */
export function ThreadPage({
  sb,
  ws,
  id,
  start,
  model,
  onStarted,
  onThread,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  id: string | null;
  start: StartChat | null;
  /** The model picked on Home. */
  model?: ModelChoice;
  onStarted: () => void;
  /** Tells the app which thread this page started, so the address can change to it without a new page. */
  onThread: (id: string) => void;
}) {
  const editor = can(ws.role, "chat");
  const [items, setItems] = useState<Item[]>([]);
  // The items as of the last render, for send() to read without waiting for a render.
  const itemsRef = useRef<Item[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [title, setTitle] = useState("");
  // The reply being written (src/lib/liveReply.ts). Deltas land in the ref and reach the screen once a frame.
  const [live, setLive] = useState<Live>(IDLE);
  const liveRef = useRef<Live>(IDLE);
  const frame = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const [jump, setJump] = useState(false);
  // The thread this page is showing. A new chat learns its id from the stream, and the address changes without a reload.
  const thread = useRef<string | null>(id);
  // The same, for drawing: the goal pinned at the top and the cards read it.
  const [threadId, setThreadId] = useState<string | null>(id);
  const stopper = useRef<AbortController | null>(null);
  const running = useRef<Promise<void> | null>(null);
  // Stay at the newest message while a reply is written, unless the person scrolls up to read.
  const pinned = useRef(true);
  const skills = useSkillRows(sb, ws.id);
  const theme = useAnswerTheme(sb, ws.id);
  // Answer cards that came on the stream for the reply being written, steps moved live, and goal changes.
  const [liveCards, setLiveCards] = useState<Card[]>([]);
  const [stepMoves, setStepMoves] = useState<CardsEnv["steps"]>({});
  const [goalTick, setGoalTick] = useState(0);
  // The / menu shows the skills of whoever answered last, when the reply tags nobody.
  const lastAgent = [...items].reverse().find((x): x is Extract<Item, { kind: "agent" }> => x.kind === "agent")?.agent ?? LEAD;
  const lastUser = [...items].reverse().find((x): x is Extract<Item, { kind: "user" }> => x.kind === "user")?.text ?? "";

  const show = useCallback((next: Live, now = false) => {
    liveRef.current = next;
    if (now) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setLive(next);
      return;
    }
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setLive(liveRef.current);
      });
  }, []);
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (atBottom()) pinned.current = true;
      else if (y < lastY) pinned.current = false;
      lastY = y;
      setJump(!pinned.current && !atBottom());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinned.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: busy ? "auto" : "smooth" });
    else setJump(true);
  }, [items, live, busy]);

  const toLatest = () => {
    pinned.current = true;
    setJump(false);
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  };

  // Load a thread opened from a link. Not one this page just started: its messages are already on screen.
  useEffect(() => {
    if (!id || (thread.current === id && items.length)) return;
    thread.current = id;
    let live = true;
    Promise.all([
      sb.from("threads").select("title").eq("id", id).eq("workspace_id", ws.id).maybeSingle(),
      sb.from("messages").select("id, role, agent, content, meta").eq("thread_id", id).eq("workspace_id", ws.id).order("id"),
    ]).then(([t, m]) => {
      if (!live) return;
      setLoading(false);
      if (t.error || m.error) return setError((t.error ?? m.error)!.message);
      if (!t.data) return setError("That chat was not found.");
      setTitle((t.data as { title: string }).title);
      setItems(((m.data ?? []) as MessageRow[]).flatMap(toItems));
    });
    return () => {
      live = false;
    };
    // Only a new address loads the thread again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, ws.id, id]);

  const send = useCallback(
    async (text: string, opts: SendOpts = {}) => {
      const { routine, agent, again } = opts;
      const ctrl = new AbortController();
      stopper.current = ctrl;
      setBusy(true);
      setError("");
      pinned.current = true;
      if (!again) {
        setDraft("");
        setItems((xs) => [...xs, { kind: "user", text }]);
      }
      if (!thread.current) setTitle(routine ? `Routine: ${routine.title}` : text.replace(/\s+/g, " ").trim());
      // The first feedback comes at once: who answers, when the screen can tell, or "Finding the right teammate".
      show(startLive(routine ? null : quickRoute(text, asHistory(itemsRef.current), workingAgents(), agent)), true);
      // Approval cards wait for the reply that prepared them, so they show under it, as they do after a reload.
      let waiting: Item[] = [];
      // Answer cards show under the reply being written, then move to the finished reply.
      let cardsNow: Card[] = [];
      setLiveCards([]);
      const body = {
        workspaceId: ws.id,
        threadId: thread.current,
        text,
        ...(model && model !== "auto" ? { model } : {}),
        ...(routine ? { routineId: routine.id } : {}),
        ...(agent ? { agent } : {}),
        ...(again ? { again: true } : {}),
      };
      const work = (async () => {
        try {
          await streamChat(
            sb,
            body,
            (e) => {
              if (e.type === "thread") {
                if (thread.current !== e.id) {
                  thread.current = e.id;
                  setThreadId(e.id);
                  onThread(e.id);
                  navigate(`/chat/${e.id}`, true);
                }
                return;
              }
              if (e.type === "approval") return void waiting.push({ kind: "approval", id: e.id, title: e.title });
              if (e.type === "card") {
                cardsNow = [...cardsNow, e.card];
                return setLiveCards(cardsNow);
              }
              if (e.type === "step") return setStepMoves((m) => ({ ...m, [e.plan]: { ...m[e.plan], [e.position]: e.status } }));
              if (e.type === "goal") return setGoalTick((n) => n + 1);
              if (e.type === "handoff") setItems((xs) => [...xs, { kind: "note", agent: e.from, text: `${AGENTS[e.from].god} handed this to ${AGENTS[e.to].god}: ${e.note}` }]);
              if (e.type === "message") {
                const used = e.used ?? liveRef.current.used;
                const cards = waiting;
                const answerCards = cardsNow;
                waiting = [];
                cardsNow = [];
                setLiveCards([]);
                setItems((xs) => [...xs, { kind: "agent", agent: e.agent, text: e.text, error: e.error, blocked: e.blocked, stopped: e.stopped, used, cards: answerCards }, ...cards]);
              }
              const next = step(liveRef.current, e);
              // A finished reply leaves the screen in the same frame its message arrives, so nothing shows twice.
              show(next, e.type === "message" || e.type === "handoff" || e.type === "route");
            },
            ctrl.signal,
          );
        } catch (err) {
          if (ctrl.signal.aborted) {
            // Stopped: what was written stays on screen, marked Stopped, as the server saves it.
            const now = liveRef.current;
            const answerCards = cardsNow;
            if (now.answering && (now.text.trim() || answerCards.length)) setItems((xs) => [...xs, { kind: "agent", agent: now.answering!, text: hideNames(now.text.trim()), stopped: true, used: now.used, cards: answerCards }]);
          } else setError(message(err));
        }
        if (waiting.length) setItems((xs) => [...xs, ...waiting]);
        setLiveCards([]);
        show(IDLE, true);
        if (stopper.current === ctrl) stopper.current = null;
        setBusy(false);
      })();
      running.current = work;
      await work;
    },
    [sb, ws.id, onThread, model, show],
  );

  const stop = useCallback(() => stopper.current?.abort(), []);
  /** Ask a teammate to answer the last message again: Retry (the same one) or Ask someone else. */
  const askAgain = useCallback(
    async (k: AgentKey) => {
      if (!lastUser) return;
      stopper.current?.abort();
      await running.current;
      send(lastUser, { agent: k, again: true });
    },
    [lastUser, send],
  );

  // A new chat from Home: send its first message once.
  const sentStart = useRef(false);
  useEffect(() => {
    if (id || !start || sentStart.current) return;
    sentStart.current = true;
    onStarted();
    send(start.text, start.routineId ? { routine: { id: start.routineId, title: start.title ?? "" } } : {});
  }, [id, start, onStarted, send]);

  const lastAnswer = busy ? -1 : items.reduce((at, x, i) => (x.kind === "agent" && !x.blocked ? i : at), -1);
  const canAgain = editor && Boolean(lastUser);
  // A card's answer is the person's next message after its reply. The last reply's cards are open until then.
  const answers = items.map((_, i) => {
    const next = items.slice(i + 1).find((x): x is Extract<Item, { kind: "user" }> => x.kind === "user");
    return next ? next.text : null;
  });
  const reply = useCallback((text: string, agent: AgentKey) => void send(text, { agent }), [send]);
  const onGoal = useCallback(() => setGoalTick((n) => n + 1), []);
  const cardsEnv: CardsEnv = { sb, ws, threadId, reply, busy, steps: stepMoves, goalTick, onGoal };

  return (
    <div className="thread">
      <div className="th-h">
        <a
          className="icon-btn"
          href={to("/")}
          aria-label="Back to Home"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Icon name="back" />
        </a>
        <h1>{title || (loading ? "" : "New chat")}</h1>
      </div>
      <ThemeFont theme={theme} />
      <GoalPin sb={sb} ws={ws.id} threadId={threadId} tick={goalTick + items.length} style={theme.vars as React.CSSProperties} />
      <CardsProvider value={cardsEnv}>
      <div className="msgs" aria-live="polite" aria-busy={busy} style={theme.vars as React.CSSProperties}>
        {loading ? <div className="step">Opening the chat...</div> : null}
        {!loading && !items.length && !busy && !error ? <div className="step">No messages yet.</div> : null}
        {items.map((it, i) => (
          <ItemView key={i} item={it} sb={sb} ws={ws} last={i === lastAnswer} canAgain={canAgain} onAgain={askAgain} answer={answers[i]} />
        ))}
        {live.answering && (live.text || liveCards.length) ? (
          <div className="msg">
            <Face agent={live.answering} />
            <div className="body">
              <div className="who">
                {AGENTS[live.answering].god} <span>· {AGENTS[live.answering].name}</span>
              </div>
              {live.text ? <Markdown text={partialMarkdown(hideNames(live.text))} writing /> : null}
              <AnswerCards cards={liveCards} answer={null} />
            </div>
          </div>
        ) : null}
        {busy && live.line ? (
          <div className="step live-line" role="status">
            <span className="spin" />
            <span className="wrap">{live.line}</span>
            {live.answering && canAgain ? <AskElse current={live.answering} onPick={askAgain} /> : null}
          </div>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
      </CardsProvider>
      <div className="dock">
        {jump ? (
          <button type="button" className="jump" onClick={toLatest}>
            <Icon name="down" small />
            {LIVE_WORDS.jump}
          </button>
        ) : null}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={(t) => send(t)}
          onStop={stop}
          busy={busy}
          disabled={!editor}
          placeholder={editor ? "Reply, or type @ to pull in a teammate, / for a skill" : "Viewers can read chats but can't send messages."}
          skills={skills}
          agent={lastAgent}
        />
      </div>
    </div>
  );
}

/** A small menu of the other teammates who can take work. Picking one asks them the same message. */
function AskElse({ current, onPick }: { current: AgentKey; onPick: (k: AgentKey) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="ask-else">
      <button type="button" className="act" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {LIVE_WORDS.askElse}
        <Icon name="down" small />
      </button>
      {open ? (
        <div className="ask-menu" role="menu" aria-label={LIVE_WORDS.askElse}>
          {workingAgents()
            .filter((k) => k !== current)
            .map((k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(k);
                }}
              >
                <Face agent={k} size={22} />
                <span>
                  <b>{AGENTS[k].god}</b>
                  <small>{AGENTS[k].name}</small>
                </span>
              </button>
            ))}
        </div>
      ) : null}
    </span>
  );
}

/** Copy an answer's words. Says Copied for a moment. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="act"
      aria-label={done ? LIVE_WORDS.copied : LIVE_WORDS.copy}
      title={done ? LIVE_WORDS.copied : LIVE_WORDS.copy}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => {},
        );
      }}
    >
      <Icon name={done ? "tick" : "copy"} small />
    </button>
  );
}

function ItemView({ item, sb, ws, last, canAgain, onAgain, answer = null }: { item: Item; sb: SupabaseClient; ws: Workspace; last?: boolean; canAgain?: boolean; onAgain?: (k: AgentKey) => void; answer?: string | null }) {
  if (item.kind === "approval") return <ApprovalCard sb={sb} ws={ws} id={item.id} title={item.title} />;
  if (item.kind === "user")
    return (
      <div className="msg me">
        <div className="bubble">
          <WithTags text={item.text} />
          {item.page ? (
            <small className="mt-1 block text-[12px] text-ink-4 wrap">
              From a page:{" "}
              <a className="link" href={item.page.url} target="_blank" rel="noopener noreferrer nofollow">
                {item.page.title}
              </a>
            </small>
          ) : null}
        </div>
      </div>
    );
  if (item.kind === "note" && !item.full)
    return (
      <div className="handoff">
        <Face agent={item.agent} size={18} />
        <span>{item.text.split(":")[0]}</span>
      </div>
    );
  if (item.kind === "note" || item.kind === "tool")
    return (
      <div className="step">
        <span className="dot2" />
        <span className="wrap">{item.text}</span>
      </div>
    );
  const a = AGENTS[item.agent];
  const used = usedNote(item.used ?? []);
  return (
    <div className={`msg${item.error ? " err" : ""}`}>
      <Face agent={item.agent} />
      <div className="body">
        <div className="who">
          {a.god} <span>· {a.name}</span>
        </div>
        {item.text ? <Markdown text={item.text} /> : null}
        {item.cards?.length ? <AnswerCards cards={item.cards} answer={answer} /> : null}
        {item.stopped || used ? (
          <div className="used">
            {item.stopped ? <span>{LIVE_WORDS.stopped}</span> : null}
            {used ? <span>{used}</span> : null}
          </div>
        ) : null}
        {item.blocked === "expired" || item.blocked === "allowance" ? <PickPlan sb={sb} ws={ws} /> : null}
        {!item.blocked && !item.error ? (
          <div className="acts">
            <CopyButton text={item.text} />
            {last && canAgain && onAgain ? (
              <>
                <button type="button" className="act" aria-label={LIVE_WORDS.retry} title={LIVE_WORDS.retry} onClick={() => onAgain(item.agent)}>
                  <Icon name="refresh" small />
                </button>
                <AskElse current={item.agent} onPick={onAgain} />
              </>
            ) : null}
          </div>
        ) : null}
        {item.error && last && canAgain && onAgain ? (
          <div className="acts">
            <button type="button" className="act" onClick={() => onAgain(item.agent)}>
              <Icon name="refresh" small />
              {LIVE_WORDS.retry}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Under a limit message: the owner picks a plan (Stripe Checkout); everyone else is told who can. */
export function PickPlan({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  if (ws.role !== "owner") return <p className="mt-2 text-[13.5px] text-ink-3">Ask the workspace owner to pick a plan.</p>;
  const choose = async (plan: PaidPlan) => {
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ url?: string; changed?: boolean }>(sb, "/api/billing/checkout", { workspaceId: ws.id, plan });
      if (out.url) return window.location.assign(out.url);
      if (out.changed) setDone(`You're on ${PLANS[plan].name} now. Send your message again.`);
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(["starter", "pro"] as const).map((p) => (
          <button key={p} type="button" className="btn sm" disabled={busy} onClick={() => choose(p)}>
            Upgrade to {PLANS[p].name}, ${PLANS[p].price} a month
          </button>
        ))}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? <Notice>{done}</Notice> : null}
    </div>
  );
}
