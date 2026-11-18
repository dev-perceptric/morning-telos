"use client";

// Sign in, create an account, get an email code, or reset a password. Copied from Arrowsterr's AuthScreen and
// trimmed: no passkeys or 2-step codes yet. Sign-up also asks for the business, so the database makes the
// workspace right away (handle_new_user in supabase/schema.sql).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { passwordProblem, strength } from "@/lib/passwordCheck";
import { signupMeta } from "@/lib/signup";
import { Turnstile } from "./Turnstile";
import { btnPrimary, btnSecondary, ErrorText, Frame, input, label, Logo, Notice, textLink } from "./ui";

type Mode = "signin" | "signup" | "forgot" | "code";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TITLES: Record<Mode, [string, string]> = {
  signin: ["Welcome back", "Log in to your AI team."],
  signup: ["Start your free trial", "14 days free. No card needed."],
  forgot: ["Reset your password", "We'll email you a link to choose a new one."],
  code: ["Log in with a code", "We'll email you a 6-digit code. No password needed."],
};

/** A password box with a show/hide button, a Caps Lock warning and an optional strength bar. */
function PasswordField({ id, text, value, onChange, autoComplete, autoFocus, meter }: { id: string; text: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; meter?: boolean }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const s = strength(value);
  const tone = ["", "bg-red", "bg-amber", "bg-clay", "bg-green"][s.score];

  // Hide it again on submit, so the browser never saves or shows it as plain text afterward.
  useEffect(() => {
    const form = box.current?.form;
    if (!form) return;
    const hide = () => setShown(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div>
      <label className={label} htmlFor={id}>
        {text}
      </label>
      <div className="relative">
        <input
          ref={box}
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCaps(false)}
          required
          autoFocus={autoFocus}
          className={`${input} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          onMouseDown={(e) => e.preventDefault()}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-2 py-1 text-[13px] text-ink-3 hover:bg-sunk"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {caps ? <p className="mt-1.5 text-[13px] text-amber">Caps Lock is on.</p> : null}
      {meter && value ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
            <div className={`h-full ${tone}`} style={{ width: `${s.score * 25}%` }} />
          </div>
          <span className="text-[12px] text-ink-3">{s.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthScreen({ sb, invited, turnstileSiteKey = null, google: googleOn = false }: { sb: SupabaseClient; invited: boolean; turnstileSiteKey?: string | null; google?: boolean }) {
  const [mode, setMode] = useState<Mode>(invited ? "signup" : "signin");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [round, setRound] = useState(0);
  const onToken = useCallback((t: string) => setCaptcha(t), []);
  const captchaToken = captcha || undefined;

  /** The 6-digit code from the email: signs in, or finishes a new account. */
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = code.trim();
      let { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      if (error && mode === "signup") ({ error } = await sb.auth.verifyOtp({ email, token, type: "signup" }));
      if (error) throw error;
    } catch (err) {
      setError(/invalid|expired/i.test(message(err)) ? "That code is not right or has expired. Check the newest email." : message(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (turnstileSiteKey && !captcha) return setError("Please wait for the security check to finish.");
    setBusy(true);
    setError("");
    setSent("");
    try {
      const redirect = window.location.origin;
      if (mode === "signin") {
        // Through the server, which counts wrong tries and locks them out.
        const res = await fetch("/api/auth/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, captchaToken }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Sign-in failed. Try again.");
        const { error } = await sb.auth.setSession({ access_token: out.access_token, refresh_token: out.refresh_token });
        if (error) throw error;
      } else if (mode === "signup") {
        const problem = await passwordProblem(password);
        if (problem) throw new Error(problem);
        // Invited people send no business, so the database doesn't make them a workspace of their own.
        const full = signupMeta({ name, business, website, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        if (!invited && !full.business) throw new Error("Enter your business name.");
        const meta = invited ? { name: full.name } : full;
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect + window.location.pathname, captchaToken, data: meta } });
        if (error) throw error;
        if (!data.session) setSent(`We sent a link to ${email}. Click it, or enter the code from the email below.`);
      } else if (mode === "code") {
        // Signs in, or makes the account on a first visit. Comes back to this page, so invite links keep working.
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect + window.location.pathname, captchaToken } });
        if (error) throw error;
        setSent(`We sent a code to ${email}. Enter it below.`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect, captchaToken });
        if (error) throw error;
        setSent(`If ${email} has an account, a reset link is on its way.`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      // A token works once, so get a new one for the next try.
      if (turnstileSiteKey) {
        setCaptcha("");
        setRound((r) => r + 1);
      }
    }
  }

  async function google() {
    setBusy(true);
    setError("");
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: "select_account" } } });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  function switchTo(m: Mode) {
    setMode(m);
    setError("");
    setSent("");
    setCode("");
  }

  const [title, sub] = TITLES[mode];
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-side p-12 lg:flex">
        <Logo />
        <div className="flex max-w-md flex-col gap-4">
          <h2 className="font-serif text-[40px] leading-[1.1] text-ink">Your AI team, ready every morning.</h2>
          <p className="text-[16px] leading-relaxed text-ink-2">Chat with named AI employees who handle your SEO, social posts and follow-ups. Nothing goes out until you approve it.</p>
        </div>
        <p className="text-[13px] text-ink-4">Built for small businesses.</p>
      </aside>
      <section className="flex items-center justify-center bg-bg px-5 py-10 sm:px-8">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-serif text-[32px] leading-tight text-ink">{title}</h1>
            <p className="text-[15px] text-ink-3">{sub}</p>
          </div>
          {invited ? <Notice>You were invited to a team. Use the email address the invite was sent to.</Notice> : null}
          {googleOn && (mode === "signin" || mode === "signup") ? (
            <>
              <button type="button" className={btnSecondary} onClick={google} disabled={busy}>
                <GoogleIcon />
                Continue with Google
              </button>
              <div className="flex items-center gap-3 text-[12px] text-ink-4">
                <span className="h-px flex-1 bg-line" />
                or use your email
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          ) : null}
          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "signup" ? (
              <>
                <div>
                  <label className={label} htmlFor="name">
                    Your name
                  </label>
                  <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required className={input} />
                </div>
                {invited ? null : (
                  <>
                    <div>
                      <label className={label} htmlFor="business">
                        Business name
                      </label>
                      <input id="business" autoComplete="organization" value={business} onChange={(e) => setBusiness(e.target.value)} required className={input} />
                    </div>
                    <div>
                      <label className={label} htmlFor="website">
                        Website <span className="font-normal text-ink-4">(optional)</span>
                      </label>
                      <input id="website" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="yourbusiness.com" value={website} onChange={(e) => setWebsite(e.target.value)} className={input} />
                    </div>
                  </>
                )}
              </>
            ) : null}
            <div>
              <label className={label} htmlFor="email">
                Email
              </label>
              <input id="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode !== "signup"} className={input} />
            </div>
            {mode === "signin" || mode === "signup" ? (
              <div className="flex flex-col gap-1.5">
                <PasswordField id="password" text="Password" value={password} onChange={setPassword} autoComplete={mode === "signup" ? "new-password" : "current-password"} meter={mode === "signup"} />
                {mode === "signin" ? (
                  <button type="button" className={`${textLink} self-end text-[13px]`} onClick={() => switchTo("forgot")}>
                    Forgot password?
                  </button>
                ) : null}
              </div>
            ) : null}
            {turnstileSiteKey ? <Turnstile siteKey={turnstileSiteKey} round={round} onToken={onToken} /> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            {sent ? <Notice>{sent}</Notice> : null}
            <button type="submit" className={`${btnPrimary} mt-1`} disabled={busy}>
              {busy ? "Please wait..." : mode === "signin" ? "Log in" : mode === "signup" ? "Start free trial" : mode === "code" ? "Email me a code" : "Send reset link"}
            </button>
          </form>
          {sent && (mode === "code" || mode === "signup") ? (
            <form onSubmit={verify} className="flex flex-col gap-3">
              <label className={label} htmlFor="email-code">
                Code from the email
              </label>
              <input
                id="email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${input} text-center font-mono text-[22px] tracking-[0.3em]`}
              />
              <button type="submit" className={btnSecondary} disabled={busy || code.length < 6}>
                {busy ? "Checking..." : "Continue"}
              </button>
            </form>
          ) : null}
          <div className="flex flex-col gap-3 border-t border-line pt-5 text-[14px] text-ink-2">
            {mode === "signin" ? (
              <>
                <span>
                  New to Morning Telos?{" "}
                  <button type="button" className={textLink} onClick={() => switchTo("signup")}>
                    Start a free trial
                  </button>
                </span>
                <button type="button" className={`${textLink} self-start`} onClick={() => switchTo("code")}>
                  Email me a code instead
                </button>
              </>
            ) : mode === "signup" ? (
              <span>
                Already have an account?{" "}
                <button type="button" className={textLink} onClick={() => switchTo("signin")}>
                  Log in
                </button>
              </span>
            ) : (
              <button type="button" className={`${textLink} self-start`} onClick={() => switchTo("signin")}>
                Back to log in
              </button>
            )}
            {mode === "signup" || mode === "code" ? (
              <p className="text-[12px] text-ink-4">
                {mode === "code" ? "New here? The code also creates your account. " : null}By creating an account you agree to the{" "}
                <a className={textLink} href="https://morningtelos.com/terms/" target="_blank" rel="noopener noreferrer">
                  Terms
                </a>{" "}
                and{" "}
                <a className={textLink} href="https://morningtelos.com/privacy/" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
                .
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

/** Shown after a password reset link is clicked. */
export function NewPassword({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const problem = await passwordProblem(password);
    if (problem) {
      setBusy(false);
      return setError(problem);
    }
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }
  return (
    <Frame>
      <h1 className="font-serif text-[26px] leading-tight">Choose a new password</h1>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <PasswordField id="new-password" text="New password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus meter />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "Saving..." : "Save password"}
        </button>
      </form>
    </Frame>
  );
}
