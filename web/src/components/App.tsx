"use client";

// The whole client app: the sign-in screens, then the app shell with its pages: Home (talk to the team), a chat,
// Team and Settings. Billing (P1.6) plugs in here.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { setupCard, type SetupCard } from "@/lib/setupStatus";
import { cleanWebsite } from "@/lib/signup";
import { inviteTokenFromPath, roleLabel } from "@/lib/workspace";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { message, navigate, readLocal, useRoute, writeLocal } from "./nav";
import { SettingsPage, type Workspace } from "./Settings";
import { ConnectSocialCard } from "./Social";
import { TeamHome, TeamPage, ThreadPage } from "./Team";
import { AGENTS } from "@/lib/team";
import { btnPrimary, btnSecondary, ErrorText, Frame, input, label, Logo, Notice } from "./ui";

// An invite token waits here from the moment the link is opened until the person is signed in.
const INVITE_KEY = "mt.invite";
// The workspace on screen, for people in more than one.
const WS_KEY = "mt.workspace";
const NOTICE_KEY = "mt.notice";

export function App({ supabase, turnstileSiteKey, google = false }: { supabase: SupaConfig; turnstileSiteKey: string | null; google?: boolean }) {
  const sb = getSupabase(supabase);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);
  // Read once on load: an /invite/<token> link, or one saved before a sign-in redirect.
  const [invite, setInvite] = useState<string | null>(() => {
    const fromPath = inviteTokenFromPath(window.location.pathname);
    if (fromPath) writeLocal(INVITE_KEY, fromPath);
    return fromPath ?? readLocal(INVITE_KEY);
  });

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const clearInvite = useCallback(() => {
    writeLocal(INVITE_KEY, null);
    setInvite(null);
  }, []);

  if (session === undefined) return <Loading />;
  if (recovering && session) return <NewPassword sb={sb} onDone={() => setRecovering(false)} />;
  if (!session) return <AuthScreen sb={sb} invited={Boolean(invite)} turnstileSiteKey={turnstileSiteKey} google={google} />;
  if (invite) return <JoinInvite sb={sb} session={session} token={invite} onDone={clearInvite} />;
  return <Shell sb={sb} session={session} />;
}

function Loading() {
  return (
    <main className="grid min-h-screen place-items-center text-[14px] text-ink-4" aria-busy="true">
      Loading...
    </main>
  );
}

/** Signed in with an invite link: join that workspace, then open it. */
function JoinInvite({ sb, session, token, onDone }: { sb: SupabaseClient; session: Session; token: string; onDone: () => void }) {
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    // Accept once, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    sb.rpc("accept_invite", { p_token: token }).then(({ data, error }) => {
      if (error) return setError(message(error));
      writeLocal(WS_KEY, String(data));
      writeLocal(NOTICE_KEY, "You joined the team. Welcome!");
      navigate("/", true);
      onDone();
    });
  }, [sb, token, onDone]);

  if (!error) return <Loading />;
  const wrongEmail = /Sign in with that email/.test(error);
  return (
    <Frame>
      <div>
        <h1 className="font-serif text-[26px] leading-tight">This invite didn&apos;t work</h1>
        <p className="mt-1 text-[15px] text-ink-3">You are logged in as {session.user.email}.</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-3">
        {wrongEmail ? (
          <button type="button" className={btnPrimary} onClick={() => sb.auth.signOut()}>
            Log out and use the invited email
          </button>
        ) : null}
        <button
          type="button"
          className={wrongEmail ? btnSecondary : btnPrimary}
          onClick={() => {
            navigate("/", true);
            onDone();
          }}
        >
          Go to my workspace
        </button>
      </div>
    </Frame>
  );
}

/** Signed in: load the person's workspaces. No workspace yet (Google sign-up) means set one up first. */
function Shell({ sb, session }: { sb: SupabaseClient; session: Session }) {
  const route = useRoute();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<string | null>(() => readLocal(WS_KEY));
  // A message left by the screen before (like "You joined the team"). Shown once.
  const [notice, setNotice] = useState(() => readLocal(NOTICE_KEY) ?? "");
  useEffect(() => writeLocal(NOTICE_KEY, null), []);
  // Bump to load the list again (after a change).
  const [version, setVersion] = useState(0);
  // What's typed on Home, the first message of a chat being started, and the chat this tab started (its page keeps
  // streaming while the address changes from /chat to /chat/<id>).
  const [draft, setDraft] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [ownThread, setOwnThread] = useState<string | null>(null);
  const startChat = useCallback((text: string) => {
    setDraft("");
    setOwnThread(null);
    setStart(text);
    navigate("/chat");
  }, []);
  const started = useCallback(() => setStart(null), []);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    sb.from("workspace_members")
      .select("role, created_at, workspace:workspaces(id, name, website, timezone, plan, trial_ends_at)")
      .eq("user_id", session.user.id)
      .order("created_at")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setError(error.message);
        const rows = (data ?? []) as unknown as { role: Workspace["role"]; workspace: Omit<Workspace, "role"> | null }[];
        setList(rows.filter((r) => r.workspace).map((r) => ({ ...r.workspace!, role: r.role })));
      });
    return () => {
      live = false;
    };
  }, [sb, session.user.id, version]);

  const pick = useCallback((id: string) => {
    writeLocal(WS_KEY, id);
    setCurrent(id);
  }, []);

  if (error) return <Frame><ErrorText>{error}</ErrorText></Frame>;
  if (!list) return <Loading />;
  if (!list.length) return <SetUpBusiness sb={sb} name={String(session.user.user_metadata?.name ?? "")} notice={notice} onDone={load} />;
  const ws = list.find((w) => w.id === current) ?? list[0];

  const gone = (text: string) => {
    writeLocal(WS_KEY, null);
    setCurrent(null);
    setNotice(text);
    navigate("/");
    load();
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar sb={sb} session={session} list={list} ws={ws} page={route.page} onPick={pick} />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-12">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {notice ? (
            <div className="flex items-start justify-between gap-3 rounded-[10px] bg-clay-bg px-3 py-2 text-[14px] text-ink-2" role="status">
              <span>{notice}</span>
              <button type="button" className="text-ink-4 hover:text-ink" aria-label="Close" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          ) : null}
          {route.page === "settings" ? (
            <SettingsPage sb={sb} ws={ws} userId={session.user.id} tab={route.tab} onChanged={load} onGone={gone} />
          ) : route.page === "thread" ? (
            <ThreadPage
              key={`${ws.id}:${route.id && route.id !== ownThread ? route.id : "new"}`}
              sb={sb}
              ws={ws}
              id={route.id}
              start={route.id ? null : start}
              onStarted={started}
              onThread={setOwnThread}
            />
          ) : route.page === "team" ? (
            <TeamPage
              key={ws.id}
              sb={sb}
              ws={ws}
              onAsk={(k) => {
                setDraft(`@${AGENTS[k].god} `);
                navigate("/");
              }}
            />
          ) : (
            <Home sb={sb} ws={ws} draft={draft} onDraft={setDraft} onStart={startChat} />
          )}
        </div>
      </main>
    </div>
  );
}

function Home({ sb, ws, draft, onDraft, onStart }: { sb: SupabaseClient; ws: Workspace; draft: string; onDraft: (v: string) => void; onStart: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <TeamHome key={ws.id} sb={sb} ws={ws} draft={draft} onDraft={onDraft} onStart={onStart} />
      <SetupStatus key={`setup-${ws.id}`} sb={sb} workspaceId={ws.id} />
      <ConnectSocialCard key={`social-${ws.id}`} sb={sb} ws={ws} />
    </div>
  );
}

/** A small card while the workspace's brands in Arrowsterr and Capybaroar are being set up or wait for the website. Nothing once both are ready. */
function SetupStatus({ sb, workspaceId }: { sb: SupabaseClient; workspaceId: string }) {
  const [card, setCard] = useState<SetupCard | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      sb.rpc("service_status", { ws: workspaceId }).then(({ data, error }) => {
        if (!live) return;
        // Before 006_jobs.sql runs, or on a hiccup, say nothing rather than show an error here.
        const next = error ? null : setupCard((data ?? []) as { status: string }[]);
        setCard(next);
        // Look again while it's working: every 10 seconds while pending, every minute while a problem is being fixed.
        if (next) timer = setTimeout(check, next.tone === "working" ? 10_000 : 60_000);
      });
    };
    check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sb, workspaceId]);

  if (!card) return null;
  return (
    <div className={`${card.tone === "problem" ? "bg-clay-bg" : "bg-sunk"} flex items-start gap-3 rounded-[12px] px-4 py-3`} role="status">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${card.tone === "problem" ? "bg-clay" : "bg-ink-4"}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">{card.title}</p>
        <p className="text-[14px] text-ink-3">{card.text}</p>
        {card.action ? (
          <button type="button" className="mt-2 text-[14px] font-medium text-clay-2 underline-offset-2 hover:underline" onClick={() => navigate(card.action!.path)}>
            {card.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const NAV = [
  { page: "home", label: "Home", path: "/" },
  { page: "team", label: "Team", path: "/team" },
  { page: "settings", label: "Settings", path: "/settings" },
] as const;

/** The left side on a computer, the top bar on a phone: workspace, pages, and the signed-in person. */
function Sidebar({
  sb,
  session,
  list,
  ws,
  page,
  onPick,
}: {
  sb: SupabaseClient;
  session: Session;
  list: Workspace[];
  ws: Workspace;
  page: string;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-side px-4 py-3 md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0 md:py-5">
      <div className="flex items-center justify-between gap-3">
        <Logo />
      </div>
      {list.length > 1 ? (
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-ink-4" htmlFor="ws-pick">
            Workspace
          </label>
          <select id="ws-pick" className="h-10 w-full rounded-[9px] border border-line bg-surface px-2 text-[14px]" value={ws.id} onChange={(e) => onPick(e.target.value)}>
            {list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{ws.name}</p>
          <p className="text-[13px] text-ink-4">{roleLabel(ws.role)}</p>
        </div>
      )}
      <nav className="flex gap-1 md:flex-col" aria-label="Main">
        {NAV.map((n) => (
          <a
            key={n.page}
            href={n.path}
            aria-current={page === n.page || (n.page === "home" && page === "thread") ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(n.path);
            }}
            className={`rounded-[9px] px-3 py-2 text-[15px] ${page === n.page || (n.page === "home" && page === "thread") ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-3 hover:bg-sunk hover:text-ink"}`}
          >
            {n.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-[13px] md:mt-auto md:flex-col md:items-start">
        <span className="min-w-0 truncate text-ink-3">{session.user.email}</span>
        <button type="button" className="rounded-[9px] border border-line bg-surface px-3 py-1.5 text-[14px] hover:bg-sunk" onClick={() => sb.auth.signOut()}>
          Log out
        </button>
      </div>
    </aside>
  );
}

/** For people who signed up with Google or an email code, or who left or deleted their only workspace: tell us about the business, then make the workspace. */
function SetUpBusiness({ sb, name, notice, onDone }: { sb: SupabaseClient; name: string; notice?: string; onDone: () => void }) {
  const [business, setBusiness] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!business.trim()) return setError("Enter your business name.");
    setBusy(true);
    setError("");
    try {
      const { error } = await sb.rpc("create_workspace", { p_name: business.trim(), p_website: cleanWebsite(website) || null, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }
  return (
    <Frame>
      {notice ? <Notice>{notice}</Notice> : null}
      <div>
        <h1 className="font-serif text-[26px] leading-tight">{name ? `Welcome, ${name.split(" ")[0]}` : "Welcome"}</h1>
        <p className="mt-1 text-[15px] text-ink-3">Tell us about your business so your team can get to work.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={label} htmlFor="biz">
            Business name
          </label>
          <input id="biz" autoComplete="organization" value={business} onChange={(e) => setBusiness(e.target.value)} required autoFocus className={input} />
        </div>
        <div>
          <label className={label} htmlFor="site">
            Website <span className="font-normal text-ink-4">(optional)</span>
          </label>
          <input id="site" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="yourbusiness.com" value={website} onChange={(e) => setWebsite(e.target.value)} className={input} />
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "Setting up..." : "Start my free trial"}
        </button>
      </form>
    </Frame>
  );
}
