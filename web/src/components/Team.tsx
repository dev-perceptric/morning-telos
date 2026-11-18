"use client";

// The AI team on screen: the Home composer, a chat thread that streams replies, and the Team page.
// Ported from the old app's chat (app/public/app.js runChat, the @ menu) and laid out like Omniscient's Ask.
// Chats are read straight from Supabase as the signed-in person, so row level security decides what they see.
// Sending goes through POST /api/chat, which streams NDJSON (src/lib/chat.ts readLines).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/agentLoop";
import { inlineParts, readLines } from "@/lib/chat";
import { PLANS, type PaidPlan } from "@/lib/plans";
import { insertSkill, matchSkills, menuAgent, skillsFor, slashQuery, type SkillRow } from "@/lib/skills";
import { agentFace, AGENTS, agentByGod, insertMention, isAgentKey, LEAD, mentionMatches, mentionQuery, ORDER, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { ApprovalCard } from "./Approvals";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { btnPrimary, btnSmall, card, ErrorText, Notice } from "./ui";

type Item =
  | { kind: "user"; text: string }
  | { kind: "agent"; agent: AgentKey; text: string; error?: boolean; blocked?: string }
  | { kind: "note"; agent: AgentKey; text: string; full?: boolean }
  | { kind: "tool"; agent: AgentKey; text: string }
  | { kind: "approval"; id: number; title: string };

type ThreadRow = { id: string; title: string; updated_at: string };
type MessageRow = { id: number; role: "user" | "agent" | "note"; agent: string | null; content: string; meta: Record<string, unknown> | null };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function Face({ agent, size = 32 }: { agent: AgentKey; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={agentFace(agent)} alt="" width={size} height={size} className="shrink-0 rounded-full bg-sunk" style={{ width: size, height: size }} />;
}

/** The person's words, with tagged teammates marked. */
function WithTags({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@\w+)/g).map((part, i) =>
        part.startsWith("@") && agentByGod(part.slice(1)) ? (
          <span key={i} className="font-semibold text-clay-2">
            @{AGENTS[agentByGod(part.slice(1))!].god}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** A reply: line breaks kept, **bold** shown bold, and nothing in it treated as HTML. */
function Reply({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
      {inlineParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

// ─────────────── the composer ───────────────

/**
 * A message box. Typing @ opens a menu of teammates, and / a menu of the tagged teammate's skills (Athena's, or
 * `agent`'s, when nobody is tagged). Enter sends and Shift+Enter starts a new line.
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  placeholder,
  autoFocus,
  skills = [],
  agent = LEAD,
}: {
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ kind: "mention" | "skill"; q: string } | null>(null);
  const [pick, setPick] = useState(0);
  const skillAgent = menuAgent(value, agent);
  const people = query?.kind === "mention" ? mentionMatches(query.q) : [];
  const found = query?.kind === "skill" ? matchSkills(skillsFor(skillAgent, skills), query.q).slice(0, 8) : [];
  const count = people.length || found.length;
  const open = count > 0;

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
      className="relative rounded-2xl border border-line bg-surface p-3 shadow-sm focus-within:border-ink-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {open && people.length ? (
        <div role="listbox" aria-label="AI team" className="absolute bottom-full left-0 z-10 mb-2 flex w-full max-w-sm flex-col gap-0.5 rounded-[12px] border border-line bg-surface p-1.5 shadow-lg">
          {people.map((k, i) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={`flex items-center gap-3 rounded-[9px] px-2 py-1.5 text-left ${i === pick ? "bg-sunk" : "hover:bg-sunk"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(k);
              }}
            >
              <Face agent={k} size={28} />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{AGENTS[k].god}</span>
                <span className="block text-[13px] text-ink-3">
                  {AGENTS[k].name}
                  {AGENTS[k].soon ? ". Coming soon" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {open && found.length ? (
        <div role="listbox" aria-label={`${AGENTS[skillAgent].god}'s skills`} className="absolute bottom-full left-0 z-10 mb-2 flex w-full max-w-md flex-col gap-0.5 rounded-[12px] border border-line bg-surface p-1.5 shadow-lg">
          <p className="px-2 pt-1 text-[12px] font-semibold text-ink-4">{AGENTS[skillAgent].god}&apos;s skills</p>
          {found.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={`flex flex-col rounded-[9px] px-2 py-1.5 text-left ${i === pick ? "bg-sunk" : "hover:bg-sunk"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                chooseSkill(x.name);
              }}
            >
              <span className="text-[14px] font-semibold">/{x.name}</span>
              <span className="break-words text-[13px] text-ink-3">{x.description.split(". ")[0].replace(/\.$/, "")}.</span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="sr-only" htmlFor="composer">
        Message your team
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={2}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        className="block max-h-56 min-h-12 w-full resize-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4 disabled:text-ink-4"
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
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" className="rounded-[9px] px-2 py-1 text-[14px] font-medium text-ink-3 hover:bg-sunk hover:text-ink disabled:opacity-50" onClick={tag} disabled={disabled}>
          @ Tag a teammate
        </button>
        <button type="submit" className={`${btnPrimary} h-9 w-auto px-4 text-[14px]`} disabled={disabled || busy || !value.trim()}>
          {busy ? "Working..." : "Send"}
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

// ─────────────── Home ───────────────

const IDEAS = ["@Artemis how is our AI visibility this week?", "@Aphrodite plan next week's posts", "@Hephaestus outline a homepage for my business", "What can my AI team do for me?"];

/** Home: what should the team do today, and the latest chats. */
export function TeamHome({ sb, ws, draft, onDraft, onStart }: { sb: SupabaseClient; ws: Workspace; draft: string; onDraft: (v: string) => void; onStart: (text: string) => void }) {
  const editor = can(ws.role, "chat");
  const threads = useThreads(sb, ws.id, 8);
  const skills = useSkillRows(sb, ws.id);
  return (
    <section className="flex flex-col gap-6 py-4">
      <div>
        <p className="mb-1 text-[14px] text-ink-3">{ws.name}</p>
        <h1 className="font-serif text-[34px] leading-tight">What should your team do today?</h1>
      </div>
      <Composer value={draft} onChange={onDraft} onSend={onStart} disabled={!editor} placeholder={editor ? "Ask your team anything. Type @ to tag a teammate, or / for a skill." : "Viewers can read chats but can't send messages."} autoFocus={editor} skills={skills} />
      {editor ? (
        <div className="flex flex-wrap gap-2">
          {IDEAS.map((t) => (
            <button key={t} type="button" className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-[14px] text-ink-2 hover:border-line-2 hover:bg-sunk" onClick={() => onDraft(t)}>
              <WithTags text={t} />
            </button>
          ))}
        </div>
      ) : null}
      {threads.rows?.length ? (
        <div>
          <h2 className="mb-2 text-[13px] font-semibold text-ink-4">Recent chats</h2>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
            {threads.rows.map((t) => (
              <li key={t.id}>
                <a
                  href={`/chat/${t.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-sunk"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/chat/${t.id}`);
                  }}
                >
                  <span className="min-w-0 break-words text-[15px]">{t.title || "Chat"}</span>
                  <span className="shrink-0 text-[13px] text-ink-4">{when(t.updated_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {threads.error ? <ErrorText>{threads.error}</ErrorText> : null}
    </section>
  );
}

function useThreads(sb: SupabaseClient, workspaceId: string, limit: number) {
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    sb.from("threads")
      .select("id, title, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!live) return;
        // Before 011_ai_team.sql runs there are no chats yet. Say nothing rather than show a database error.
        if (error) return setError(/threads/.test(error.message) ? "" : error.message);
        setRows((data ?? []) as ThreadRow[]);
      });
    return () => {
      live = false;
    };
  }, [sb, workspaceId, limit]);
  return { rows, error };
}

// ─────────────── a thread ───────────────

/** The approvals an agent's reply prepared (meta.approvals, saved by the agent loop), as cards under it. */
const approvalsIn = (meta: Record<string, unknown> | null): Item[] =>
  (Array.isArray(meta?.approvals) ? (meta.approvals as { id?: unknown; title?: unknown }[]) : [])
    .filter((a) => typeof a?.id === "number")
    .map((a) => ({ kind: "approval" as const, id: a.id as number, title: typeof a.title === "string" ? a.title : "A change" }));

const toItems = (m: MessageRow): Item[] => {
  const agent = isAgentKey(m.agent) ? m.agent : "chief";
  if (m.role === "user") return [{ kind: "user", text: m.content }];
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
  onStarted,
  onThread,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  id: string | null;
  start: StartChat | null;
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
        await streamChat(sb, { workspaceId: ws.id, threadId: thread.current, text, ...(routine ? { routineId: routine.id } : {}) }, (e) => {
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
    [sb, ws.id, onThread],
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
    <section className="flex min-h-[70vh] flex-col gap-5 py-2">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 break-words font-serif text-[24px] leading-tight">{title || (loading ? "" : "New chat")}</h1>
        <button type="button" className={`${btnSmall} shrink-0`} onClick={() => navigate("/")}>
          New chat
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4" aria-live="polite">
        {loading ? <p className="text-[14px] text-ink-4">Loading...</p> : null}
        {!loading && !items.length && !busy && !error ? <p className="text-[14px] text-ink-4">No messages yet.</p> : null}
        {items.map((it, i) => (
          <ItemView key={i} item={it} sb={sb} ws={ws} />
        ))}
        {status ? (
          <div className="flex items-center gap-3 text-[14px] text-ink-3" role="status">
            <Face agent={status.agent} size={24} />
            <span>
              {AGENTS[status.agent].god} is {status.text.toLowerCase()}...
            </span>
          </div>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div ref={bottom} />
      </div>
      <div className="sticky bottom-4">
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={(t) => send(t)}
          busy={busy}
          disabled={!editor}
          placeholder={editor ? "Reply, type @ to tag a teammate, or / for a skill." : "Viewers can read chats but can't send messages."}
          skills={skills}
          agent={lastAgent}
        />
      </div>
    </section>
  );
}

function ItemView({ item, sb, ws }: { item: Item; sb: SupabaseClient; ws: Workspace }) {
  if (item.kind === "approval")
    return (
      <div className="pl-11">
        <ApprovalCard sb={sb} ws={ws} id={item.id} title={item.title} />
      </div>
    );
  if (item.kind === "user")
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-sunk px-4 py-2.5 text-[15px] text-ink">
          <WithTags text={item.text} />
        </p>
      </div>
    );
  if (item.kind === "note" || item.kind === "tool")
    return (
      <div className="flex items-center gap-2 pl-1 text-[13px] text-ink-3">
        <Face agent={item.agent} size={20} />
        <span className="min-w-0 break-words">{item.kind === "note" && !item.full ? item.text.split(":")[0] : item.text}</span>
      </div>
    );
  const a = AGENTS[item.agent];
  return (
    <div className="flex items-start gap-3">
      <Face agent={item.agent} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[14px] font-semibold">
          {a.god} <span className="font-normal text-ink-4">{a.name}</span>
        </p>
        <div className={item.error ? "rounded-[10px] bg-[#fbeae4] px-3 py-2" : ""}>
          <Reply text={item.text} />
        </div>
        {item.blocked === "expired" || item.blocked === "allowance" ? <PickPlan sb={sb} ws={ws} /> : null}
      </div>
    </div>
  );
}

/** Under a limit message: the owner picks a plan (Stripe Checkout); everyone else is told who can. */
function PickPlan({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  if (ws.role !== "owner") return <p className="text-[14px] text-ink-3">Ask the workspace owner to pick a plan.</p>;
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
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(["starter", "pro"] as const).map((p) => (
          <button key={p} type="button" className={btnSmall} disabled={busy} onClick={() => choose(p)}>
            Upgrade to {PLANS[p].name}, ${PLANS[p].price} a month
          </button>
        ))}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? <Notice>{done}</Notice> : null}
    </div>
  );
}

// ─────────────── Team ───────────────

/** Every teammate, with what they do. Coming soon ones are marked. Admins can pause one. */
export function TeamPage({ sb, ws, onAsk }: { sb: SupabaseClient; ws: Workspace; onAsk: (agent: AgentKey) => void }) {
  const admin = can(ws.role, "changeTeam");
  const editor = can(ws.role, "chat");
  const [paused, setPaused] = useState<Set<AgentKey>>(new Set());
  const [autopilot, setAutopilot] = useState<Set<AgentKey>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    sb.from("agent_prefs")
      .select("agent, enabled, trust")
      .eq("workspace_id", ws.id)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setError(/agent_prefs/.test(error.message) ? "" : error.message);
        const rows = ((data ?? []) as { agent: string; enabled: boolean; trust: number }[]).filter((r) => isAgentKey(r.agent));
        setPaused(new Set(rows.filter((r) => !r.enabled).map((r) => r.agent as AgentKey)));
        setAutopilot(new Set(rows.filter((r) => r.trust >= 2).map((r) => r.agent as AgentKey)));
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  const toggle = async (k: AgentKey) => {
    const on = paused.has(k);
    setError("");
    const { error } = await sb.from("agent_prefs").upsert({ workspace_id: ws.id, agent: k, enabled: on, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,agent" });
    if (error) return setError(error.message);
    setPaused((s) => {
      const n = new Set(s);
      if (on) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  // Ask me first (0): every change waits in Approvals. Autopilot (2): changes run right away and are logged.
  const setTrust = async (k: AgentKey, on: boolean) => {
    setError("");
    const { error } = await sb.from("agent_prefs").upsert({ workspace_id: ws.id, agent: k, trust: on ? 2 : 0, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,agent" });
    if (error) return setError(error.message);
    setAutopilot((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  };

  return (
    <section className="flex flex-col gap-6 py-4">
      <div>
        <h1 className="font-serif text-[34px] leading-tight">Your AI team</h1>
        <p className="text-[15px] text-ink-3">Tag a teammate with @ in any chat. Athena answers when you don&apos;t tag anyone.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {ORDER.map((k) => {
          const a = AGENTS[k];
          const off = paused.has(k);
          return (
            <li key={k} className={`${card} ${a.soon ? "opacity-75" : ""}`}>
              <div className="flex items-start gap-3">
                <Face agent={k} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[18px] font-semibold">{a.god}</h2>
                    {a.soon ? <span className="rounded-full bg-sunk px-2.5 py-0.5 text-[12px] text-ink-3">Coming soon</span> : null}
                    {off && !a.soon ? <span className="rounded-full bg-clay-bg px-2.5 py-0.5 text-[12px] text-clay-2">Paused</span> : null}
                  </div>
                  <p className="text-[14px] text-ink-3">{a.name}</p>
                </div>
              </div>
              <p className="text-[15px] text-ink-2">{a.job}</p>
              <ul className="flex flex-col gap-1 text-[14px] text-ink-3">
                {a.out.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              {makesChanges(k) ? <TrustSetting agent={k} on={autopilot.has(k)} admin={admin} onChange={(on) => setTrust(k, on)} /> : null}
              {!a.soon && (editor || admin) ? (
                <div className="flex flex-wrap gap-2">
                  {editor && !off ? (
                    <button type="button" className={btnSmall} onClick={() => onAsk(k)}>
                      Ask {a.god}
                    </button>
                  ) : null}
                  {admin ? (
                    <button type="button" className={btnSmall} onClick={() => toggle(k)}>
                      {off ? "Turn on" : "Pause"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Teammates whose tools can change something (not Athena, who only reads, and not the ones coming soon). */
const makesChanges = (k: AgentKey) => !AGENTS[k].soon && !AGENTS[k].readOnly && AGENTS[k].apps.length > 0;

/** Ask me first or Autopilot, for one teammate. Admins and the owner change it; everyone else sees it. */
function TrustSetting({ agent, on, admin, onChange }: { agent: AgentKey; on: boolean; admin: boolean; onChange: (on: boolean) => void }) {
  const options = [
    { on: false, label: "Ask me first" },
    { on: true, label: "Autopilot" },
  ];
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <p className="text-[13px] font-medium text-ink-3">Changes</p>
      {admin ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`How ${AGENTS[agent].god} makes changes`}>
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={on === o.on}
              className={`rounded-full px-3 py-1.5 text-[14px] ${on === o.on ? "bg-ink text-white" : "border border-line bg-surface text-ink-2 hover:bg-sunk"}`}
              onClick={() => on !== o.on && onChange(o.on)}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[14px] text-ink-2">{on ? "Autopilot" : "Ask me first"}</p>
      )}
      <p className="text-[13px] text-ink-4">{on ? "Changes run right away. You see them in Recent work on Home." : "Every change waits for your OK in Approvals."}</p>
    </div>
  );
}
