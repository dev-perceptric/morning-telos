"use client";

// Workspace settings: the business details, members and invites, social accounts, and deleting the workspace.
// Copied from Arrowsterr's SettingsPage.tsx, MembersPage.tsx and WorkspaceSettings.tsx (TimezoneSetting), trimmed down.
// Row level security in Supabase decides what each person may change. These screens only hide what they can't do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/routes";
import { ASSIGNABLE, can, cleanSettings, deleteConfirmMatches, inviteLink, memberActions, roleLabel, ROLES, type MemberRow, type Role } from "@/lib/workspace";
import { callApi, message, navigate } from "./nav";
import { SocialSettings } from "./Social";
import { btnDanger, btnPrimary, btnSmall, card, ErrorText, input, label, Notice } from "./ui";

export type Workspace = { id: string; name: string; website: string | null; timezone: string; plan: string; trial_ends_at: string; role: Role };
type Invite = { id: string; email: string; role: Role; token: string; expires_at: string; expired?: boolean };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function SettingsPage({
  sb,
  ws,
  userId,
  tab,
  onChanged,
  onGone,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  userId: string;
  tab: SettingsTab;
  /** Load the workspace list again after a change. */
  onChanged: () => void;
  /** The person left or deleted this workspace. */
  onGone: (notice: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <nav className="flex shrink-0 flex-col gap-1 md:w-44" aria-label="Settings">
        <h1 className="mb-3 font-serif text-[30px] leading-tight">Settings</h1>
        <div className="flex gap-1 md:flex-col">
          {SETTINGS_TABS.map((t) => (
            <a
              key={t.id}
              href={t.id === "general" ? "/settings" : `/settings/${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(t.id === "general" ? "/settings" : `/settings/${t.id}`);
              }}
              className={`rounded-[9px] px-3 py-2 text-[15px] ${tab === t.id ? "bg-sunk font-semibold text-ink" : "text-ink-3 hover:bg-sunk hover:text-ink"}`}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {tab === "general" ? (
          <>
            <GeneralSettings key={ws.id} sb={sb} ws={ws} onChanged={onChanged} />
            {can(ws.role, "deleteWorkspace") ? <DeleteWorkspace key={`del-${ws.id}`} sb={sb} ws={ws} onGone={onGone} /> : null}
          </>
        ) : tab === "members" ? (
          <MembersSettings key={ws.id} sb={sb} ws={ws} userId={userId} onGone={onGone} />
        ) : (
          <SocialSettings key={`social-${ws.id}`} sb={sb} ws={ws} />
        )}
      </div>
    </div>
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
    <form onSubmit={save} className={card}>
      <div>
        <h2 className="text-[18px] font-semibold">Your business</h2>
        <p className="text-[14px] text-ink-3">{editable ? "Your team uses these details in their work." : "Only admins and the owner can change these."}</p>
      </div>
      <div>
        <label className={label} htmlFor="ws-name">
          Business name
        </label>
        <input id="ws-name" className={input} value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={120} required />
      </div>
      <div>
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
      <div>
        <label className={label} htmlFor="ws-tz">
          Time zone
        </label>
        <select id="ws-tz" className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!editable}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[13px] text-ink-4">Your team uses this for schedules and dates.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {saved && !changed ? <Notice>Saved.</Notice> : null}
      {editable ? (
        <div>
          <button type="submit" className={`${btnPrimary} sm:w-auto`} disabled={busy || !changed}>
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

/** A button that asks "are you sure" in place before it acts. */
function ConfirmButton({ label: text, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className={btnSmall} onClick={() => setAsking(true)}>
        {text}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className={`${btnSmall} border-red text-red`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirm}
      </button>
      <button type="button" className={btnSmall} onClick={() => setAsking(false)}>
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
      className={btnSmall}
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

      <section className={card}>
        <div>
          <h2 className="text-[18px] font-semibold">Members</h2>
          <p className="text-[14px] text-ink-3">People who can use {ws.name} on Morning Telos.</p>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {(members ?? []).map((m) => {
            const may = memberActions(me, m);
            const who = m.email ?? "this person";
            return (
              <li key={m.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-all text-[15px]">
                  {m.email ?? "Unknown"}
                  {m.user_id === userId ? <span className="text-ink-4"> (you)</span> : null}
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {may.changeRole ? (
                    <select
                      aria-label={`Role for ${who}`}
                      className="h-9 rounded-[9px] border border-line bg-surface px-2 text-[14px]"
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
                    <span className="rounded-full bg-sunk px-2.5 py-1 text-[13px] text-ink-2">{roleLabel(m.role)}</span>
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
              </li>
            );
          })}
          {members === null ? <li className="py-3 text-[14px] text-ink-4">Loading...</li> : null}
        </ul>
      </section>

      {admin ? (
        <section className={card}>
          <div>
            <h2 className="text-[18px] font-semibold">Invite someone</h2>
            <p className="text-[14px] text-ink-3">They get a link to join. It works for 7 days.</p>
          </div>
          <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              aria-label="Email to invite"
              placeholder="teammate@yourbusiness.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={input}
            />
            <select aria-label="Role" className={`${input} sm:w-36`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <button type="submit" className={`${btnPrimary} sm:w-auto sm:shrink-0`} disabled={busy}>
              {busy ? "Inviting..." : "Send invite"}
            </button>
          </form>
          {made ? (
            <div className="flex flex-col gap-3 rounded-[10px] bg-clay-bg px-4 py-3 text-[14px] text-ink-2">
              <span>
                {made.emailed
                  ? `We emailed an invite to ${made.invite.email}. You can also send them this link.`
                  : made.emailError || `Send this link to ${made.invite.email}. They sign up or log in with that email to join.`}
              </span>
              <code className="break-all font-mono text-[13px]">{made.link}</code>
              <div>
                <CopyButton text={made.link} />
              </div>
            </div>
          ) : null}

          {invites.length ? (
            <div className="flex flex-col">
              <h3 className="mb-1 text-[14px] font-semibold text-ink-2">Waiting to join</h3>
              <ul className="flex flex-col divide-y divide-line">
                {invites.map((i) => {
                  const expired = Boolean(i.expired);
                  return (
                    <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 break-all text-[15px]">
                        {i.email}{" "}
                        <span className="text-[13px] text-ink-4">
                          {roleLabel(i.role)}, {expired ? "expired" : `expires ${shortDate(i.expires_at)}`}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2 sm:justify-end">
                        {expired ? null : <CopyButton text={link(i.token)} />}
                        <button
                          type="button"
                          className={btnSmall}
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
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={card}>
        <h2 className="text-[18px] font-semibold">What each role can do</h2>
        <ul className="flex flex-col gap-1.5 text-[15px]">
          {ROLES.map((r) => (
            <li key={r.id}>
              <strong>{r.label}:</strong> {r.can}
            </li>
          ))}
        </ul>
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
    <form onSubmit={remove} className={`${card} border-[#f0cfc2]`}>
      <div>
        <h2 className="text-[18px] font-semibold text-red">Delete this workspace</h2>
        <p className="text-[14px] text-ink-3">
          This deletes {ws.name} for good. All members lose access, and every chat, file and setting is gone. You can&apos;t undo it.
        </p>
      </div>
      <div>
        <label className={label} htmlFor="ws-delete">
          Type <strong>{ws.name}</strong> to confirm
        </label>
        <input id="ws-delete" className={input} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div>
        <button type="submit" className={btnDanger} disabled={!ready || busy}>
          {busy ? "Deleting..." : "Delete workspace"}
        </button>
      </div>
    </form>
  );
}
