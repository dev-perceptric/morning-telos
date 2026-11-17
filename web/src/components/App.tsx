"use client";

// The whole client app: the sign-in screens, then the app shell. Workspace screens (P1.5) and billing (P1.6) plug in here.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { cleanWebsite } from "@/lib/signup";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { btnPrimary, ErrorText, Frame, input, label, Logo } from "./ui";

type Workspace = { id: string; name: string; website: string | null; plan: string; trial_ends_at: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App({ supabase, turnstileSiteKey }: { supabase: SupaConfig; turnstileSiteKey: string | null }) {
  const sb = getSupabase(supabase);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  if (session === undefined) return <Loading />;
  if (recovering && session) return <NewPassword sb={sb} onDone={() => setRecovering(false)} />;
  if (!session) return <AuthScreen sb={sb} invited={/^\/invite\//.test(window.location.pathname)} turnstileSiteKey={turnstileSiteKey} />;
  return <Shell sb={sb} session={session} />;
}

function Loading() {
  return (
    <main className="grid min-h-screen place-items-center text-[14px] text-ink-4" aria-busy="true">
      Loading...
    </main>
  );
}

/** Signed in: load the person's workspaces. No workspace yet (Google sign-up) means set one up first. */
function Shell({ sb, session }: { sb: SupabaseClient; session: Session }) {
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState("");
  // Bump to load the list again (after making a workspace).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    sb.from("workspaces")
      .select("id, name, website, plan, trial_ends_at")
      .order("created_at")
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(error.message);
        else setList(data as Workspace[]);
      });
    return () => {
      live = false;
    };
  }, [sb, version]);

  if (error) return <Frame><ErrorText>{error}</ErrorText></Frame>;
  if (!list) return <Loading />;
  if (!list.length) return <SetUpBusiness sb={sb} name={String(session.user.user_metadata?.name ?? "")} onDone={load} />;
  const ws = list[0];
  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line bg-side px-5 py-3">
        <Logo />
        <div className="flex items-center gap-4 text-[14px]">
          <span className="text-ink-3">{session.user.email}</span>
          <button type="button" className="rounded-[9px] border border-line bg-surface px-3 py-1.5 hover:bg-sunk" onClick={() => sb.auth.signOut()}>
            Log out
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-3xl px-5 py-12">
        <p className="mb-1 text-[14px] text-ink-3">{ws.name}</p>
        <h1 className="mb-3 font-serif text-[34px] leading-tight">What should your team do today?</h1>
        <p className="text-[15px] text-ink-3">Your AI team is getting set up. Chat, approvals and settings are coming next.</p>
      </section>
    </main>
  );
}

/** For people who signed up with Google or an email code: tell us about the business, then make the workspace. */
function SetUpBusiness({ sb, name, onDone }: { sb: SupabaseClient; name: string; onDone: () => void }) {
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
