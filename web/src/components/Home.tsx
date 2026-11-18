"use client";

// Home, laid out like the current app (app/public/index.html #v-home and app.js renderHome): the trial pill, a
// greeting, the message box, ideas, Finish setup, Needs you, This week and Activity. Everything is read as the
// signed-in person, so row level security decides what they see.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ago, greeting, homeIdeas, setupSteps, trialPill, type ServiceRow, type SetupStep } from "@/lib/home";
import type { ModelChoice } from "@/lib/models";
import { effectivePlan } from "@/lib/plans";
import { AGENTS, isAgentKey, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { Composer, Face, useSkillRows, WithTags } from "./Chat";
import { Icon } from "./icons";
import { navigate } from "./nav";
import type { Workspace } from "./Settings";
import { useConnect } from "./Social";
import { Empty, ErrorText, Notice, Section, to } from "./ui";

// Ideas for the box. SEO and social ideas show once those products are ready (homeIdeas).
const IDEAS = [
  "@Artemis how is our AI visibility this week?",
  "@Aphrodite plan next week's posts",
  "@Iris write a welcome email for new customers",
  "@Hermes follow up on this week's new leads",
  "@Hora find times for a call next week",
  "@Hestia answer the customer emails waiting for us",
  "@Hephaestus outline a homepage for my business",
  "What can my AI team do for me?",
];

type ApRow = { id: number; agent: string; title: string; tool: string; created_at: string };
type ActRow = { id: number; agent: string | null; text: string; thread_id: string | null; created_at: string };
const agentOf = (k: string | null): AgentKey => (isAgentKey(k) ? k : "chief");
const quiet = (m: string) => (/relation|does not exist|schema cache/.test(m) ? "" : m);

export function Home({
  sb,
  ws,
  name,
  draft,
  onDraft,
  onStart,
  model,
  onModel,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  name: string;
  draft: string;
  onDraft: (v: string) => void;
  onStart: (text: string) => void;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
}) {
  const editor = can(ws.role, "chat");
  const skills = useSkillRows(sb, ws.id);
  const pill = trialPill(effectivePlan(ws));
  const [services, setServices] = useState<ServiceRow[]>([]);
  const ready = { arrowsterr: services.some((s) => s.product === "arrowsterr" && s.status === "ready"), capybaroar: services.some((s) => s.product === "capybaroar" && s.status === "ready") };
  const ideas = homeIdeas(IDEAS, ready, 4);

  // Our products' setup. Look again every 10 seconds while one is being set up.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () =>
      sb.rpc("service_status", { ws: ws.id }).then(({ data, error }) => {
        if (!live || error) return;
        const rows = (data ?? []) as ServiceRow[];
        setServices(rows);
        if (rows.some((r) => r.status === "pending")) timer = setTimeout(check, 10_000);
      });
    check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sb, ws.id]);

  return (
    <>
      {pill ? (
        <a
          className={`trialbar${pill.warn ? " warn" : ""}`}
          href={to("/billing")}
          onClick={(e) => {
            e.preventDefault();
            navigate("/billing");
          }}
        >
          {pill.lead} <b>{pill.strong}</b> · {pill.cta} →
        </a>
      ) : null}
      <div className="hero">
        <p>{greeting(new Date().getHours(), name)}</p>
        <h1>What should your team do today?</h1>
      </div>
      <Composer
        value={draft}
        onChange={onDraft}
        onSend={onStart}
        disabled={!editor}
        placeholder={editor ? "Ask your team anything. Type @ to tag someone, or / for a skill" : "Viewers can read chats but can't send messages."}
        autoFocus={editor}
        skills={skills}
        down
        rows={2}
        model={model}
        onModel={onModel}
      />
      <div className="hint">
        <span>Athena answers, or tag a teammate with @</span>
        <span className="hide-m">Changes wait for your approval</span>
      </div>
      {editor ? (
        <div className="sugg-l">
          {ideas.map((t) => (
            <button key={t} type="button" className="sg-i" onClick={() => onStart(t)}>
              <Icon name="idea" small />
              <span>
                <WithTags text={t} />
              </span>
              <Icon name="arrow" small className="go-ic" />
            </button>
          ))}
        </div>
      ) : null}
      <FinishSetup sb={sb} ws={ws} services={services} />
      <NeedsYou sb={sb} ws={ws} />
      <ThisWeek sb={sb} ws={ws} />
      <Activity sb={sb} ws={ws} />
    </>
  );
}

/** What's left to set up: Knowledge, SEO, social accounts and apps. Hidden once all are done. */
function FinishSetup({ sb, ws, services }: { sb: SupabaseClient; ws: Workspace; services: ServiceRow[] }) {
  const [counts, setCounts] = useState<{ docs: number; social: boolean; apps: boolean } | null>(null);
  const social = useConnect(sb, ws.id);
  useEffect(() => {
    let live = true;
    Promise.all([
      sb.from("knowledge_docs").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id),
      sb.from("social_channels").select("channel_id, status").eq("workspace_id", ws.id),
      sb.from("app_connections").select("toolkit, status").eq("workspace_id", ws.id),
    ]).then(([d, s, a]) => {
      if (!live) return;
      setCounts({
        // A table that isn't there yet counts as done, so the card never asks for something that can't be done.
        docs: d.error ? 1 : (d.count ?? 0),
        social: s.error ? true : ((s.data ?? []) as { status: string }[]).some((r) => r.status === "connected"),
        apps: a.error ? true : ((a.data ?? []) as { status: string }[]).some((r) => r.status === "active"),
      });
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  if (!counts) return null;
  const steps = setupSteps({
    docs: counts.docs,
    services,
    socialConnected: counts.social,
    appsConnected: counts.apps,
    canSocial: can(ws.role, "connectSocial"),
    canApps: can(ws.role, "connectApps"),
    canKnowledge: can(ws.role, "editKnowledge"),
  });
  if (!steps.length) return null;
  const act = (s: SetupStep) => (s.connect ? social.connect() : s.action && navigate(s.action.path));
  return (
    <Section title={<span className="setup-h">Finish setup</span>} num={steps.length}>
      <div className="card list setup">
        {steps.map((s) => (
          <div key={s.key} className="row">
            <span className="main">
              <b>{s.title}</b>
              <small>{s.text}</small>
            </span>
            {s.action ? (
              <button type="button" className="btn sm" onClick={() => act(s)} disabled={s.connect && social.busy}>
                {s.connect && social.busy ? "Opening..." : s.action.label}
              </button>
            ) : (
              <span className="meta">{s.meta}</span>
            )}
          </div>
        ))}
      </div>
      {social.error ? <ErrorText>{social.error}</ErrorText> : null}
      {social.opened ? <Notice>We opened the connect page in a new tab. Sign in to each account there.</Notice> : null}
    </Section>
  );
}

/** Changes waiting for a person, newest first. */
export function NeedsYou({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [rows, setRows] = useState<ApRow[] | null>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    sb.from("approvals")
      .select("id, agent, title, tool, created_at", { count: "exact" })
      .eq("workspace_id", ws.id)
      .eq("status", "pending")
      .order("id", { ascending: false })
      .limit(3)
      .then(({ data, count, error }) => {
        if (!live) return;
        setRows(error ? [] : ((data ?? []) as ApRow[]));
        setCount(count ?? 0);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  return (
    <Section
      title="Needs you"
      num={count || undefined}
      more={
        <a
          href={to("/approvals")}
          onClick={(e) => {
            e.preventDefault();
            navigate("/approvals");
          }}
        >
          View all
        </a>
      }
    >
      <div className="card list">
        {rows === null ? null : rows.length ? (
          rows.map((p) => (
            <button key={p.id} type="button" className="row" onClick={() => navigate(`/approvals/${p.id}`)}>
              <Face agent={agentOf(p.agent)} />
              <span className="main">
                <b>{p.title}</b>
                <small>
                  {AGENTS[agentOf(p.agent)].god} · {p.tool.replace(/_/g, " ")}
                </small>
              </span>
              <span className="go">Review</span>
            </button>
          ))
        ) : (
          <Empty title="All caught up">Your team will ask you here before changing anything.</Empty>
        )}
      </div>
    </Section>
  );
}

/** Four numbers for the last 7 days, like the current app's This week. */
function ThisWeek({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [k, setK] = useState<{ chats: number; replies: number; done: number; waiting: number } | null>(null);
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const n = (r: { count: number | null; error: unknown }) => (r.error ? 0 : (r.count ?? 0));
    Promise.all([
      sb.from("threads").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).gte("updated_at", since),
      sb.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("role", "agent").gte("created_at", since),
      sb.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("status", "done").gte("decided_at", since),
      sb.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("status", "pending"),
    ]).then(([c, r, d, w]) => live && setK({ chats: n(c), replies: n(r), done: n(d), waiting: n(w) }));
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  const cells: [string, number | undefined, string][] = [
    ["Chats", k?.chats, "Last 7 days"],
    ["Replies", k?.replies, "Last 7 days"],
    ["Changes done", k?.done, "Last 7 days"],
    ["Waiting on you", k?.waiting, "Right now"],
  ];
  return (
    <Section title="This week">
      <div className="card kpis">
        {cells.map(([l, v, note]) => (
          <div key={l} className="kpi">
            <small>{l}</small>
            <b>{v ?? "·"}</b>
            <em className="flat">{note}</em>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** What the team did lately: prepared for approval, ran on autopilot, finished. */
function Activity({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [rows, setRows] = useState<ActRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    sb.from("activity")
      .select("id, agent, text, thread_id, created_at")
      .eq("workspace_id", ws.id)
      .order("id", { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(quiet(error.message));
        setRows((data ?? []) as ActRow[]);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  return (
    <Section title="Activity">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="card list">
        {rows === null ? null : rows.length ? (
          rows.map((a) => {
            const k = agentOf(a.agent);
            const inner = (
              <>
                <Face agent={k} size={24} />
                <p>
                  <b>{a.agent ? AGENTS[k].god : "Team"}</b> {a.text}
                </p>
                <span className="meta">{ago(a.created_at)}</span>
              </>
            );
            return a.thread_id ? (
              <button key={a.id} type="button" className="row" onClick={() => navigate(`/chat/${a.thread_id}`)}>
                {inner}
              </button>
            ) : (
              <div key={a.id} className="row">
                {inner}
              </div>
            );
          })
        ) : (
          <Empty title="Quiet so far">Ask your team something to get started.</Empty>
        )}
      </div>
    </Section>
  );
}
