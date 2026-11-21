"use client";

// Connecting social accounts on our own pages: Settings, Social accounts (the accounts and a grid of networks), the
// small chooser that Home's Finish setup and a chat's connect card open, and the return page the network's sign-in
// comes back to (/settings/social/return). The server side is src/lib/partnerConnect.ts.
// The list reads social_channels as the signed-in person, so row level security decides what they see.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Connectable, Product } from "@/lib/partner";
import { openIn, startRequest, type ConnectOrigin, type ReturnView } from "@/lib/connectFlow";
import { networkLogo, networkName, sameNetwork, sortChannels, type SocialChannel } from "@/lib/socialChannels";
import { can } from "@/lib/workspace";
import { callApi, getApi, message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Mode = "branded" | "link";

/** The networks this workspace can connect, and which way ("link" is the older connect page, in a new tab). */
export function useNetworks(sb: SupabaseClient, workspaceId: string, enabled = true) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [networks, setNetworks] = useState<Connectable[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getApi<{ mode: Mode; networks: Connectable[] }>(sb, `/api/social/networks?${new URLSearchParams({ workspaceId })}`).then(
      (r) => {
        if (!live) return;
        setMode(r.mode);
        setNetworks(r.networks ?? []);
      },
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [sb, workspaceId, enabled]);
  return { mode, networks, error };
}

/**
 * Starts one network's (or SEO tool's) sign-in. A chat (and the older connect page) opens it in a new tab, opened on
 * the click so pop-up blockers let it through; Settings and Home go there in this tab and come back to the return page.
 */
export function useStartConnect(sb: SupabaseClient, workspaceId: string) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const start = useCallback(
    async (network: string, mode: Mode, from: ConnectOrigin, product?: Product): Promise<boolean> => {
      setError("");
      setBusy(network || "any");
      const tab = openIn(mode, from) === "tab" ? window.open("", "_blank") : null;
      const req = startRequest(product, workspaceId, network, from);
      try {
        const { url } = await callApi<{ url: string; mode: Mode }>(sb, req.path, req.body);
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
          setBusy("");
        } else window.location.assign(url);
        return true;
      } catch (e) {
        tab?.close();
        setError(message(e));
        setBusy("");
        return false;
      }
    },
    [sb, workspaceId],
  );
  return { start, busy, error };
}

/** The network's logo, or its first letter when we have none. */
export function NetworkMark({ network, size = 20 }: { network: string; size?: number }) {
  const src = networkLogo(network);
  if (!src) return <span className="netmark ini" style={{ width: size, height: size, fontSize: Math.round(size / 2) }}>{networkName(network)[0]}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className="netmark" />;
}

/**
 * The grid of networks to connect. In "link" mode (the partner doesn't list networks yet) it is one button that
 * opens the older connect page in a new tab.
 */
export function NetworkChooser({ sb, ws, from, onOpened }: { sb: SupabaseClient; ws: Workspace; from: ConnectOrigin; onOpened?: (network: string, mode: Mode) => void }) {
  const { mode, networks, error: loadError } = useNetworks(sb, ws.id);
  const { start, busy, error } = useStartConnect(sb, ws.id);
  const go = async (network: string) => {
    if (!mode) return;
    if (await start(network, mode, from)) onOpened?.(network, mode);
  };
  return (
    <div className="netchoose">
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {!mode && !loadError ? <div className="empty">Loading...</div> : null}
      {mode === "link" ? (
        <button type="button" className="btn primary sm" onClick={() => go("")} disabled={Boolean(busy)}>
          {busy ? "Opening..." : "Connect social accounts"}
        </button>
      ) : null}
      {mode === "branded" ? (
        <div className="netgrid" role="list">
          {networks.map((n) => (
            <button key={n.id} type="button" role="listitem" className="netbtn" onClick={() => go(n.id)} disabled={Boolean(busy)} aria-label={`Connect ${n.name}`}>
              <NetworkMark network={n.id} size={22} />
              <span className="wrap">{busy === n.id ? "Opening..." : n.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

/** The chooser in a side sheet, for Home. */
export function NetworkChooserSheet({ sb, ws, open, onClose }: { sb: SupabaseClient; ws: Workspace; open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} title="Connect a social account" onClose={onClose}>
      <p className="hint-s mb-3">Pick a network. You sign in on its own page, then come back here.</p>
      <NetworkChooser sb={sb} ws={ws} from={{ to: "home" }} />
    </Drawer>
  );
}

/** The workspace's channels, loaded again when the tab comes back into view and a few times after a sign-in. */
function useChannels(sb: SupabaseClient, workspaceId: string) {
  const [rows, setRows] = useState<SocialChannel[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await sb.from("social_channels").select("channel_id, network, name, status, updated_at").eq("workspace_id", workspaceId);
    if (error) return setError("We couldn't load your accounts. Try again.");
    setError("");
    setRows(sortChannels((data ?? []) as SocialChannel[]));
  }, [sb, workspaceId]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const again = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", again);
    // A new account can take a few seconds to arrive after the sign-in comes back here.
    let n = 0;
    const t = setInterval(() => (++n > 6 ? clearInterval(t) : load()), 5000);
    return () => {
      document.removeEventListener("visibilitychange", again);
      clearInterval(t);
    };
  }, [load]);
  return { rows, error, load };
}

/** The partner's id for a channel's network ("linkedin_page" is "linkedin-page" in the list). */
const listId = (networks: readonly Connectable[], network: string) => networks.find((n) => sameNetwork(n.id, network))?.id ?? network;

/** Home: a card when connected accounts need a new sign-in. Connecting the first ones is in Finish setup. */
export function ConnectSocialCard({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const { rows } = useChannels(sb, ws.id);
  const [open, setOpen] = useState(false);
  if (!can(ws.role, "connectSocial") || rows === null) return null;
  const lost = rows.filter((r) => r.status === "lost").length;
  if (!lost) return null;
  return (
    <section className="sec">
      <div className="card list">
        <div className="row">
          <span className="main">
            <b>Reconnect your social accounts</b>
            <small className="wrap">{lost === 1 ? "One account needs" : `${lost} accounts need`} you to sign in again so Aphrodite can keep posting.</small>
          </span>
          <button type="button" className="btn sm" onClick={() => setOpen(true)}>
            Reconnect
          </button>
        </div>
      </div>
      <NetworkChooserSheet sb={sb} ws={ws} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

const OPENED = "We opened the sign-in in a new tab. Your accounts show up here when you're done.";

/** Settings: every connected account, with Reconnect on the ones that were lost, and the networks to add. */
export function SocialSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const admin = can(ws.role, "connectSocial");
  const { rows, error: loadError } = useChannels(sb, ws.id);
  const nets = useNetworks(sb, ws.id, admin);
  const { start, busy, error } = useStartConnect(sb, ws.id);
  const [opened, setOpened] = useState(false);
  const reconnect = async (network: string) => {
    if (!nets.mode) return;
    if ((await start(nets.mode === "link" ? "" : listId(nets.networks, network), nets.mode, { to: "settings" })) && nets.mode === "link") setOpened(true);
  };
  return (
    <>
      <div className="sh">
        <h2>Social accounts</h2>
      </div>
      <p className="hint-s mb-3">{admin ? "The accounts Aphrodite posts to. You sign in to each one on the network's own page." : "The accounts Aphrodite posts to. Admins and the owner can connect more."}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {opened ? <Notice>{OPENED}</Notice> : null}
      <div className="card list">
        {(rows ?? []).map((c) => (
          <div key={c.channel_id} className="row">
            <NetworkMark network={c.network} size={30} />
            <span className="main">
              <b>{networkName(c.network)}</b>
              {c.name ? <small className="wrap">{c.name}</small> : null}
            </span>
            {c.status === "lost" ? (
              <>
                <span className="pillst error">Needs you to sign in again</span>
                {admin ? (
                  <button type="button" className="btn sm" onClick={() => reconnect(c.network)} disabled={Boolean(busy) || !nets.mode}>
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
      {admin ? (
        <section className="mt-5">
          <div className="sh">
            <h2>Add an account</h2>
          </div>
          <NetworkChooser sb={sb} ws={ws} from={{ to: "settings" }} onOpened={(_, mode) => mode === "link" && setOpened(true)} />
        </section>
      ) : null}
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

// ─────────────── the return page ───────────────

type PickOption = { id: string; name: string; picture: string | null };

/** The address's params, as the return route reads them. */
function returnParams(): { state: string; query: Record<string, string> } {
  const q = new URLSearchParams(window.location.search);
  return { state: q.get("state") ?? "", query: Object.fromEntries(q.entries()) };
}

/**
 * Where a network's sign-in comes back to. Connected: back to where the person started, with one line. Error: the
 * reason and Try again. Pick: choose the pages or accounts to connect. A chat's sign-in opened in a new tab, and the
 * chat carries on in the first tab once the account shows up, so this tab closes itself.
 */
export function SocialReturn({ sb, ws, onPick, onNotice }: { sb: SupabaseClient; ws: Workspace; onPick: (id: string) => void; onNotice: (text: string) => void }) {
  const [{ state, query }] = useState(returnParams);
  const [view, setView] = useState<ReturnView | null>(null);
  const [wsId, setWsId] = useState(ws.id);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { start, busy: starting, error: startError } = useStartConnect(sb, wsId);

  const finish = useCallback(
    (v: Extract<ReturnView, { kind: "connected" }>, workspaceId: string) => {
      setView(v);
      if (v.chat) {
        // The chat in the first tab carries on by itself. Close this one, or go back to the chat if the browser won't.
        setTimeout(() => {
          window.close();
          navigate(v.back, true);
        }, 1500);
        return;
      }
      if (workspaceId !== ws.id) onPick(workspaceId);
      onNotice(`${v.title}.`);
      navigate(v.back, true);
    },
    [ws.id, onPick, onNotice],
  );

  useEffect(() => {
    let live = true;
    callApi<{ workspaceId: string; view: ReturnView }>(sb, "/api/connect/return", { state, query }).then(
      (r) => {
        if (!live) return;
        setWsId(r.workspaceId);
        if (r.view.kind === "connected") return finish(r.view, r.workspaceId);
        setView(r.view);
        if (r.view.kind === "pick")
          getApi<{ options: PickOption[] }>(sb, `/api/social/connect/pick/${encodeURIComponent(r.view.token)}?${new URLSearchParams({ state, workspaceId: r.workspaceId })}`).then(
            (p) => live && setOptions(p.options),
            (e) => live && setError(message(e)),
          );
      },
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
    // Runs once for the address this page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectPicked = async () => {
    if (view?.kind !== "pick" || !picked.length) return;
    setBusy(true);
    setError("");
    try {
      const r = await callApi<{ view: Extract<ReturnView, { kind: "connected" }> }>(sb, `/api/social/connect/pick/${encodeURIComponent(view.token)}`, { state, workspaceId: wsId, ids: picked });
      finish(r.view, wsId);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const back = view?.back ?? "/settings/social";
  return (
    <div className="netret">
      <div className="sh">
        <h2>{view?.kind === "pick" ? `Pick your ${view.name} pages` : view?.kind === "connected" ? view.title : "Social accounts"}</h2>
      </div>
      {!view && !error ? <div className="empty">Loading...</div> : null}
      {view?.kind === "connected" ? <Notice>You can close this tab. The chat carries on in the other one.</Notice> : null}
      {view?.kind === "error" ? (
        <div className="card pad">
          <div className="netret-h">
            <NetworkMark network={view.item} size={28} />
            <span className="wrap">{view.text}</span>
          </div>
          <div className="netret-b">
            {view.retry ? (
              <button type="button" className="btn primary sm" onClick={() => start(view.item, "branded", view.from, view.product)} disabled={Boolean(starting)}>
                {starting ? "Opening..." : "Try again"}
              </button>
            ) : null}
            <button type="button" className="btn sm" onClick={() => navigate(back)}>
              Back
            </button>
          </div>
        </div>
      ) : null}
      {view?.kind === "pick" ? (
        <div className="card list">
          {options === null && !error ? <div className="empty">Loading...</div> : null}
          {options?.length === 0 ? <Empty title="Nothing to pick">We didn&apos;t find a page or account you can post to.</Empty> : null}
          {(options ?? []).map((o) => (
            <label key={o.id} className="row netpick">
              <input
                type="checkbox"
                checked={picked.includes(o.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))}
              />
              {o.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.picture} alt="" width={32} height={32} className="netpick-pic" referrerPolicy="no-referrer" />
              ) : (
                <span className="ini">{o.name[0]}</span>
              )}
              <span className="main">
                <b className="wrap">{o.name}</b>
              </span>
            </label>
          ))}
          {options?.length ? (
            <div className="row">
              <button type="button" className="btn primary sm" onClick={connectPicked} disabled={busy || !picked.length}>
                {busy ? "Connecting..." : "Connect selected"}
              </button>
              <button type="button" className="btn sm ghost" onClick={() => navigate(back)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <p className="hint-s mt-3">
            <button type="button" className="link-u" onClick={() => navigate(back)}>
              Back
            </button>
          </p>
        </>
      ) : null}
      {startError ? <ErrorText>{startError}</ErrorText> : null}
    </div>
  );
}
