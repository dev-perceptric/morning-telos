"use client";

// The Team page and each teammate's own page, laid out like the current app (app/public/app.js renderTeam and
// openAgent: .uc cards by section, and #agent/<key> with Overview, Chat and Settings tabs).
// Pausing a teammate and its trust level (Ask me first or Autopilot) are saved in agent_prefs as the signed-in
// person, so row level security decides who may change them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { appLogo, appName, changesApps } from "@/lib/composio/catalog";
import { ago } from "@/lib/home";
import { skillsFor, type SkillRow } from "@/lib/skills";
import {
  agentPicture,
  AGENTS,
  isAgentKey,
  ORDER,
  type AgentKey,
} from "@/lib/team";
import {
  agentStatus,
  agentToolkits,
  PRODUCT_BADGE,
  type AgentStatus,
} from "@/lib/teamView";
import { can } from "@/lib/workspace";
import { Face, useSkillRows } from "./Chat";
import { Icon } from "./icons";
import { navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Empty, ErrorText, PageHead, Section, Switch, to } from "./ui";

export { Face } from "./Chat";

/** Teammates whose tools can change something, in our products or the business's own apps (not Athena, who only reads, and not the ones coming soon). */
const makesChanges = (k: AgentKey) =>
  !AGENTS[k].soon &&
  !AGENTS[k].readOnly &&
  (AGENTS[k].apps.length > 0 || changesApps(k));

/** What every Team screen needs: who is paused or on autopilot, our products' setup, and the connected apps. */
function useTeam(sb: SupabaseClient, ws: Workspace) {
  const [paused, setPaused] = useState<Set<AgentKey>>(new Set());
  const [autopilot, setAutopilot] = useState<Set<AgentKey>>(new Set());
  const [services, setServices] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    sb.from("agent_prefs")
      .select("agent, enabled, trust")
      .eq("workspace_id", ws.id)
      .then(({ data, error }) => {
        if (!live) return;
        if (error)
          return setError(
            /agent_prefs/.test(error.message) ? "" : error.message,
          );
        const rows = (
          (data ?? []) as { agent: string; enabled: boolean; trust: number }[]
        ).filter((r) => isAgentKey(r.agent));
        setPaused(
          new Set(
            rows.filter((r) => !r.enabled).map((r) => r.agent as AgentKey),
          ),
        );
        setAutopilot(
          new Set(
            rows.filter((r) => r.trust >= 2).map((r) => r.agent as AgentKey),
          ),
        );
      });
    // Before the migrations run, or on a hiccup, these say nothing rather than show an error.
    sb.rpc("service_status", { ws: ws.id }).then(
      ({ data, error }) =>
        live &&
        !error &&
        setServices(
          Object.fromEntries(
            ((data ?? []) as { product: string; status: string }[]).map((r) => [
              r.product,
              r.status,
            ]),
          ),
        ),
    );
    // Composio apps, and the self-hosted WordPress site (wordpress_sites, supabase/020_wordpress.sql).
    Promise.all([
      sb.from("app_connections").select("toolkit, status").eq("workspace_id", ws.id),
      sb.from("wordpress_sites").select("status").eq("workspace_id", ws.id),
    ]).then(([apps, wp]) => {
      if (!live || apps.error) return;
      const on = ((apps.data ?? []) as { toolkit: string; status: string }[])
        .filter((r) => r.status === "active")
        .map((r) => r.toolkit);
      if (!wp.error && ((wp.data ?? []) as { status: string }[]).some((r) => r.status === "active")) on.push("wordpress");
      setConnected(on);
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  const toggle = async (k: AgentKey) => {
    const on = paused.has(k);
    setError("");
    const { error } = await sb
      .from("agent_prefs")
      .upsert(
        {
          workspace_id: ws.id,
          agent: k,
          enabled: on,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,agent" },
      );
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
    const { error } = await sb
      .from("agent_prefs")
      .upsert(
        {
          workspace_id: ws.id,
          agent: k,
          trust: on ? 2 : 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,agent" },
      );
    if (error) return setError(error.message);
    setAutopilot((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  };

  const status = (k: AgentKey): AgentStatus =>
    agentStatus(k, { paused: paused.has(k), services, connected });
  return {
    paused,
    autopilot,
    services,
    connected,
    error,
    toggle,
    setTrust,
    status,
  };
}

const dot = (s: AgentStatus) =>
  `status${s.tone === "wait" ? " wait" : s.tone === "idle" ? " idle" : ""}`;

/** The colored product badges and app logos at the top right of a card. */
function Badges({ k }: { k: AgentKey }) {
  const products = AGENTS[k].apps.filter((p) => PRODUCT_BADGE[p]);
  const apps = agentToolkits(k).slice(0, 3);
  if (!products.length && !apps.length) return null;
  return (
    <span className="ics">
      {products.map((p) => (
        <span
          key={p}
          className="ic wide"
          title={PRODUCT_BADGE[p].name}
          style={{ background: PRODUCT_BADGE[p].color }}
        >
          {PRODUCT_BADGE[p].label}
        </span>
      ))}
      {apps.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t}
          className="ic logo-ic"
          src={appLogo(t)}
          alt={appName(t)}
          title={appName(t)}
        />
      ))}
    </span>
  );
}

// ─────────────── the Team page ───────────────

/** Every teammate in one grid, with what they do. Admins set each one's trust level here too. */
export function TeamPage({
  sb,
  ws,
  onAsk,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  onAsk: (agent: AgentKey) => void;
}) {
  const admin = can(ws.role, "changeTeam");
  const editor = can(ws.role, "chat");
  const team = useTeam(sb, ws);

  return (
    <>
      <PageHead
        title="Team"
        sub="Your AI employees, each named after a Greek god. Tag any of them with @."
      />
      {team.error ? <ErrorText>{team.error}</ErrorText> : null}
      <section className="uc-sec">
        <ul className="uc-grid">
          {ORDER.map((k) => {
            const a = AGENTS[k];
            const st = team.status(k);
            const off = team.paused.has(k);
            return (
              <li key={k} className={`card uc${a.soon ? " soon" : ""}`}>
                <div className="top">
                  <Face agent={k} size={40} />
                  <Badges k={k} />
                </div>
                <div className="r1">
                  <span className="eyebrow">{a.god}</span>
                  <span className={dot(st)}>{st.label}</span>
                </div>
                <h3>{a.name}</h3>
                <p>{a.job}</p>
                <ul>
                  {a.out.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                {makesChanges(k) ? (
                  <TrustChips
                    agent={k}
                    on={team.autopilot.has(k)}
                    admin={admin}
                    onChange={(on) => team.setTrust(k, on)}
                  />
                ) : null}
                <div className="ft">
                  <a
                    href={`/team/${k}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/team/${k}`);
                    }}
                  >
                    See how it works →
                  </a>
                  {!a.soon && editor && !off ? (
                    <button
                      type="button"
                      className="btn primary sm try"
                      onClick={() => onAsk(k)}
                    >
                      Try in chat
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/** Ask me first or Autopilot, on a card. Admins and the owner change it; everyone else sees it. */
function TrustChips({
  agent,
  on,
  admin,
  onChange,
}: {
  agent: AgentKey;
  on: boolean;
  admin: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="trust-row">
      <span className="trust-l">Changes</span>
      {admin ? (
        <span
          className="seg"
          role="radiogroup"
          aria-label={`How ${AGENTS[agent].god} makes changes`}
        >
          {[
            { v: false, l: "Ask me first" },
            { v: true, l: "Autopilot" },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              role="radio"
              aria-checked={on === o.v}
              onClick={() => on !== o.v && onChange(o.v)}
            >
              {o.l}
            </button>
          ))}
        </span>
      ) : (
        <span className="trust-v">{on ? "Autopilot" : "Ask me first"}</span>
      )}
    </div>
  );
}

// ─────────────── one teammate ───────────────

type Tab = "ov" | "chat" | "set";
const WEEK = () => new Date(Date.now() - 7 * 864e5).toISOString();
type ApRow = { id: number; title: string; tool: string; created_at: string };
type ActRow = {
  id: number;
  text: string;
  thread_id: string | null;
  created_at: string;
};
type ChatRow = { id: string; title: string; updated_at: string };
type DocRow = { id: string; title: string; agent: string | null };

const TRUST: { v: boolean; t: string; s: string }[] = [
  {
    v: false,
    t: "Ask me first",
    s: "Changes wait for your OK in Approvals. Reading and research run right away.",
  },
  {
    v: true,
    t: "Autopilot",
    s: "Changes run right away and show up in Activity. Use it once you trust this teammate.",
  },
];

/** One teammate's page: who they are, what they did this week, what waits on you, their chats, trust and rules. */
export function AgentPage({
  sb,
  ws,
  agent: k,
  onAsk,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  agent: AgentKey;
  onAsk: (agent: AgentKey) => void;
}) {
  const a = AGENTS[k];
  const admin = can(ws.role, "changeTeam");
  const editor = can(ws.role, "chat");
  const team = useTeam(sb, ws);
  const skillRows = useSkillRows(sb, ws.id);
  const [tab, setTab] = useState<Tab>("ov");
  const [stats, setStats] = useState<{ replies: number; done: number } | null>(
    null,
  );
  const [needs, setNeeds] = useState<ApRow[] | null>(null);
  const [recent, setRecent] = useState<ActRow[] | null>(null);
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const st = team.status(k);
  const off = team.paused.has(k);

  const load = useCallback(() => {
    let live = true;
    const since = WEEK();
    const n = (r: { count: number | null }) => r.count ?? 0;
    Promise.all([
      sb
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .eq("role", "agent")
        .eq("agent", k)
        .gte("created_at", since),
      sb
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .eq("agent", k)
        .eq("status", "done")
        .gte("decided_at", since),
    ]).then(([r, d]) => live && setStats({ replies: n(r), done: n(d) }));
    sb.from("approvals")
      .select("id, title, tool, created_at")
      .eq("workspace_id", ws.id)
      .eq("agent", k)
      .eq("status", "pending")
      .order("id", { ascending: false })
      .limit(5)
      .then(({ data }) => live && setNeeds((data ?? []) as ApRow[]));
    sb.from("activity")
      .select("id, text, thread_id, created_at")
      .eq("workspace_id", ws.id)
      .eq("agent", k)
      .order("id", { ascending: false })
      .limit(6)
      .then(({ data }) => live && setRecent((data ?? []) as ActRow[]));
    sb.from("knowledge_docs")
      .select("id, title, agent")
      .eq("workspace_id", ws.id)
      .or(`agent.is.null,agent.eq.${k}`)
      .order("updated_at", { ascending: false })
      .then(({ data }) => live && setDocs((data ?? []) as DocRow[]));
    // The chats this teammate answered in, newest first.
    sb.from("messages")
      .select("thread_id")
      .eq("workspace_id", ws.id)
      .eq("role", "agent")
      .eq("agent", k)
      .order("id", { ascending: false })
      .limit(60)
      .then(async ({ data }) => {
        const ids = [
          ...new Set(
            ((data ?? []) as { thread_id: string }[]).map((m) => m.thread_id),
          ),
        ].slice(0, 8);
        if (!ids.length) return live && setChats([]);
        const t = await sb
          .from("threads")
          .select("id, title, updated_at")
          .eq("workspace_id", ws.id)
          .in("id", ids)
          .order("updated_at", { ascending: false });
        if (live) setChats((t.data ?? []) as ChatRow[]);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id, k]);
  useEffect(() => load(), [load]);

  const skills = skillsFor(k, skillRows as SkillRow[]);
  const products = a.apps.filter((p) => PRODUCT_BADGE[p]);
  const toolkits = agentToolkits(k);

  return (
    <>
      <a
        className="back"
        href={to("/team")}
        onClick={(e) => {
          e.preventDefault();
          navigate("/team");
        }}
      >
        <Icon name="back" small />
        Team
      </a>
      <div className="ag-h">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={agentPicture(k)} alt={`Marble statue of ${a.god}`} />
        <div className="tx">
          <span className="eyebrow">{a.god}</span>
          <h1>{a.name}</h1>
          <p>{a.job}</p>
          <div className="tools">
            {a.soon ? <span className="toolc">Coming soon</span> : null}
            {products.map((p) => (
              <span key={p} className="toolc">
                <i
                  style={{
                    background:
                      team.services[p] === "ready"
                        ? "var(--green)"
                        : "var(--ink-4)",
                  }}
                />
                {PRODUCT_BADGE[p].name}
                {team.services[p] === "ready" ? "" : ", setting up"}
              </span>
            ))}
            {toolkits.map((t) => (
              <span key={t} className="toolc">
                <i
                  style={{
                    background: team.connected.includes(t)
                      ? "var(--green)"
                      : "var(--ink-4)",
                  }}
                />
                {appName(t)}
              </span>
            ))}
            {a.apps.includes("*") ? (
              <span className="toolc">Every connected service, read only</span>
            ) : null}
          </div>
        </div>
        <div className="ag-side">
          <div className="onoff">
            <span className={dot(st)}>{st.label}</span>
            {admin && !a.soon ? (
              <Switch
                on={!off}
                label={`${a.god} on or off`}
                onChange={() => team.toggle(k)}
              />
            ) : null}
          </div>
          {!a.soon && editor && !off ? (
            <button type="button" className="btn sm" onClick={() => onAsk(k)}>
              Message
            </button>
          ) : null}
        </div>
      </div>
      {team.error ? <ErrorText>{team.error}</ErrorText> : null}
      <div className="tabs" role="tablist">
        {(
          [
            ["ov", "Overview"],
            ["chat", "Chats"],
            ["set", "Settings"],
          ] as const
        ).map(([id, l]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "ov" ? (
        <div className="tp on">
          <div className="card kpis">
            <Kpi label="Replies" value={stats?.replies} note="Last 7 days" />
            <Kpi label="Changes done" value={stats?.done} note="Last 7 days" />
            <Kpi
              label="Waiting on you"
              value={needs?.length}
              note="Right now"
            />
            <Kpi
              label="Status"
              value={st.label}
              note={
                a.soon
                  ? "Coming soon"
                  : st.tone === "ok"
                    ? "Ready to work"
                    : st.label === "Paused"
                      ? "Turned off"
                      : st.label === "Connect an app"
                        ? "In Settings, Apps"
                        : "We're setting up its tools"
              }
            />
          </div>
          <div className="two sec">
            <div>
              <div className="sh">
                <h2>Needs you</h2>
              </div>
              <div className="card list">
                {needs?.length ? (
                  needs.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="row"
                      onClick={() => navigate(`/approvals/${p.id}`)}
                    >
                      <Face agent={k} />
                      <span className="main">
                        <b>{p.title}</b>
                        <small>{p.tool.replace(/_/g, " ")}</small>
                      </span>
                      <span className="go">Review</span>
                    </button>
                  ))
                ) : (
                  <Empty title="Nothing waiting">All caught up.</Empty>
                )}
              </div>
            </div>
            <div>
              <div className="sh">
                <h2>Recent work</h2>
              </div>
              <div className="card list">
                {recent === null ? (
                  <div className="empty">Loading...</div>
                ) : recent.length ? (
                  recent.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="row"
                      disabled={!r.thread_id}
                      onClick={() =>
                        r.thread_id && navigate(`/chat/${r.thread_id}`)
                      }
                    >
                      <p>{r.text}</p>
                      <span className="meta">{ago(r.created_at)}</span>
                    </button>
                  ))
                ) : (
                  <Empty title="No work yet">
                    Send a message to get started.
                  </Empty>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : tab === "chat" ? (
        <div className="tp on">
          <div className="card list">
            {chats?.length ? (
              chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="row"
                  onClick={() => navigate(`/chat/${c.id}`)}
                >
                  <span className="main">
                    <b>{c.title || "Chat"}</b>
                  </span>
                  <span className="meta">{ago(c.updated_at)}</span>
                </button>
              ))
            ) : (
              <Empty title="No chats yet">
                {a.soon
                  ? `${a.god} is coming soon.`
                  : `Tag @${a.god} in a chat to get started.`}
              </Empty>
            )}
          </div>
          {!a.soon && editor && !off ? (
            <div className="mt-3">
              <button
                type="button"
                className="btn primary sm"
                onClick={() => onAsk(k)}
              >
                New chat with {a.god}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="tp on">
          <div className="two">
            <div>
              <div className="sh">
                <h2>Trust level</h2>
              </div>
              <div
                className="card list"
                role="radiogroup"
                aria-label={`How ${a.god} makes changes`}
              >
                {makesChanges(k) ? (
                  TRUST.map((o) => (
                    <button
                      key={o.t}
                      type="button"
                      className="radio"
                      role="radio"
                      aria-checked={team.autopilot.has(k) === o.v}
                      disabled={!admin}
                      onClick={() =>
                        team.autopilot.has(k) !== o.v && team.setTrust(k, o.v)
                      }
                    >
                      <span className="rd" />
                      <span>
                        <b>{o.t}</b>
                        <small>{o.s}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <Empty title="Reads only">
                    {a.god} looks things up and never changes anything, so there
                    is nothing to approve.
                  </Empty>
                )}
              </div>
              {makesChanges(k) && !admin ? (
                <p className="hint-s">Owners and admins can change this.</p>
              ) : null}
            </div>
            <div>
              <Section
                className="mt-0"
                title="Rules and notes"
                more={
                  <a
                    href={to("/knowledge")}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/knowledge");
                    }}
                  >
                    Edit in Knowledge
                  </a>
                }
              >
                <div className="card list">
                  {docs?.length ? (
                    docs.map((d) => (
                      <a
                        key={d.id}
                        className="row"
                        href={to("/knowledge")}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/knowledge");
                        }}
                      >
                        <span className="main">
                          <b>{d.title}</b>
                          <small>
                            {d.agent ? `Only for ${a.god}` : "Everyone"}
                          </small>
                        </span>
                      </a>
                    ))
                  ) : (
                    <Empty title="Nothing yet">
                      Add your services, prices and rules in Knowledge.
                    </Empty>
                  )}
                </div>
              </Section>
            </div>
          </div>
          <Section
            title="Skills"
            num={skills.length || undefined}
            more={
              <a
                href={to("/settings/skills")}
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/settings/skills");
                }}
              >
                Manage skills
              </a>
            }
          >
            <div className="card list">
              {skills.length ? (
                skills.map((s) => (
                  <div key={s.key} className="row">
                    <span className="main">
                      <b>/{s.name}</b>
                      <small className="wrap">{s.description}</small>
                    </span>
                    <span className="tag">
                      {s.scope === "system" ? "Ours" : "Yours"}
                    </span>
                  </div>
                ))
              ) : (
                <Empty title="No skills yet" />
              )}
            </div>
          </Section>
        </div>
      )}
    </>
  );
}

export function Kpi({
  label: name,
  value,
  note,
}: {
  label: string;
  value: number | string | undefined;
  note: string;
}) {
  return (
    <div className="kpi">
      <small>{name}</small>
      <b>{value ?? "·"}</b>
      <em className="flat">{note}</em>
    </div>
  );
}
