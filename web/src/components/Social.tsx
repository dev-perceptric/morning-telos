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
import { btnPrimary, btnSmall, card, ErrorText, Notice } from "./ui";

/** Opens the connect page in a new tab. The tab opens on the click, so pop-up blockers let it through. */
function useConnect(sb: SupabaseClient, workspaceId: string) {
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

/** Home: a short card for editors to connect their accounts. Hidden once they're all connected. */
export function ConnectSocialCard({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const { connect, busy, error, opened } = useConnect(sb, ws.id);
  const { rows } = useChannels(sb, ws.id);
  if (!can(ws.role, "connectSocial") || rows === null) return null;
  const lost = rows.filter((r) => r.status === "lost").length;
  const connected = rows.length - lost;
  if (connected && !lost && !opened && !error) return null;
  return (
    <section className={card}>
      <div>
        <h2 className="text-[18px] font-semibold">{lost ? "Reconnect your social accounts" : "Connect social accounts"}</h2>
        <p className="text-[14px] text-ink-3">
          {lost
            ? `${lost === 1 ? "One account needs" : `${lost} accounts need`} you to sign in again so Aphrodite can keep posting.`
            : "Link Instagram, Facebook, LinkedIn and more, so Aphrodite can post for you. You don't need a new account."}
        </p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {opened ? <Notice>{OPENED}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${btnPrimary} sm:w-auto`} onClick={connect} disabled={busy}>
          {busy ? "Opening..." : lost ? "Reconnect" : "Connect social accounts"}
        </button>
        {rows.length ? (
          <button type="button" className="text-[14px] font-medium text-ink-3 hover:text-ink" onClick={() => navigate("/settings/social")}>
            See your accounts
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Settings: every connected account, with Reconnect on the ones that were lost. */
export function SocialSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const editor = can(ws.role, "connectSocial");
  const { connect, busy, error, opened } = useConnect(sb, ws.id);
  const { rows, error: loadError } = useChannels(sb, ws.id);
  return (
    <section className={card}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold">Social accounts</h2>
          <p className="text-[14px] text-ink-3">{editor ? "The accounts Aphrodite posts to. You sign in to each one on a secure page." : "The accounts Aphrodite posts to. Editors and up can connect more."}</p>
        </div>
        {editor ? (
          <button type="button" className={`${btnPrimary} sm:w-auto sm:shrink-0`} onClick={connect} disabled={busy}>
            {busy ? "Opening..." : "Connect social accounts"}
          </button>
        ) : null}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {opened ? <Notice>{OPENED}</Notice> : null}
      <ul className="flex flex-col divide-y divide-line">
        {(rows ?? []).map((c) => (
          <li key={c.channel_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words text-[15px]">
              <strong className="font-semibold">{networkName(c.network)}</strong>
              {c.name ? <span className="text-ink-3"> {c.name}</span> : null}
            </span>
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              {c.status === "lost" ? (
                <>
                  <span className="rounded-full bg-[#fbeae4] px-2.5 py-1 text-[13px] text-red">Needs you to sign in again</span>
                  {editor ? (
                    <button type="button" className={btnSmall} onClick={connect} disabled={busy}>
                      Reconnect
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="rounded-full bg-sunk px-2.5 py-1 text-[13px] text-ink-2">Connected</span>
              )}
            </span>
          </li>
        ))}
        {rows === null && !loadError ? <li className="py-3 text-[14px] text-ink-4">Loading...</li> : null}
        {rows?.length === 0 ? <li className="py-3 text-[14px] text-ink-4">No social accounts yet.</li> : null}
      </ul>
    </section>
  );
}
