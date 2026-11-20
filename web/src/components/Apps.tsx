"use client";

// Settings, Apps: the business's own apps (Gmail, Outlook, HubSpot and more) that the AI team can use. Owners and
// admins connect each one in one click: Composio's sign-in page opens, and it comes back here
// (POST /api/apps/connect, GET /api/apps/composio). Nobody pastes a key. Shaped like Omniscient's Settings, Apps.
// A self-hosted WordPress site has its own row in Website: the owner types the address, WordPress's own Approve
// screen opens, and it comes back here (POST /api/apps/wordpress, GET /api/apps/wordpress/callback).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { APP_MESSAGES, appLogo, appName, APPS, DIRECT, GROUPS, isAppId, type AppEntry } from "@/lib/composio/catalog";
import { can } from "@/lib/workspace";
import { TOOLS, TOOLS_PRODUCT } from "@/lib/connectFlow";
import type { Connectable } from "@/lib/partner";
import { callApi, getApi, message } from "./nav";
import { useStartConnect } from "./Social";
import type { Workspace } from "./Settings";
import { ErrorText, input, Notice } from "./ui";

type Conn = { id: string; toolkit: string; status: "active" | "reconnect"; label: string | null };
type WpConn = { site: string; login: string; status: "active" | "reconnect" };
type List = { on: boolean; connectable: string[]; connections: Conn[]; wordpress?: WpConn | null };

/** The line the way back from the sign-in page left in the address, read once and then cleared. */
function useReturnNote() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const app = q.get("app");
    if (!app) return;
    const toolkit = q.get("toolkit") ?? "";
    // Reading the address once on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(app === "connected" && isAppId(toolkit) ? { ok: true, text: APP_MESSAGES.connected(appName(toolkit)) } : { ok: false, text: (q.get("reason") ?? APP_MESSAGES.failed).slice(0, 200) });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return note;
}

export function AppsSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const admin = can(ws.role, "connectApps");
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [asking, setAsking] = useState("");
  const returned = useReturnNote();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const note = said ?? returned;

  const load = useCallback(async () => {
    try {
      setList(await callApi<List>(sb, "/api/apps/list", { workspaceId: ws.id }));
    } catch (e) {
      setError(message(e));
    }
  }, [sb, ws.id]);
  useEffect(() => {
    // Loading from the server on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const connect = async (toolkit: string) => {
    setError("");
    setBusy(toolkit);
    try {
      const { url } = await callApi<{ url: string }>(sb, "/api/apps/connect", { workspaceId: ws.id, toolkit });
      window.location.assign(url);
    } catch (e) {
      setError(message(e));
      setBusy("");
    }
  };
  const disconnect = async (c: Conn) => {
    setError("");
    setBusy(c.toolkit);
    try {
      await callApi(sb, "/api/apps/disconnect", { workspaceId: ws.id, id: c.id });
      setAsking("");
      await load();
    } catch (e) {
      setError(message(e));
    }
    setBusy("");
  };

  const wpConnect = async (site: string) => {
    setError("");
    setBusy("wordpress");
    try {
      const { url } = await callApi<{ url: string }>(sb, "/api/apps/wordpress", { workspaceId: ws.id, action: "connect", site });
      window.location.assign(url);
    } catch (e) {
      setError(message(e));
      setBusy("");
    }
  };
  const wpDisconnect = async () => {
    setError("");
    setBusy("wordpress");
    try {
      const out = await callApi<{ note?: string }>(sb, "/api/apps/wordpress", { workspaceId: ws.id, action: "disconnect" });
      setAsking("");
      if (out.note) setSaid({ ok: true, text: out.note });
      await load();
    } catch (e) {
      setError(message(e));
    }
    setBusy("");
  };

  return (
    <>
      <div className="sh">
        <h2>Apps</h2>
      </div>
      <p className="hint-s mb-3">
        {admin ? "Connect the apps your business already uses, so your team can work in them. Changes wait for your OK." : "The apps your team can work in. Owners and admins can connect more."}
      </p>
      {note ? note.ok ? <Notice>{note.text}</Notice> : <ErrorText>{note.text}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {list && !list.on ? <Notice>{APP_MESSAGES.off}</Notice> : null}
      {list === null && !error ? <div className="card empty">Loading...</div> : null}
      {list
        ? GROUPS.map((g) => {
            const apps = APPS.filter((a) => a.group === g.id);
            return (
              <section key={g.id} className="app-grp">
                <h3 className="grp-h">{g.label}</h3>
                <div className="card list">
                  {apps.map((a) => (
                    <AppRow
                      key={a.toolkit}
                      app={a}
                      conn={list.connections.find((c) => c.toolkit === a.toolkit) ?? null}
                      ready={list.on && list.connectable.includes(a.toolkit)}
                      admin={admin}
                      busy={busy === a.toolkit}
                      asking={asking === a.toolkit}
                      onConnect={() => connect(a.toolkit)}
                      onAsk={(yes) => setAsking(yes ? a.toolkit : "")}
                      onDisconnect={(c) => disconnect(c)}
                    />
                  ))}
                  {g.id === DIRECT.wordpress.group ? (
                    <WordpressRow
                      conn={list.wordpress ?? null}
                      admin={admin}
                      busy={busy === "wordpress"}
                      asking={asking === "wordpress"}
                      onConnect={wpConnect}
                      onAsk={(yes) => setAsking(yes ? "wordpress" : "")}
                      onDisconnect={wpDisconnect}
                    />
                  ) : null}
                </div>
              </section>
            );
          })
        : null}
      {admin ? <ToolsSection sb={sb} ws={ws} /> : null}
    </>
  );
}

function AppRow(p: { app: AppEntry; conn: Conn | null; ready: boolean; admin: boolean; busy: boolean; asking: boolean; onConnect: () => void; onAsk: (yes: boolean) => void; onDisconnect: (c: Conn) => void }) {
  const { app, conn } = p;
  return (
    <div className="row wrap-row">
      {/* Composio's logo for the app. Small, and only shown here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appLogo(app.toolkit)} alt="" width={32} height={32} className="lg-img" />
      <span className="main">
        <b>{app.name}</b>
        <small className="wrap">{conn?.label ? `Connected as ${conn.label}` : app.blurb}</small>
      </span>
      <span className="row-act">
        {conn?.status === "reconnect" ? <span className="pillst error">Needs you to sign in again</span> : null}
        {conn?.status === "active" ? <span className="pillst ok">Connected</span> : null}
        {!conn && !p.ready ? <span className="pillst off">Not available yet</span> : null}
        {p.admin && conn && p.asking ? (
          <>
            <span className="text-[13px] text-ink-2">Disconnect {app.name}? Your team can&apos;t use it after this.</span>
            <button type="button" className="btn sm danger" onClick={() => p.onDisconnect(conn)} disabled={p.busy}>
              {p.busy ? "Disconnecting..." : "Yes, disconnect"}
            </button>
            <button type="button" className="btn sm" onClick={() => p.onAsk(false)} disabled={p.busy}>
              Keep it
            </button>
          </>
        ) : null}
        {p.admin && conn && !p.asking ? (
          <>
            {conn.status === "reconnect" && p.ready ? (
              <button type="button" className="btn sm" onClick={p.onConnect} disabled={p.busy}>
                {p.busy ? "Opening..." : "Reconnect"}
              </button>
            ) : null}
            <button type="button" className="btn sm ghost" onClick={() => p.onAsk(true)} disabled={p.busy}>
              Disconnect
            </button>
          </>
        ) : null}
        {p.admin && !conn && p.ready ? (
          <button type="button" className="btn sm" onClick={p.onConnect} disabled={p.busy}>
            {p.busy ? "Opening..." : "Connect"}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * SEO tools Artemis reads, like Cloudflare for which AI tools visit the site. Owners and admins sign in on the tool's
 * own page, and it comes back here through /settings/social/return. Hidden until there is a tool to connect.
 */
function ToolsSection({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [tools, setTools] = useState<Connectable[]>([]);
  const { start, busy, error } = useStartConnect(sb, ws.id);
  useEffect(() => {
    let live = true;
    getApi<{ mode: string; integrations: Connectable[] }>(sb, `/api/seo/integrations?${new URLSearchParams({ workspaceId: ws.id })}`).then(
      (r) => live && setTools(r.mode === "branded" ? (r.integrations ?? []) : []),
      () => live && setTools([]),
    );
    return () => {
      live = false;
    };
  }, [sb, ws.id]);
  if (!tools.length) return null;
  return (
    <section className="app-grp">
      <h3 className="grp-h">SEO tools</h3>
      <div className="card list">
        {tools.map((t) => (
          <div key={t.id} className="row wrap-row">
            {TOOLS[t.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={TOOLS[t.id].logo} alt="" width={32} height={32} className="lg-img" />
            ) : (
              <span className="ini">{t.name[0]}</span>
            )}
            <span className="main">
              <b>{t.name}</b>
              {TOOLS[t.id] ? <small className="wrap">{TOOLS[t.id].blurb}</small> : null}
            </span>
            <span className="row-act">
              <button type="button" className="btn sm" onClick={() => start(t.id, "branded", { to: "settings" }, TOOLS_PRODUCT)} disabled={Boolean(busy)}>
                {busy === t.id ? "Opening..." : `Connect ${t.name}`}
              </button>
            </span>
          </div>
        ))}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </section>
  );
}

/** The owner's own WordPress site: the site's address and Connect, or who it is connected as. */
function WordpressRow(p: { conn: WpConn | null; admin: boolean; busy: boolean; asking: boolean; onConnect: (site: string) => void; onAsk: (yes: boolean) => void; onDisconnect: () => void }) {
  const { conn } = p;
  const app = DIRECT.wordpress;
  const [site, setSite] = useState("");
  const form = p.admin && (!conn || conn.status === "reconnect") && !p.asking;
  return (
    <div className="row wrap-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appLogo(app.id)} alt="" width={32} height={32} className="lg-img" />
      <span className="main">
        <b>{app.name}</b>
        <small className="wrap">{conn ? `${conn.site}, as ${conn.login}` : app.blurb}</small>
      </span>
      <span className="row-act">
        {conn?.status === "reconnect" ? <span className="pillst error">Needs you to connect again</span> : null}
        {conn?.status === "active" ? <span className="pillst ok">Connected</span> : null}
        {form ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              p.onConnect(site || conn?.site || "");
            }}
          >
            <input className={input} aria-label="Your WordPress site's address" placeholder={conn?.site ?? "yourbusiness.com"} value={site} onChange={(e) => setSite(e.target.value)} maxLength={300} />
            <button type="submit" className="btn sm" disabled={p.busy || (!site.trim() && !conn)}>
              {p.busy ? "Opening..." : conn ? "Connect again" : "Connect WordPress"}
            </button>
          </form>
        ) : null}
        {p.admin && conn && p.asking ? (
          <>
            <span className="text-[13px] text-ink-2">Disconnect WordPress? Your team can&apos;t use it after this.</span>
            <button type="button" className="btn sm danger" onClick={p.onDisconnect} disabled={p.busy}>
              {p.busy ? "Disconnecting..." : "Yes, disconnect"}
            </button>
            <button type="button" className="btn sm" onClick={() => p.onAsk(false)} disabled={p.busy}>
              Keep it
            </button>
          </>
        ) : null}
        {p.admin && conn && !p.asking ? (
          <button type="button" className="btn sm ghost" onClick={() => p.onAsk(true)} disabled={p.busy}>
            Disconnect
          </button>
        ) : null}
      </span>
    </div>
  );
}
