"use client";

// Settings, Apps: the business's own apps (Gmail, Outlook, HubSpot and more) that the AI team can use. Owners and
// admins connect each one in one click: Composio's sign-in page opens, and it comes back here
// (POST /api/apps/connect, GET /api/apps/composio). Nobody pastes a key. Shaped like Omniscient's Settings, Apps.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { APP_MESSAGES, appLogo, appName, APPS, GROUPS, isToolkit, type AppEntry } from "@/lib/composio/catalog";
import { can } from "@/lib/workspace";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { btnPrimary, btnSmall, card, ErrorText, Notice } from "./ui";

type Conn = { id: string; toolkit: string; status: "active" | "reconnect"; label: string | null };
type List = { on: boolean; connectable: string[]; connections: Conn[] };

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
    setNote(app === "connected" && isToolkit(toolkit) ? { ok: true, text: APP_MESSAGES.connected(appName(toolkit)) } : { ok: false, text: (q.get("reason") ?? APP_MESSAGES.failed).slice(0, 200) });
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
  const note = useReturnNote();

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

  return (
    <section className={card}>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold">Apps</h2>
        <p className="text-[14px] text-ink-3">
          {admin ? "Connect the apps your business already uses, so your team can work in them. Changes wait for your OK." : "The apps your team can work in. Owners and admins can connect more."}
        </p>
      </div>
      {note ? note.ok ? <Notice>{note.text}</Notice> : <ErrorText>{note.text}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {list && !list.on ? <Notice>{APP_MESSAGES.off}</Notice> : null}
      {list === null && !error ? <p className="text-[14px] text-ink-4">Loading...</p> : null}
      {list
        ? GROUPS.map((g) => {
            const apps = APPS.filter((a) => a.group === g.id);
            return (
              <div key={g.id} className="flex flex-col">
                <h3 className="text-[13px] font-medium text-ink-3">{g.label}</h3>
                <ul className="flex flex-col divide-y divide-line">
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
                </ul>
              </div>
            );
          })
        : null}
    </section>
  );
}

function AppRow(p: { app: AppEntry; conn: Conn | null; ready: boolean; admin: boolean; busy: boolean; asking: boolean; onConnect: () => void; onAsk: (yes: boolean) => void; onDisconnect: (c: Conn) => void }) {
  const { app, conn } = p;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex min-w-0 items-start gap-3">
        {/* Composio's logo for the app. Small, and only shown here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={appLogo(app.toolkit)} alt="" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-[7px] bg-sunk object-contain" />
        <span className="flex min-w-0 flex-col">
          <strong className="text-[15px] font-semibold">{app.name}</strong>
          <span className="break-words text-[14px] text-ink-3">{conn?.label ? `Connected as ${conn.label}` : app.blurb}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 sm:justify-end">
        {conn?.status === "reconnect" ? <span className="rounded-full bg-[#fbeae4] px-2.5 py-1 text-[13px] text-red">Needs you to sign in again</span> : null}
        {conn?.status === "active" ? <span className="rounded-full bg-sunk px-2.5 py-1 text-[13px] text-ink-2">Connected</span> : null}
        {!conn && !p.ready ? <span className="text-[13px] text-ink-4">Not available yet</span> : null}
        {p.admin && conn && p.asking ? (
          <>
            <span className="text-[14px] text-ink-2">Disconnect {app.name}? Your team can&apos;t use it after this.</span>
            <button type="button" className={btnSmall} onClick={() => p.onDisconnect(conn)} disabled={p.busy}>
              {p.busy ? "Disconnecting..." : "Yes, disconnect"}
            </button>
            <button type="button" className={btnSmall} onClick={() => p.onAsk(false)} disabled={p.busy}>
              Keep it
            </button>
          </>
        ) : null}
        {p.admin && conn && !p.asking ? (
          <>
            {conn.status === "reconnect" && p.ready ? (
              <button type="button" className={btnSmall} onClick={p.onConnect} disabled={p.busy}>
                {p.busy ? "Opening..." : "Reconnect"}
              </button>
            ) : null}
            <button type="button" className={btnSmall} onClick={() => p.onAsk(true)} disabled={p.busy}>
              Disconnect
            </button>
          </>
        ) : null}
        {p.admin && !conn && p.ready ? (
          <button type="button" className={`${btnPrimary} h-9 text-[14px] sm:w-auto`} onClick={p.onConnect} disabled={p.busy}>
            {p.busy ? "Opening..." : `Connect ${app.name}`}
          </button>
        ) : null}
      </span>
    </li>
  );
}
