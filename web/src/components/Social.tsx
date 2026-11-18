"use client";

// Connecting social accounts: the Home card and the Settings tab. The customer signs in to each network on a
// one-time Capybaroar page (POST /api/social/connect-link), and Capybaroar tells our server when it's done.
// The list reads social_channels as the signed-in person, so row level security decides what they see.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { networkName, sortChannels, type SocialChannel } from "@/lib/socialChannels";
import { can } from "@/lib/workspace";
import { callApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Empty, ErrorText, Notice } from "./ui";

/** Opens the connect page in a new tab. The tab opens on the click, so pop-up blockers let it through. */
export function useConnect(sb: SupabaseClient, workspaceId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const connect = useCallback(async () => {
    setError("");
    setOpened(false);
    setBusy(true);
    const tab = window.open("", "_blank");
    try {
      const { url } = await callApi<{ url: string }>(sb, "/api/social/connect-link", { workspaceId });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
        setOpened(true);
      } else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setError(message(err));
    }
    setBusy(false);
  }, [sb, workspaceId]);
  return { connect, busy, error, opened };
}

/** The workspace's channels, loaded again when the tab comes back into view (after connecting in the other tab). */
function useChannels(sb: SupabaseClient, workspaceId: string) {
  const [rows, setRows] = useState<SocialChannel[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await sb.from("social_channels").select("channel_id, network, name, status, updated_at").eq("workspace_id", workspaceId);
    if (error) return setError(/social_channels/.test(error.message) ? "" : error.message);
    setError("");
    setRows(sortChannels((data ?? []) as SocialChannel[]));
  }, [sb, workspaceId]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const again = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);
  return { rows, error, load };
}

const OPENED = "We opened the connect page in a new tab. Sign in to each account there. They show up here when you're done.";

/** Home: a card when connected accounts need a new sign-in. Connecting the first ones is in Finish setup. */
export function ConnectSocialCard({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const { connect, busy, error, opened } = useConnect(sb, ws.id);
  const { rows } = useChannels(sb, ws.id);
  if (!can(ws.role, "connectSocial") || rows === null) return null;
  const lost = rows.filter((r) => r.status === "lost").length;
  if (!lost && !opened && !error) return null;
  return (
    <section className="sec">
      <div className="card list">
        <div className="row">
          <span className="main">
            <b>Reconnect your social accounts</b>
            <small className="wrap">{lost === 1 ? "One account needs" : `${lost} accounts need`} you to sign in again so Aphrodite can keep posting.</small>
          </span>
          <button type="button" className="btn sm" onClick={connect} disabled={busy}>
            {busy ? "Opening..." : "Reconnect"}
          </button>
        </div>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {opened ? <Notice>{OPENED}</Notice> : null}
    </section>
  );
}

/** Settings: every connected account, with Reconnect on the ones that were lost. */
export function SocialSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const editor = can(ws.role, "connectSocial");
  const { connect, busy, error, opened } = useConnect(sb, ws.id);
  const { rows, error: loadError } = useChannels(sb, ws.id);
  return (
    <>
      <div className="sh">
        <h2>Social accounts</h2>
        {editor ? (
          <button type="button" className="btn primary sm" onClick={connect} disabled={busy}>
            {busy ? "Opening..." : "Connect social accounts"}
          </button>
        ) : null}
      </div>
      <p className="hint-s mb-3">{editor ? "The accounts Aphrodite posts to. You sign in to each one on a secure page." : "The accounts Aphrodite posts to. Editors and up can connect more."}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {opened ? <Notice>{OPENED}</Notice> : null}
      <div className="card list">
        {(rows ?? []).map((c) => (
          <div key={c.channel_id} className="row">
            <span className="ini">{networkName(c.network)[0]}</span>
            <span className="main">
              <b>{networkName(c.network)}</b>
              {c.name ? <small>{c.name}</small> : null}
            </span>
            {c.status === "lost" ? (
              <>
                <span className="pillst error">Needs you to sign in again</span>
                {editor ? (
                  <button type="button" className="btn sm" onClick={connect} disabled={busy}>
                    Reconnect
                  </button>
                ) : null}
              </>
            ) : (
              <span className="pillst ok">Connected</span>
            )}
          </div>
        ))}
        {rows === null && !loadError ? <div className="empty">Loading...</div> : null}
        {rows?.length === 0 ? <Empty title="No social accounts yet">Connect Instagram, Facebook, LinkedIn and more.</Empty> : null}
      </div>
      {rows?.length ? (
        <p className="hint-s mt-3">
          <button type="button" className="link-u" onClick={() => navigate("/team/social")}>
            See what Aphrodite does
          </button>
        </p>
      ) : null}
    </>
  );
}
