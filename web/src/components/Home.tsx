"use client";

// Home, like the approved demo: an optional Slack banner, the warm hero with the greeting, the big question and the
// message box, the other ways to reach the team under it, then Finish setup (owners and admins) and three use cases
// suggested for the business. The trial pill stays at the top while a trial runs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { appLogo, appName } from "@/lib/composio/catalog";
import { finishSetup, greeting, reachChannels, showSlackBanner, slackBannerKey, trialPill, type ReachDoors, type SetupRow } from "@/lib/home";
import type { ModelChoice } from "@/lib/models";
import { effectivePlan } from "@/lib/plans";
import { AGENTS } from "@/lib/team";
import { industryOf, starterMessage, suggestedUseCases, caseAppName } from "@/lib/useCases";
import { can } from "@/lib/workspace";
import { Composer, Face, useSkillRows } from "./Chat";
import { Icon } from "./icons";
import { callApi, message, navigate, readLocal, writeLocal } from "./nav";
import type { Workspace } from "./Settings";
import { useConnect } from "./Social";
import { ErrorText, Notice, Section, to } from "./ui";

type AppsList = { on: boolean; connectable: string[]; connections: { toolkit: string; status: string }[]; wordpress?: { status: string } | null };

/** What Home needs to know about the workspace: its apps (owners and admins), its social accounts and its kind of business. */
function useHomeState(sb: SupabaseClient, ws: Workspace, admin: boolean) {
  const [apps, setApps] = useState<AppsList | null>(null);
  const [social, setSocial] = useState<number | null>(null);
  const [about, setAbout] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (admin)
      callApi<AppsList>(sb, "/api/apps/list", { workspaceId: ws.id })
        .then((l) => live && setApps(l))
        .catch(() => live && setApps({ on: false, connectable: [], connections: [], wordpress: null }));
    sb.from("social_channels")
      .select("channel_id", { count: "exact", head: true })
      .eq("workspace_id", ws.id)
      .then(({ count, error }) => live && setSocial(error ? 0 : (count ?? 0)));
    return () => {
      live = false;
    };
  }, [sb, ws.id, admin, n]);
  // The About doc made from the website says what the business sells, which picks the suggestions.
  useEffect(() => {
    let live = true;
    sb.from("knowledge_docs")
      .select("body")
      .eq("workspace_id", ws.id)
      .eq("source", "website")
      .limit(1)
      .then(({ data, error }) => live && !error && setAbout(String((data?.[0] as { body?: string } | undefined)?.body ?? "")));
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  // Social accounts and apps are connected in another tab or after a redirect: look again when Home comes back.
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && setN((x) => x + 1);
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  return { apps, social, industry: industryOf(`${ws.name}\n${about}`) };
}

export function Home({
  sb,
  ws,
  name,
  userId,
  draft,
  onDraft,
  onStart,
  model,
  onModel,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  name: string;
  userId: string;
  draft: string;
  onDraft: (v: string) => void;
  onStart: (text: string) => void;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
}) {
  const editor = can(ws.role, "chat");
  const admin = can(ws.role, "connectApps");
  const skills = useSkillRows(sb, ws.id);
  const pill = trialPill(effectivePlan(ws));
  const { apps, social, industry } = useHomeState(sb, ws, admin);
  const socialConnect = useConnect(sb, ws.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const bannerKey = slackBannerKey(userId, ws.id);
  const [dismissed, setDismissed] = useState(() => readLocal(bannerKey) === "1");

  const connected = (apps?.connections ?? []).map((c) => c.toolkit);
  const banner = showSlackBanner({ canConnect: admin, slackReady: Boolean(apps?.on && apps.connectable.includes("slack")), slackConnected: connected.includes("slack"), dismissed });
  // The email, text and Slack doors fill these as each one ships. Until then the strip stays hidden.
  const doors: ReachDoors = {};
  const reach = reachChannels(doors);
  const rows =
    apps && social !== null
      ? finishSetup({ canConnect: admin, socialAccounts: social, connected, connectable: apps.on ? apps.connectable : [], wordpress: Boolean(apps.wordpress) })
      : [];
  const suggested = suggestedUseCases(industry);

  const connectApp = useCallback(
    async (toolkit: string) => {
      setError("");
      setBusy(toolkit);
      try {
        const { url } = await callApi<{ url: string }>(sb, "/api/apps/connect", { workspaceId: ws.id, toolkit });
        window.location.assign(url);
      } catch (e) {
        setError(message(e));
        setBusy("");
      }
    },
    [sb, ws.id],
  );
  const dismiss = () => {
    writeLocal(bannerKey, "1");
    setDismissed(true);
  };

  return (
    <div className="home2">
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
      {banner ? (
        <div className="hbanner" role="region" aria-label="Slack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={appLogo("slack")} alt="" width={28} height={28} className="lg-img" />
          <span className="main">Connect Slack to work with your team</span>
          <button type="button" className="btn primary sm" onClick={() => connectApp("slack")} disabled={busy === "slack"}>
            {busy === "slack" ? "Opening..." : "Connect Slack"}
          </button>
          <button type="button" className="icon-btn" aria-label="Not now" title="Not now" onClick={dismiss}>
            <Icon name="close" small />
          </button>
        </div>
      ) : null}

      <div className="hhero">
        <p className="hhero-hi">{greeting(new Date().getHours(), name)}</p>
        <h1 className="hhero-q">What can your team do for you?</h1>
        <div className="hbox">
          <Composer
            value={draft}
            onChange={onDraft}
            onSend={onStart}
            disabled={!editor}
            placeholder={editor ? "Ask anything. Type @ to tag a teammate, or / for a skill" : "Viewers can read chats but can't send messages."}
            autoFocus={editor}
            skills={skills}
            down
            rows={2}
            model={model}
            onModel={onModel}
          />
          {reach.length ? (
            <div className="reach">
              <span>Other ways to reach your team</span>
              <div>
                {reach.map((c) =>
                  c.id === "slack" ? (
                    <span key={c.id} className="ch" title={c.detail}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={appLogo("slack")} alt="" width={16} height={16} />
                      {c.label}
                    </span>
                  ) : (
                    <a key={c.id} href={`${c.id === "email" ? "mailto" : "sms"}:${c.detail}`} title={c.detail}>
                      <Icon name={c.id === "email" ? "mail" : "message"} small />
                      {c.label}
                    </a>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {socialConnect.error ? <ErrorText>{socialConnect.error}</ErrorText> : null}
      {socialConnect.opened ? <Notice>We opened the connect page in a new tab. Sign in to each account there.</Notice> : null}

      {rows.length ? (
        <Section title={<span className="setup-h">Finish setup</span>} num={rows.length}>
          <div className="card list setup">
            {rows.map((r) => (
              <SetupLine key={r.key} row={r} busy={busy} socialBusy={socialConnect.busy} onSocial={socialConnect.connect} onApp={connectApp} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Suggested for you" more={<a href={to("/use-cases")} onClick={(e) => go(e, "/use-cases")}>See all</a>}>
        <div className="sug-grid">
          {suggested.map((u) => (
            <button key={u.id} type="button" className="card sug-c" disabled={!editor} onClick={() => onStart(starterMessage(u))}>
              <span className="sug-top">
                <Face agent={u.agent} size={30} />
                <small>{AGENTS[u.agent].god}</small>
              </span>
              <b>{u.title}</b>
              <small>{u.line}</small>
              {u.apps.length ? <Logos ids={u.apps.slice(0, 4)} /> : null}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function go(e: React.MouseEvent, path: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(path);
}

/** One row of Finish setup: the app logos, what to connect, and its Connect button (one per app when there are two). */
function SetupLine({ row, busy, socialBusy, onSocial, onApp }: { row: SetupRow; busy: string; socialBusy: boolean; onSocial: () => void; onApp: (toolkit: string) => void }) {
  const c = row.connect;
  return (
    <div className="row wrap-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appLogo(row.logos[0])} alt="" width={32} height={32} className="lg-img" />
      <span className="main">
        <b className="wrap">{row.title}</b>
        <small className="wrap">{row.text}</small>
      </span>
      <span className="row-act">
        {c.kind === "social" ? (
          <button type="button" className="btn sm" onClick={onSocial} disabled={socialBusy}>
            {socialBusy ? "Opening..." : "Connect"}
          </button>
        ) : c.kind === "page" ? (
          <a className="btn sm" href={to(c.path)} onClick={(e) => go(e, c.path)}>
            Connect
          </a>
        ) : c.apps.length === 1 ? (
          <button type="button" className="btn sm" onClick={() => onApp(c.apps[0])} disabled={busy === c.apps[0]}>
            {busy === c.apps[0] ? "Opening..." : `Connect ${appName(c.apps[0])}`}
          </button>
        ) : (
          c.apps.map((a) => (
            <button key={a} type="button" className="btn sm" onClick={() => onApp(a)} disabled={busy === a} aria-label={`Connect ${appName(a)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={appLogo(a)} alt="" width={16} height={16} className="btn-logo" />
              {busy === a ? "Opening..." : appName(a)}
            </button>
          ))
        )}
      </span>
    </div>
  );
}

/** App logos in a row, each named for screen readers and on hover. */
export function Logos({ ids }: { ids: string[] }) {
  return (
    <span className="ics">
      {ids.map((a) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={a} className="ic logo-ic" src={appLogo(a)} alt={caseAppName(a)} title={caseAppName(a)} />
      ))}
    </span>
  );
}
