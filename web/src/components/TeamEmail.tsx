"use client";

// Settings > General: "Email your team". The workspace's address with Copy, a one-time change of the address, the
// on/off switch and "Also accept email from" (src/lib/teamEmail.ts, supabase/023_team_email.sql). Hidden until the
// server has TEAM_EMAIL_DOMAIN (POST /api/email/team), so nothing shows before receiving is set up.
// Members read it; only the owner changes it. Row level security and the SQL functions check that again.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { checkSlug, cleanSender, teamAddress, TEAM_EMAIL_MESSAGES as M } from "@/lib/teamEmail";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { ErrorText, input, label, Switch } from "./ui";

type Row = { slug: string; enabled: boolean; slug_changed_at: string | null };

export function TeamEmailSettings({ sb, ws, userId }: { sb: SupabaseClient; ws: Workspace; userId: string }) {
  const owner = ws.role === "owner";
  const [domain, setDomain] = useState<string | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [senders, setSenders] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState("");
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const on = await callApi<{ domain: string | null }>(sb, "/api/email/team", { workspaceId: ws.id }).catch(() => ({ domain: null }));
      if (!live || !on.domain) return;
      const [a, s] = await Promise.all([
        sb.from("team_email").select("slug, enabled, slug_changed_at").eq("workspace_id", ws.id).maybeSingle(),
        sb.from("team_email_senders").select("email").eq("workspace_id", ws.id).order("created_at"),
      ]);
      if (!live) return;
      if (a.error || s.error) setError(message(a.error ?? s.error));
      setDomain(on.domain);
      setRow((a.data as Row | null) ?? null);
      setSenders(((s.data ?? []) as { email: string }[]).map((x) => x.email));
    })();
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  if (!domain || !row) return null;
  const address = teamAddress(row.slug, domain);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const saveSlug = (e: React.FormEvent) => {
    e.preventDefault();
    const v = checkSlug(slug);
    if (!v.ok) return setError(v.error);
    return act(async () => {
      const { data, error } = await sb.rpc("set_team_email_slug", { p_ws: ws.id, p_slug: v.value });
      if (error) throw error;
      const next = String(data ?? v.value);
      setRow({ ...row, slug: next, slug_changed_at: next === row.slug ? row.slug_changed_at : new Date().toISOString() });
      setEditing(false);
    });
  };

  const toggle = (on: boolean) =>
    act(async () => {
      const { error } = await sb.rpc("set_team_email_enabled", { p_ws: ws.id, p_on: on });
      if (error) throw error;
      setRow({ ...row, enabled: on });
    });

  const addSender = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cleanSender(extra);
    if (!v.ok) return setError(v.error);
    if (senders.includes(v.value)) return setError(M.sameSender);
    if (senders.length >= 20) return setError(M.tooManySenders);
    return act(async () => {
      const { error } = await sb.from("team_email_senders").insert({ workspace_id: ws.id, email: v.value, added_by: userId });
      if (error) throw error;
      setSenders([...senders, v.value]);
      setExtra("");
    });
  };

  const removeSender = (email: string) =>
    act(async () => {
      const { error } = await sb.from("team_email_senders").delete().eq("workspace_id", ws.id).eq("email", email);
      if (error) throw error;
      setSenders(senders.filter((s) => s !== email));
    });

  return (
    <section className="card pad mt-4">
      <div className="sh">
        <h2>{M.title}</h2>
        {owner ? <Switch on={row.enabled} label={M.on} disabled={busy} onChange={toggle} /> : null}
      </div>
      <p className="hint-s mb-3">{M.intro}</p>
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 text-[14px] wrap">{address}</b>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            navigator.clipboard?.writeText(address).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? M.copied : M.copy}
        </button>
        {owner && !row.slug_changed_at && !editing ? (
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setSlug(row.slug);
              setEditing(true);
            }}
          >
            {M.change}
          </button>
        ) : null}
      </div>
      {!row.enabled ? <p className="hint-s mt-2">{M.offNote}</p> : null}
      {owner && editing ? (
        <form onSubmit={saveSlug} className="mt-3">
          <div className="fld">
            <label className={label} htmlFor="team-slug">
              {M.change}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="team-slug" className={input} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} autoCapitalize="none" spellCheck={false} />
              <span className="text-[13px] text-ink-4">@{domain}</span>
            </div>
            <small>{M.changeOnce}</small>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn primary sm" disabled={busy}>
              {M.save}
            </button>
            <button type="button" className="btn sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {owner && row.slug_changed_at ? <p className="hint-s mt-2">{M.changedOnce}</p> : null}

      <h3 className="mt-4 text-[13px] font-semibold">{M.extraTitle}</h3>
      <p className="hint-s mb-2">{M.extraHint}</p>
      {senders.length ? (
        <ul className="flex flex-col gap-1">
          {senders.map((s) => (
            <li key={s} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-[13.5px] wrap">{s}</span>
              {owner ? (
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => removeSender(s)}>
                  {M.remove}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint-s">{M.noExtra}</p>
      )}
      {owner ? (
        <form onSubmit={addSender} className="mt-2 flex flex-wrap items-center gap-2">
          <input className={input} type="email" placeholder="name@example.com" aria-label={M.extraTitle} value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={200} />
          <button type="submit" className="btn sm" disabled={busy || !extra.trim()}>
            {M.add}
          </button>
        </form>
      ) : (
        <p className="hint-s mt-2">{M.ownerOnly}</p>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </section>
  );
}
