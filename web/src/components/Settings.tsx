"use client";

// Workspace settings: the business details, members and invites, social accounts, apps, and deleting the workspace.
// Copied from Arrowsterr's SettingsPage.tsx, MembersPage.tsx and WorkspaceSettings.tsx (TimezoneSetting), trimmed down.
// Row level security in Supabase decides what each person may change. These screens only hide what they can't do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppsSettings } from "./Apps";
import { ExtensionSettings } from "./Extension";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/routes";
import { ASSIGNABLE, can, cleanSettings, deleteConfirmMatches, inviteLink, memberActions, roleLabel, ROLES, type MemberRow, type Role } from "@/lib/workspace";
import { initial } from "@/lib/home";
import { callApi, message, navigate } from "./nav";
import { SkillsSettings } from "./Skills";
import { SocialSettings } from "./Social";
import { ErrorText, input, label, Notice, PageHead, Switch } from "./ui";

export type Workspace = { id: string; name: string; website: string | null; timezone: string; plan: string; status: string | null; trial_ends_at: string; created_at?: string; role: Role };
type Invite = { id: string; email: string; role: Role; token: string; expires_at: string; expired?: boolean };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function SettingsPage({
  sb,
  ws,
  userId,
  tab,
  onChanged,
  onGone,
  email,
  name,
  onLogout,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  userId: string;
  tab: SettingsTab;
  /** Load the workspace list again after a change. */
  onChanged: () => void;
  /** The person left or deleted this workspace. */
  onGone: (notice: string) => void;
  email: string;
  name: string;
  onLogout: () => void;
}) {
  return (
    <>
      <PageHead title="Settings" sub="Your business, your people and your account.">
        <button type="button" className="btn" onClick={onLogout}>
          Log out
        </button>
      </PageHead>
      <nav className="tabs" aria-label="Settings">
        {SETTINGS_TABS.map((t) => (
          <a
            key={t.id}
            href={t.id === "general" ? "/settings" : `/settings/${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(t.id === "general" ? "/settings" : `/settings/${t.id}`);
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === "general" ? (
        <>
          <div className="two">
            <GeneralSettings key={ws.id} sb={sb} ws={ws} onChanged={onChanged} />
            <Account email={email} name={name} role={ws.role} />
          </div>
          {ws.role === "owner" ? <EmailSettings key={`mail-${ws.id}`} sb={sb} ws={ws} userId={userId} /> : null}
          {can(ws.role, "deleteWorkspace") ? <DeleteWorkspace key={`del-${ws.id}`} sb={sb} ws={ws} onGone={onGone} /> : null}
          <p className="legal">
            <a className="link" href="https://morningtelos.com/terms/" target="_blank" rel="noopener noreferrer">
              Terms
            </a>{" "}
            ·{" "}
            <a className="link" href="https://morningtelos.com/privacy/" target="_blank" rel="noopener noreferrer">
              Privacy
            </a>
          </p>
        </>
      ) : tab === "members" ? (
        <MembersSettings key={ws.id} sb={sb} ws={ws} userId={userId} onGone={onGone} />
      ) : tab === "apps" ? (
        <AppsSettings key={`apps-${ws.id}`} sb={sb} ws={ws} />
      ) : tab === "skills" ? (
        <SkillsSettings key={`skills-${ws.id}`} sb={sb} ws={ws} />
      ) : tab === "extension" ? (
        <ExtensionSettings sb={sb} />
      ) : (
        <SocialSettings key={`social-${ws.id}`} sb={sb} ws={ws} />
      )}
    </>
  );
}

/** Who is signed in, and Log out. */
function Account({ email, name, role }: { email: string; name: string; role: Role }) {
  return (
    <section className="card pad">
      <div className="sh">
        <h2>Your account</h2>
      </div>
      <div className="flex items-center gap-3">
        <span className="avatar-me lg">{initial(name || email)}</span>
        <span className="min-w-0">
          <b className="block text-[14px]">{name || email}</b>
          <small className="block text-[12.5px] text-ink-4 wrap">
            {email} · {roleLabel(role)}
          </small>
        </span>
      </div>
      <p className="hint-s mt-4">To change your password, log out and pick Forgot password on the log in page.</p>
    </section>
  );
}

/**
 * The owner's emails: the weekly digest and tips can be turned off (email_prefs, supabase/018_email_log.sql).
 * Trial and billing emails always go. The same switch as the digest's unsubscribe link.
 */
function EmailSettings({ sb, ws, userId }: { sb: SupabaseClient; ws: Workspace; userId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    sb.from("email_prefs")
      .select("digest")
      .eq("workspace_id", ws.id)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(message(error));
        setOn((data as { digest: boolean } | null)?.digest !== false);
      });
    return () => {
      live = false;
    };
  }, [sb, ws.id, userId]);

  async function change(next: boolean) {
    setBusy(true);
    setError("");
    const { error } = await sb.rpc("set_email_digest", { p_ws: ws.id, p_on: next });
    setBusy(false);
    if (error) return setError(message(error));
    setOn(next);
  }

  return (
    <section className="card pad mt-4">
      <div className="sh">
        <h2>Emails</h2>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <b className="block text-[14px]">Weekly digest and tips</b>
          <small className="block text-[12.5px] text-ink-4">What your team did each week, sent on Monday morning.</small>
        </span>
        <Switch on={Boolean(on)} label="Weekly digest and tips" disabled={on === null || busy} onChange={change} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <p className="hint-s mt-4">Trial and billing emails always go to the owner.</p>
    </section>
  );
}

/** Business name, website and time zone. Admins and the owner can change them. */
function GeneralSettings({ sb, ws, onChanged }: { sb: SupabaseClient; ws: Workspace; onChanged: () => void }) {
  const editable = can(ws.role, "editSettings");
  const [name, setName] = useState(ws.name);
  const [website, setWebsite] = useState(ws.website ?? "");
  const [timezone, setTimezone] = useState(ws.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
    return all.includes(ws.timezone) ? all : [ws.timezone, ...all];
  }, [ws.timezone]);
  const changed = name !== ws.name || website !== (ws.website ?? "") || timezone !== ws.timezone;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    const v = cleanSettings({ name, website, timezone });
    if (!v.ok) return setError(v.error);
    setBusy(true);
    const { error } = await sb.from("workspaces").update(v.value).eq("id", ws.id);
    setBusy(false);
    if (error) return setError(error.message);
    setWebsite(v.value.website ?? "");
    setSaved(true);
    onChanged();
  }

  return (
    <form onSubmit={save} className="card pad">
      <div className="sh">
        <h2>Business</h2>
      </div>
      {editable ? null : <p className="hint-s mb-3">Only admins and the owner can change these.</p>}
      <div className="fld">
        <label className={label} htmlFor="ws-name">
          Business name
        </label>
        <input id="ws-name" className={input} value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={120} required />
      </div>
      <div className="fld">
        <label className={label} htmlFor="ws-site">
          Website <span className="font-normal text-ink-4">(optional)</span>
        </label>
        <input
          id="ws-site"
          className={input}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourbusiness.com"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          disabled={!editable}
        />
      </div>
      <div className="fld">
        <label className={label} htmlFor="ws-tz">
          Time zone
        </label>
        <select id="ws-tz" className="sel" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!editable}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <small>Routines run on this time zone.</small>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {editable ? (
        <div className="flex items-center gap-3">
          <button type="submit" className="btn primary" disabled={busy || !changed}>
            {busy ? "Saving..." : "Save"}
          </button>
          {saved && !changed ? <span className="ok-t">Saved</span> : null}
        </div>
      ) : null}
    </form>
  );
}

/** A button that asks "are you sure" in place before it acts. */
export function ConfirmButton({ label: text, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className="btn sm ghost" onClick={() => setAsking(true)}>
        {text}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className="btn sm danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirm}
      </button>
      <button type="button" className="btn sm" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/** Members and their roles, invites, and leaving. */
function MembersSettings({ sb, ws, userId, onGone }: { sb: SupabaseClient; ws: Workspace; userId: string; onGone: (notice: string) => void }) {
  const me = { userId, role: ws.role };
  const admin = can(ws.role, "invite");
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ invite: Invite; link: string; emailed: boolean; emailError?: string } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    const m = await sb.from("workspace_members").select("user_id, email, role").eq("workspace_id", ws.id).order("created_at");
    if (m.error) return setError(m.error.message);
    setMembers(m.data as MemberRow[]);
    if (can(ws.role, "seeInvites")) {
      const i = await sb.from("workspace_invites").select("id, email, role, token, expires_at").eq("workspace_id", ws.id).is("accepted_at", null).order("created_at");
      if (i.error) return setError(i.error.message);
      const now = Date.now();
      setInvites((i.data as Invite[]).map((x) => ({ ...x, expired: new Date(x.expires_at).getTime() < now })));
    }
  }, [sb, ws.id, ws.role]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(fn: () => PromiseLike<{ error: { message: string } | null; count?: number | null }>, ok: string) {
    setError("");
    setDone("");
    const { error } = await fn();
    if (error) return setError(error.message);
    setDone(ok);
    await load();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    setMade(null);
    setBusy(true);
    try {
      const out = await callApi<{ invite: Invite; link: string; emailed: boolean; emailError?: string }>(sb, "/api/workspace/invite", { workspaceId: ws.id, email, role });
      setMade(out);
      setEmail("");
      await load();
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  const link = (token: string) => inviteLink(window.location.origin, token);

  return (
    <>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? <Notice>{done}</Notice> : null}

      <div className="sh">
        <h2>
          People<span className="num">{members?.length || ""}</span>
        </h2>
      </div>
      <div className="card list">
        {(members ?? []).map((m) => {
          const may = memberActions(me, m);
          const who = m.email ?? "this person";
          return (
            <div key={m.user_id} className="row wrap-row">
              <span className="avatar-me lg">{initial(m.email)}</span>
              <span className="main">
                <b className="wrap">
                  {m.email ?? "Unknown"}
                  {m.user_id === userId ? <span className="font-normal text-ink-4"> (you)</span> : null}
                </b>
                <small>{roleLabel(m.role)}</small>
              </span>
              <span className="row-act">
                {may.changeRole ? (
                  <select
                    aria-label={`Role for ${who}`}
                    className="sel sm"
                    value={m.role}
                    onChange={(e) => {
                      const next = e.target.value as Role;
                      act(() => sb.from("workspace_members").update({ role: next }).eq("workspace_id", ws.id).eq("user_id", m.user_id), `${who} is now ${roleLabel(next).toLowerCase()}.`);
                    }}
                  >
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="tag">{roleLabel(m.role)}</span>
                )}
                {may.remove ? (
                  <ConfirmButton
                    label="Remove"
                    confirm={`Remove ${who}`}
                    onConfirm={() => act(() => sb.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", m.user_id), `${who} was removed.`)}
                  />
                ) : null}
                {may.leave ? (
                  <ConfirmButton
                    label="Leave workspace"
                    confirm="Yes, leave"
                    onConfirm={async () => {
                      setError("");
                      const { error } = await sb.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", userId);
                      if (error) return setError(error.message);
                      onGone(`You left ${ws.name}.`);
                    }}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
        {members === null ? <div className="empty">Loading...</div> : null}
      </div>

      {admin ? (
        <section className="sec">
          <div className="sh">
            <h2>Invite someone</h2>
          </div>
          <div className="card pad">
            <p className="mb-3 text-[13.5px] text-ink-3">They get a link to join. It works for 7 days.</p>
            <form onSubmit={invite} className="invite-f">
              <input type="email" aria-label="Email to invite" placeholder="teammate@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} />
              <select aria-label="Role" className="sel" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ASSIGNABLE.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Inviting..." : "Send invite"}
              </button>
            </form>
            {made ? (
              <div className="note-box mt-3 flex flex-col gap-2">
                <span>
                  {made.emailed
                    ? `We emailed an invite to ${made.invite.email}. You can also send them this link.`
                    : made.emailError || `Send this link to ${made.invite.email}. They sign up or log in with that email to join.`}
                </span>
                <code>{made.link}</code>
                <div>
                  <CopyButton text={made.link} />
                </div>
              </div>
            ) : null}
          </div>
          {invites.length ? (
            <>
              <div className="sh mt-4">
                <h2>Waiting to join</h2>
              </div>
              <div className="card list">
                {invites.map((i) => {
                  const expired = Boolean(i.expired);
                  return (
                    <div key={i.id} className="row wrap-row">
                      <span className="main">
                        <b className="wrap">{i.email}</b>
                        <small>
                          {roleLabel(i.role)} · {expired ? "expired" : `expires ${shortDate(i.expires_at)}`}
                        </small>
                      </span>
                      <span className="row-act">
                        {expired ? null : <CopyButton text={link(i.token)} />}
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() =>
                            act(async () => {
                              const r = await sb.from("workspace_invites").delete().eq("id", i.id);
                              if (made?.invite.id === i.id) setMade(null);
                              return r;
                            }, `The invite for ${i.email} was cancelled.`)
                          }
                        >
                          {expired ? "Remove" : "Cancel invite"}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="sec">
        <div className="sh">
          <h2>What each role can do</h2>
        </div>
        <div className="card list">
          {ROLES.map((r) => (
            <div key={r.id} className="row">
              <p>
                <b>{r.label}:</b> {r.can}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** Owner only. Type the business name, then everything is deleted for good. */
function DeleteWorkspace({ sb, ws, onGone }: { sb: SupabaseClient; ws: Workspace; onGone: (notice: string) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = deleteConfirmMatches(typed, ws.name);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ emailed: boolean }>(sb, "/api/workspace/delete", { workspaceId: ws.id, confirm: typed });
      onGone(out.emailed ? `${ws.name} was deleted. We sent you an email to confirm.` : `${ws.name} was deleted.`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <section className="sec">
      <div className="sh">
        <h2>Delete workspace</h2>
      </div>
      <form onSubmit={remove} className="card pad" autoComplete="off">
        <p className="mb-3 text-[13.5px] text-ink-3">
          This deletes {ws.name} for good: your people, chats, knowledge, approvals and routines, and it cancels your plan. All members lose access. It can&apos;t be undone.
        </p>
        <div className="fld">
          <label className={label} htmlFor="ws-delete">
            Type <strong>{ws.name}</strong> to confirm
          </label>
          <input id="ws-delete" className={input} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <button type="submit" className="btn danger-o" disabled={!ready || busy}>
          {busy ? "Deleting..." : "Delete workspace forever"}
        </button>
      </form>
    </section>
  );
}
