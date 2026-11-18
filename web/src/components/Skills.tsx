"use client";

// Skills settings: the playbooks each teammate follows (src/lib/skills.ts). System skills are ours and read-only;
// Workspace skills are the team's own (supabase/014_routines_skills_memory.sql). Everyone sees them; owners and
// admins add, change and delete Workspace skills. A Workspace skill with a System skill's name takes its place,
// so "Make my own copy" is how a team changes one. Copied from Omniscient's Skills page, trimmed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { cleanSkill, MAX_SKILLS, skillFromRow, SYSTEM_SKILLS, type Skill, type SkillRow } from "@/lib/skills";
import { AGENTS, workingAgents, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { message } from "./nav";
import { ConfirmButton, type Workspace } from "./Settings";
import { Face } from "./Chat";
import { ErrorText, input, label } from "./ui";

type Draft = { id: string | null; agent: AgentKey | ""; name: string; description: string; body: string };

export function SkillsSettings({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const admin = can(ws.role, "editSkills");
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("skills").select("id, agent, name, description, body, updated_at").eq("workspace_id", ws.id).order("name");
    if (error) return setError(/skills/.test(error.message) ? "Skills aren't set up yet. Try again soon." : error.message);
    setError("");
    setRows((data ?? []) as SkillRow[]);
  }, [sb, ws.id]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const own = (rows ?? []).map(skillFromRow);
  const forEveryone = own.filter((s) => s.agent === null);

  async function drop(id: string) {
    setError("");
    const { error } = await sb.from("skills").delete().eq("id", id).eq("workspace_id", ws.id);
    if (error) return setError(message(error));
    load();
  }

  return (
    <>
      <div className="sh">
        <h2>Skills</h2>
        {admin && !draft && own.length < MAX_SKILLS ? (
          <button type="button" className="btn primary sm" onClick={() => setDraft({ id: null, agent: "", name: "", description: "", body: "" })}>
            Add a skill
          </button>
        ) : null}
      </div>
      <p className="hint-s mb-3">
        Step by step ways your teammates do a job. Type / in a chat to pick one, or let the teammate pick. {admin ? "Add your own, or make your own copy of one of ours to change it." : "Owners and admins can add your own."}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {draft ? (
        <SkillForm
          sb={sb}
          ws={ws}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            load();
          }}
        />
      ) : null}
      {forEveryone.length ? (
        <section className="app-grp">
          <h3 className="grp-h">For everyone</h3>
          <SkillList list={forEveryone} admin={admin} onEdit={(s) => setDraft(toDraft(s))} onDelete={drop} />
        </section>
      ) : null}
      {workingAgents().map((k) => {
        const mine = own.filter((s) => s.agent === k);
        const ours = SYSTEM_SKILLS.filter((s) => s.agent === k && !mine.some((m) => m.name === s.name));
        return (
          <section key={k} className="app-grp">
            <h3 className="grp-h flex items-center gap-2">
              <Face agent={k} size={22} />
              {AGENTS[k].god} <span className="font-normal text-ink-4">· {AGENTS[k].name}</span>
            </h3>
            <SkillList
              list={[...mine, ...ours]}
              admin={admin}
              onEdit={(s) => setDraft(toDraft(s))}
              onCopy={(s) => setDraft({ ...toDraft(s), id: null })}
              onDelete={drop}
            />
          </section>
        );
      })}
    </>
  );
}

const toDraft = (s: Skill): Draft => ({ id: s.scope === "workspace" ? s.key : null, agent: s.agent ?? "", name: s.name, description: s.description, body: s.body });

function SkillList({ list, admin, onEdit, onCopy, onDelete }: { list: Skill[]; admin: boolean; onEdit: (s: Skill) => void; onCopy?: (s: Skill) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return <div className="card empty">No skills yet.</div>;
  return (
    <div className="card list">
      {list.map((s) => (
        <div key={s.key} className="skill-r">
          <div className="row wrap-row">
            <span className="main">
              <b className="flex flex-wrap items-center gap-2">
                /{s.name}
                <span className="tag">{s.scope === "system" ? "Ours" : "Yours"}</span>
              </b>
              <small className="wrap">{s.description}</small>
            </span>
            <span className="row-act">
              <button type="button" className="btn sm ghost" onClick={() => setOpen(open === s.key ? null : s.key)}>
                {open === s.key ? "Hide steps" : "Show steps"}
              </button>
              {admin && s.scope === "system" && onCopy ? (
                <button type="button" className="btn sm" onClick={() => onCopy(s)}>
                  Make my own copy
                </button>
              ) : null}
              {admin && s.scope === "workspace" ? (
                <>
                  <button type="button" className="btn sm" onClick={() => onEdit(s)}>
                    Edit
                  </button>
                  <ConfirmButton label="Delete" confirm="Yes, delete" onConfirm={() => onDelete(s.key)} />
                </>
              ) : null}
            </span>
          </div>
          {open === s.key ? <pre className="kbody steps-b">{s.body}</pre> : null}
        </div>
      ))}
    </div>
  );
}

function SkillForm({ sb, ws, draft, onClose, onSaved }: { sb: SupabaseClient; ws: Workspace; draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const c = cleanSkill(d);
    if (!c.ok) return setError(c.error);
    setBusy(true);
    setError("");
    const { error } = d.id ? await sb.from("skills").update(c.value).eq("id", d.id).eq("workspace_id", ws.id) : await sb.from("skills").insert({ workspace_id: ws.id, ...c.value });
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "This teammate already has a skill with that name. Pick another name." : message(error));
    onSaved();
  }

  return (
    <form className="card pad mb-4" onSubmit={save}>
      <div className="sh">
        <h2>{d.id ? "Edit skill" : "New skill"}</h2>
      </div>
      <div className="fld">
        <label className={label} htmlFor="sk-agent">
          Who uses it
        </label>
        <select id="sk-agent" className="sel" value={d.agent} onChange={(e) => set({ agent: e.target.value as AgentKey | "" })}>
          <option value="">Everyone</option>
          {workingAgents().map((k) => (
            <option key={k} value={k}>
              {AGENTS[k].god}, {AGENTS[k].name}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label className={label} htmlFor="sk-name">
          Name
        </label>
        <input id="sk-name" className={input} value={d.name} maxLength={64} placeholder="welcome-new-customers" onChange={(e) => set({ name: e.target.value })} />
        <small>People type / and this name to pick it.</small>
      </div>
      <div className="fld">
        <label className={label} htmlFor="sk-desc">
          When to use it
        </label>
        <textarea id="sk-desc" className="ta" style={{ minHeight: 80 }} value={d.description} maxLength={1000} placeholder="Use it when someone asks to welcome a new customer." onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="fld">
        <label className={label} htmlFor="sk-body">
          Steps and rules
        </label>
        <textarea id="sk-body" className="ta code" style={{ minHeight: 260 }} value={d.body} maxLength={20000} onChange={(e) => set({ body: e.target.value })} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="rv-act">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Saving..." : "Save skill"}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
