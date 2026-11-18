"use client";

// The whole client app: the sign-in screens, then the app shell with its pages. The shell is the current app's
// (app/public/index.html): a 252px sidebar with search, new chat, the pages with icons, recent chats and who is
// signed in; on a phone a top bar and a bottom tab bar with More.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { initial, paletteMatch, type PaletteItem } from "@/lib/home";
import type { ModelChoice } from "@/lib/models";
import { routePath, wantsSignup, withoutSignup, type Route } from "@/lib/routes";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { cleanWebsite } from "@/lib/signup";
import { agentFace, AGENTS, ORDER, type AgentKey } from "@/lib/team";
import { can, inviteTokenFromPath, roleLabel } from "@/lib/workspace";
import { ApprovalsPage } from "./Approvals";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { BillingPage } from "./Billing";
import { ThreadPage, type StartChat } from "./Chat";
import { Home } from "./Home";
import { Icon, Mark, type IconName } from "./icons";
import { KnowledgePage } from "./Knowledge";
import { MemoryPage } from "./Memory";
import { message, navigate, readLocal, useRoute, writeLocal } from "./nav";
import { RoutinesPage } from "./Routines";
import { SettingsPage, type Workspace } from "./Settings";
import { StaffPage, useIsStaff } from "./Staff";
import { ConnectSocialCard } from "./Social";
import { AgentPage, TeamPage } from "./Team";
import { btnPrimary, btnSecondary, Drawer, ErrorText, Frame, input, label, Notice, to } from "./ui";

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
  // Read once on load: the site's "Start free trial" link (#signup or /signup) opens the sign-up form.
  const [signup] = useState(() => wantsSignup(window.location.pathname, window.location.hash));

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  // Signed in, the sign-up link just opens home, so take it out of the address.
  useEffect(() => {
    if (!session) return;
    const clean = withoutSignup(window.location.pathname, window.location.search, window.location.hash);
    if (clean !== null) {
      window.history.replaceState(null, "", clean);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [session]);

  const clearInvite = useCallback(() => {
    writeLocal(INVITE_KEY, null);
    setInvite(null);
  }, []);

  if (session === undefined) return <Loading />;
  if (recovering && session) return <NewPassword sb={sb} onDone={() => setRecovering(false)} />;
  if (!session) return <AuthScreen sb={sb} invited={Boolean(invite)} signup={signup} turnstileSiteKey={turnstileSiteKey} google={google} />;
  if (invite) return <JoinInvite sb={sb} session={session} token={invite} onDone={clearInvite} />;
  return <Shell sb={sb} session={session} />;
}

function Loading() {
  return (
    <div className="boot" aria-busy="true">
      Loading...
    </div>
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
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<string | null>(() => readLocal(WS_KEY));
  // A message left by the screen before (like "You joined the team"). Shown once.
  const [notice, setNotice] = useState(() => readLocal(NOTICE_KEY) ?? "");
  useEffect(() => writeLocal(NOTICE_KEY, null), []);
  // Bump to load the list again (after a change).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    sb.from("workspace_members")
      .select("role, created_at, workspace:workspaces(id, name, website, timezone, plan, status, trial_ends_at)")
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
    navigate("/");
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

  return <Frame2 key={ws.id} sb={sb} session={session} list={list} ws={ws} notice={notice} onNotice={setNotice} onPick={pick} onChanged={load} onGone={gone} />;
}

type Chrome = { pending: number; threads: { id: string; title: string; updated_at: string }[] };

/** The approvals count and the latest chats for the sidebar. Looked up again on every page change. */
function useChrome(sb: SupabaseClient, workspaceId: string, key: string): Chrome & { reload: () => void } {
  const [c, setC] = useState<Chrome>({ pending: 0, threads: [] });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([
      sb.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending"),
      sb.from("threads").select("id, title, updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(30),
    ]).then(([a, t]) => live && setC({ pending: a.error ? 0 : (a.count ?? 0), threads: t.error ? [] : ((t.data ?? []) as Chrome["threads"]) }));
    return () => {
      live = false;
    };
  }, [sb, workspaceId, key, n]);
  return { ...c, reload: useCallback(() => setN((x) => x + 1), []) };
}

type NavItem = { page: string; label: string; path: string; icon: IconName; count?: boolean };
const MAIN_NAV: NavItem[] = [
  { page: "home", label: "Home", path: "/", icon: "home" },
  { page: "approvals", label: "Approvals", path: "/approvals", icon: "inbox", count: true },
  { page: "team", label: "Team", path: "/team", icon: "team" },
  { page: "routines", label: "Routines", path: "/routines", icon: "clock" },
];
const SETUP_NAV: NavItem[] = [
  { page: "knowledge", label: "Knowledge", path: "/knowledge", icon: "book" },
  { page: "memory", label: "Memory", path: "/memory", icon: "memory" },
  { page: "billing", label: "Billing", path: "/billing", icon: "card" },
  { page: "settings", label: "Settings", path: "/settings", icon: "gear" },
];
// The phone's bottom bar, like the current app: four pages and More.
const TAB_NAV = [MAIN_NAV[0], MAIN_NAV[1], MAIN_NAV[2], SETUP_NAV[0]];
const MORE_NAV = [MAIN_NAV[3], SETUP_NAV[1], SETUP_NAV[2], SETUP_NAV[3]];
// Only for Morning Telos staff (STAFF_EMAILS on the server). Everyone else never sees it.
const STAFF_NAV: NavItem = { page: "staff", label: "Staff", path: "/staff", icon: "shield" };

/** Which nav item a page lights up: a chat is Home's, a teammate is Team's. */
const navPage = (page: string) => (page === "thread" ? "home" : page === "agent" ? "team" : page);

function go(e: React.MouseEvent, path: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(path);
}

/** The app around a workspace: the sidebar (or the phone's top and bottom bars), the page, and the search palette. */
function Frame2({
  sb,
  session,
  list,
  ws,
  notice,
  onNotice,
  onPick,
  onChanged,
  onGone,
}: {
  sb: SupabaseClient;
  session: Session;
  list: Workspace[];
  ws: Workspace;
  notice: string;
  onNotice: (t: string) => void;
  onPick: (id: string) => void;
  onChanged: () => void;
  onGone: (text: string) => void;
}) {
  const route = useRoute();
  const path = routePath(route);
  const chrome = useChrome(sb, ws.id, path);
  const staff = useIsStaff(sb);
  const setupNav = staff ? [...SETUP_NAV, STAFF_NAV] : SETUP_NAV;
  const moreNav = staff ? [...MORE_NAV, STAFF_NAV] : MORE_NAV;
  const name = String(session.user.user_metadata?.name ?? "").trim();
  const email = session.user.email ?? "";
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  // What's typed on Home, the model picked there, the first message of a chat being started, and the chat this tab
  // started (its page keeps streaming while the address changes from /chat to /chat/<id>).
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<ModelChoice>("auto");
  const [start, setStart] = useState<StartChat | null>(null);
  const [ownThread, setOwnThread] = useState<string | null>(null);
  const reload = chrome.reload;
  const startChat = useCallback((text: string) => {
    setDraft("");
    setOwnThread(null);
    setStart({ text });
    navigate("/chat");
  }, []);
  // Run now on the Routines page: a new chat that streams the routine.
  const runRoutine = useCallback((r: { id: string; title: string; instruction: string }) => {
    setOwnThread(null);
    setStart({ text: r.instruction, routineId: r.id, title: r.title });
    navigate("/chat");
  }, []);
  const started = useCallback(() => setStart(null), []);
  const threadMade = useCallback(
    (id: string) => {
      setOwnThread(id);
      reload();
    },
    [reload],
  );
  const ask = useCallback((k: AgentKey) => {
    setDraft(`@${AGENTS[k].god} `);
    navigate("/");
    focusComposer();
  }, []);
  const newChat = useCallback(() => {
    navigate("/");
    focusComposer();
  }, []);
  const logout = useCallback(() => {
    sb.auth.signOut();
  }, [sb]);

  // ⌘K or Ctrl+K opens and closes the search palette.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  // A new page starts at the top, like the current app. A chat keeps its own scroll.
  useEffect(() => {
    if (route.page !== "thread") window.scrollTo({ top: 0 });
    document.title = `${pageTitle(route)} · Morning Telos`;
  }, [path, route]);

  const active = navPage(route.page);
  const narrow = route.page === "home" || route.page === "thread";
  const navLink = (n: NavItem) => (
    <a key={n.page} className={`nl${active === n.page ? " on" : ""}`} href={n.path} aria-current={active === n.page ? "page" : undefined} onClick={(e) => go(e, n.path)}>
      <Icon name={n.icon} />
      {n.label}
      {n.count && chrome.pending ? <span className="count">{chrome.pending}</span> : null}
    </a>
  );

  return (
    <div className="shell">
      <aside className="sb" aria-label="Main navigation">
        <WorkspaceButton list={list} ws={ws} onPick={onPick} />
        <div className="sb-actions">
          <button type="button" className="search-btn" onClick={() => setPalette(true)}>
            <Icon name="search" small />
            Search or jump to
            <kbd>⌘K</kbd>
          </button>
          <button type="button" className="new-btn" aria-label="New chat" title="New chat" onClick={newChat}>
            <Icon name="plus" small />
          </button>
        </div>
        <nav className="grp" aria-label="Main">
          {MAIN_NAV.map(navLink)}
          <div className="grp">
            <h6>Setup</h6>
            {setupNav.map(navLink)}
          </div>
        </nav>
        <div className="grp">
          <h6>Recent</h6>
          {chrome.threads.length ? (
            chrome.threads.slice(0, 6).map((t) => (
              <a key={t.id} className={`rc${route.page === "thread" && route.id === t.id ? " on" : ""}`} href={`/chat/${t.id}`} onClick={(e) => go(e, `/chat/${t.id}`)}>
                <span>{t.title || "Chat"}</span>
              </a>
            ))
          ) : (
            <span className="rc none">No chats yet</span>
          )}
        </div>
        <div className="sb-foot">
          <a className="me-btn" href={to("/settings")} onClick={(e) => go(e, "/settings")}>
            <span className="avatar-me">{initial(name || email)}</span>
            <span className="min-w-0">
              <b>{name || email}</b>
              <small>{roleLabel(ws.role)}</small>
            </span>
          </a>
          <button type="button" className="icon-btn" aria-label="Log out" title="Log out" onClick={logout}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="mainw">
        <header className="mtop">
          <Mark />
          <b>{ws.name}</b>
          <button type="button" className="icon-btn" aria-label="Search" onClick={() => setPalette(true)}>
            <Icon name="search" />
          </button>
          <a className="avatar-me" href={to("/settings")} aria-label="Settings" onClick={(e) => go(e, "/settings")}>
            {initial(name || email)}
          </a>
        </header>
        <main className="mainp">
          <div className={`view on${narrow ? " narrow" : ""}`} key={route.page === "thread" ? "thread" : route.page === "staff" ? "staff" : path}>
            {notice ? (
              <div className="note-box mb-4 flex items-start justify-between gap-3" role="status">
                <span>{notice}</span>
                <button type="button" className="text-ink-4 hover:text-ink" aria-label="Close" onClick={() => onNotice("")}>
                  <Icon name="close" small />
                </button>
              </div>
            ) : null}
            {route.page === "settings" ? (
              <SettingsPage sb={sb} ws={ws} userId={session.user.id} tab={route.tab} onChanged={onChanged} onGone={onGone} email={email} name={name} onLogout={logout} />
            ) : route.page === "thread" ? (
              <ThreadPage
                key={`${ws.id}:${route.id && route.id !== ownThread ? route.id : "new"}`}
                sb={sb}
                ws={ws}
                id={route.id}
                start={route.id ? null : start}
                model={model}
                onStarted={started}
                onThread={threadMade}
              />
            ) : route.page === "team" ? (
              <TeamPage sb={sb} ws={ws} onAsk={ask} />
            ) : route.page === "agent" ? (
              <AgentPage key={route.key} sb={sb} ws={ws} agent={route.key} onAsk={ask} />
            ) : route.page === "knowledge" ? (
              <KnowledgePage sb={sb} ws={ws} />
            ) : route.page === "routines" ? (
              <RoutinesPage sb={sb} ws={ws} onRun={runRoutine} />
            ) : route.page === "memory" ? (
              <MemoryPage sb={sb} ws={ws} />
            ) : route.page === "billing" ? (
              <BillingPage sb={sb} ws={ws} onChanged={onChanged} />
            ) : route.page === "staff" ? (
              <StaffPage sb={sb} id={route.id} />
            ) : route.page === "approvals" ? (
              <ApprovalsPage sb={sb} ws={ws} id={route.id} onDecided={reload} />
            ) : (
              <>
                <Home sb={sb} ws={ws} name={name} draft={draft} onDraft={setDraft} onStart={startChat} model={model} onModel={setModel} />
                <ConnectSocialCard sb={sb} ws={ws} />
              </>
            )}
          </div>
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {TAB_NAV.map((n) => (
          <a key={n.page} className={active === n.page ? "on" : ""} href={n.path} aria-current={active === n.page ? "page" : undefined} onClick={(e) => go(e, n.path)}>
            <Icon name={n.icon} />
            {n.label}
            {n.count && chrome.pending ? <span className="count">{chrome.pending}</span> : null}
          </a>
        ))}
        <button type="button" className={moreNav.some((n) => n.page === active) ? "on" : ""} onClick={() => setMore(true)}>
          <Icon name="more" />
          More
        </button>
      </nav>

      <Drawer open={more} title="More" onClose={() => setMore(false)}>
        <div className="card list">
          {moreNav.map((n) => (
            <a
              key={n.page}
              className="row"
              href={n.path}
              onClick={(e) => {
                setMore(false);
                go(e, n.path);
              }}
            >
              <Icon name={n.icon} />
              <span className="main">
                <b>{n.label}</b>
              </span>
              <Icon name="next" small />
            </a>
          ))}
          {list.length > 1
            ? list
                .filter((w) => w.id !== ws.id)
                .map((w) => (
                  <button key={w.id} type="button" className="row" onClick={() => onPick(w.id)}>
                    <Mark />
                    <span className="main">
                      <b>Switch to {w.name}</b>
                    </span>
                  </button>
                ))
            : null}
          <button type="button" className="row" onClick={logout}>
            <Icon name="logout" />
            <span className="main">
              <b>Log out</b>
            </span>
          </button>
        </div>
      </Drawer>

      {palette ? <Palette ws={ws} staff={staff} threads={chrome.threads} onClose={() => setPalette(false)} onNew={newChat} /> : null}
    </div>
  );
}

const TITLES: Record<string, string> = { home: "Home", thread: "Chat", team: "Team", knowledge: "Knowledge", routines: "Routines", memory: "Memory", approvals: "Approvals", settings: "Settings", billing: "Billing", invite: "Invite", staff: "Staff" };
const pageTitle = (r: Route) => (r.page === "agent" ? AGENTS[r.key].god : TITLES[r.page]);

/** Put the cursor in Home's message box once Home is on screen. */
function focusComposer() {
  setTimeout(() => {
    const ta = document.getElementById("composer") as HTMLTextAreaElement | null;
    ta?.focus();
    ta?.setSelectionRange(ta.value.length, ta.value.length);
  }, 80);
}

/** The business at the top of the sidebar. With more than one workspace it opens a menu to switch. */
function WorkspaceButton({ list, ws, onPick }: { list: Workspace[]; ws: Workspace; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const face = (
    <>
      <Mark />
      <span className="min-w-0">
        <b>{ws.name}</b>
        <small>AI team</small>
      </span>
    </>
  );
  if (list.length < 2)
    return (
      <a className="ws" href={to("/settings")} onClick={(e) => go(e, "/settings")}>
        {face}
      </a>
    );
  return (
    <div className="dd ws-dd" ref={box}>
      <button type="button" className="ws" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {face}
        <Icon name="down" small />
      </button>
      <div className={`dd-menu${open ? " on" : ""}`} role="listbox" aria-label="Workspaces">
        {list.map((w) => (
          <button
            key={w.id}
            type="button"
            role="option"
            aria-selected={w.id === ws.id}
            onClick={() => {
              setOpen(false);
              if (w.id !== ws.id) onPick(w.id);
            }}
          >
            {w.id === ws.id ? <Icon name="tick" small className="tick" /> : <span className="tick" />}
            <span className="dd-t">{w.name}</span>
            <span className="n">{roleLabel(w.role)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const PAGES: PaletteItem[] = [
  { label: "Home", group: "Pages", path: "/" },
  { label: "Approvals", group: "Pages", path: "/approvals" },
  { label: "Team", group: "Pages", path: "/team" },
  { label: "Routines", group: "Pages", path: "/routines", keywords: "schedule" },
  { label: "Knowledge", group: "Pages", path: "/knowledge", keywords: "docs" },
  { label: "Memory", group: "Pages", path: "/memory", keywords: "facts" },
  { label: "Billing", group: "Pages", path: "/billing", keywords: "plan" },
  { label: "Settings", group: "Pages", path: "/settings", keywords: "business" },
  { label: "Members", group: "Pages", path: "/settings/members", keywords: "settings people invite" },
  { label: "Social accounts", group: "Pages", path: "/settings/social", keywords: "settings" },
  { label: "Apps", group: "Pages", path: "/settings/apps", keywords: "settings gmail outlook" },
  { label: "Skills", group: "Pages", path: "/settings/skills", keywords: "settings" },
];

/** Search or jump to: pages, teammates and chats, like the current app's palette. Arrows move, Enter opens. */
function Palette({ ws, staff, threads, onClose, onNew }: { ws: Workspace; staff: boolean; threads: Chrome["threads"]; onClose: () => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items: PaletteItem[] = [
    ...(can(ws.role, "chat") ? [{ label: "New chat", group: "Actions" as const, path: "/" }] : []),
    ...PAGES,
    ...(staff ? [{ label: "Staff", group: "Pages" as const, path: "/staff", keywords: "admin workspaces customers" }] : []),
    ...ORDER.map((k) => ({ label: `${AGENTS[k].god} · ${AGENTS[k].name}`, group: "Teammates" as const, path: `/team/${k}` })),
    ...threads.map((t) => ({ label: t.title || "Chat", group: "Chats" as const, path: `/chat/${t.id}` })),
  ];
  const found = paletteMatch(items, q);
  const pick = Math.min(sel, Math.max(found.length - 1, 0));
  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    if (it.group === "Actions") onNew();
    else navigate(it.path);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  let last = "";
  return (
    <div className="pal-wrap on" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal">
        <div className="field">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Search pages, teammates and chats"
            aria-label="Search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (found.length) setSel((pick + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(found[pick]);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-l">
          {found.length ? (
            found.map((it, i) => {
              const head = it.group !== last ? <h5>{it.group}</h5> : null;
              last = it.group;
              const k = it.group === "Teammates" ? (it.path.split("/")[2] as AgentKey) : null;
              return (
                <Fragment key={`${it.group}:${it.path}`}>
                  {head}
                  <button type="button" className={i === pick ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
                    {k ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={agentFace(k)} alt="" />
                    ) : (
                      <span className="pi">{it.group === "Actions" ? "+" : it.group === "Chats" ? "#" : "›"}</span>
                    )}
                    <span className="min-w-0 wrap">{it.label}</span>
                  </button>
                </Fragment>
              );
            })
          ) : (
            <div className="empty">
              <b>No results</b>Try another word.
            </div>
          )}
        </div>
      </div>
    </div>
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
