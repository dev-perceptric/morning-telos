"use client";

// Talking to the team: the message box, a chat thread that streams replies, and how a reply looks.
// Ported from the old app's chat (app/public/app.js runChat, renderStored, the @ menu and the model picker), with its
// classes (.composer, .msgs, .msg, .dock). Chats are read straight from Supabase as the signed-in person, so row
// level security decides what they see. Sending goes through POST /api/chat, which streams NDJSON (src/lib/chat.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/agentLoop";
import { readLines } from "@/lib/chat";
import { parseMarkdown, type Inline } from "@/lib/markdown";
import { MODEL_CHOICES, type ModelChoice } from "@/lib/models";
import { PLANS, type PaidPlan } from "@/lib/plans";
import { insertSkill, matchSkills, menuAgent, skillsFor, slashQuery, type SkillRow } from "@/lib/skills";
import { agentFace, AGENTS, agentByGod, insertMention, isAgentKey, LEAD, mentionMatches, mentionQuery, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { ApprovalCard } from "./Approvals";
import { Icon } from "./icons";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { ErrorText, Notice, to } from "./ui";

type Item =
  /** page: what the person attached from the Chrome extension (meta.page), shown as a link under their words. */
  | { kind: "user"; text: string; page?: { url: string; title: string } | null }
  | { kind: "agent"; agent: AgentKey; text: string; error?: boolean; blocked?: string }
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
          <b key={i}>{p.text}</b>
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

/** A reply: paragraphs, lists, headings, bold, code and links. Built from data (src/lib/markdown.ts), never HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                <Inlines parts={l} />
              </Fragment>
            ))}
          </p>
        ) : b.kind === "h" ? (
          <h4 key={i}>
            <Inlines parts={b.parts} />
          </h4>
        ) : b.kind === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines parts={it} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines parts={it} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
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
        <button type="submit" className="send" aria-label={busy ? "Working" : "Send"} disabled={disabled || busy}>
          {busy ? <span className="spin" aria-hidden /> : <Icon name="up" />}
        </button>
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
  if (m.role === "note") return [{ kind: "note", agent, text: m.content, full: m.meta?.approval !== undefined }];
  return [{ kind: "agent", agent, text: m.content, error: Boolean(m.meta?.error), blocked: typeof m.meta?.blocked === "string" ? m.meta.blocked : undefined }, ...approvalsIn(m.meta)];
};

/** POST /api/chat and read its NDJSON stream. Calls onEvent for each line. Throws the route's error message. */
async function streamChat(sb: SupabaseClient, body: Record<string, unknown>, onEvent: (e: ChatEvent) => void) {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).catch(() => null);
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

/** One chat. Loads its messages, sends new ones and shows replies as they arrive. `start` is the first message of a new chat. */
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
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<{ agent: AgentKey; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  // The thread this page is showing. A new chat learns its id from the stream, and the address changes without a reload.
  const thread = useRef<string | null>(id);
  const bottom = useRef<HTMLDivElement>(null);
  const skills = useSkillRows(sb, ws.id);
  // The / menu shows the skills of whoever answered last, when the reply tags nobody.
  const lastAgent = [...items].reverse().find((x): x is Extract<Item, { kind: "agent" }> => x.kind === "agent")?.agent ?? LEAD;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items, status]);

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
    async (text: string, routine?: { id: string; title: string }) => {
      setBusy(true);
      setError("");
      setDraft("");
      setItems((xs) => [...xs, { kind: "user", text }]);
      if (!thread.current) setTitle(routine ? `Routine: ${routine.title}` : text.replace(/\s+/g, " ").trim());
      // Approval cards wait for the reply that prepared them, so they show under it, as they do after a reload.
      let waiting: Item[] = [];
      try {
        await streamChat(sb, { workspaceId: ws.id, threadId: thread.current, text, ...(model && model !== "auto" ? { model } : {}), ...(routine ? { routineId: routine.id } : {}) }, (e) => {
          if (e.type === "thread") {
            if (thread.current !== e.id) {
              thread.current = e.id;
              onThread(e.id);
              navigate(`/chat/${e.id}`, true);
            }
          } else if (e.type === "status") setStatus({ agent: e.agent, text: e.text });
          else if (e.type === "tool") setItems((xs) => [...xs, { kind: "tool", agent: e.agent, text: e.text }]);
          else if (e.type === "approval") waiting.push({ kind: "approval", id: e.id, title: e.title });
          else if (e.type === "handoff") {
            setStatus(null);
            setItems((xs) => [...xs, { kind: "note", agent: e.from, text: `${AGENTS[e.from].god} handed this to ${AGENTS[e.to].god}: ${e.note}` }]);
          } else if (e.type === "message") {
            setStatus(null);
            const cards = waiting;
            waiting = [];
            setItems((xs) => [...xs, { kind: "agent", agent: e.agent, text: e.text, error: e.error, blocked: e.blocked }, ...cards]);
          }
        });
      } catch (err) {
        setError(message(err));
      }
      if (waiting.length) setItems((xs) => [...xs, ...waiting]);
      setStatus(null);
      setBusy(false);
    },
    [sb, ws.id, onThread, model],
  );

  // A new chat from Home: send its first message once.
  const started = useRef(false);
  useEffect(() => {
    if (id || !start || started.current) return;
    started.current = true;
    onStarted();
    send(start.text, start.routineId ? { id: start.routineId, title: start.title ?? "" } : undefined);
  }, [id, start, onStarted, send]);

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
      <div className="msgs" aria-live="polite">
        {loading ? <div className="step">Opening the chat...</div> : null}
        {!loading && !items.length && !busy && !error ? <div className="step">No messages yet.</div> : null}
        {items.map((it, i) => (
          <ItemView key={i} item={it} sb={sb} ws={ws} />
        ))}
        {status ? (
          <div className="step" role="status">
            <span className="spin" />
            <span>
              {AGENTS[status.agent].god}: {status.text.replace(/\.+$/, "").toLowerCase()}...
            </span>
          </div>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div ref={bottom} />
      </div>
      <div className="dock">
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={(t) => send(t)}
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

function ItemView({ item, sb, ws }: { item: Item; sb: SupabaseClient; ws: Workspace }) {
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
  return (
    <div className={`msg${item.error ? " err" : ""}`}>
      <Face agent={item.agent} />
      <div className="body">
        <div className="who">
          {a.god} <span>· {a.name}</span>
        </div>
        <Markdown text={item.text} />
        {item.blocked === "expired" || item.blocked === "allowance" ? <PickPlan sb={sb} ws={ws} /> : null}
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
