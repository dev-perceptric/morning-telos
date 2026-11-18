"use client";

// Routines: a teammate does the same job on a schedule (supabase/014_routines_skills_memory.sql). Laid out like the
// old app's Routines page (app/public/app.js renderRoutines): one list with Run now, an on and off switch and delete,
// and New routine in a side sheet. Everyone in the workspace sees them; editors and up add, pause, delete and run
// them now. The list runs as the signed-in person, so row level security decides.
// Run now opens a new chat and streams the routine there (POST /api/chat with routineId).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ago } from "@/lib/home";
import { cleanRoutine, DAYS, DEFAULT_DAYS, DEFAULT_TIME, daysText, MAX_ROUTINES, timeText, type Routine } from "@/lib/routines";
import { AGENTS, workingAgents, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, input, label, PageHead, Switch } from "./ui";

const COLUMNS = "id, agent, title, instruction, days, at_time, enabled, last_run_at, last_note, last_thread_id";

export function RoutinesPage({ sb, ws, onRun }: { sb: SupabaseClient; ws: Workspace; onRun: (r: Routine) => void }) {
  const editor = can(ws.role, "editRoutines");
  const [rows, setRows] = useState<Routine[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("routines").select(COLUMNS).eq("workspace_id", ws.id).order("created_at");
    if (error) return setError(/routines/.test(error.message) ? "Routines aren't set up yet. Try again soon." : error.message);
    setError("");
    setRows((data ?? []) as Routine[]);
  }, [sb, ws.id]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError("");
    const { error } = await fn();
    if (error) return setError(message(error));
    load();
  };
  const full = Boolean(rows && rows.length >= MAX_ROUTINES);
  const closeForm = useCallback(() => setAdding(false), []);

  return (
    <>
      <PageHead title="Routines" sub={`Work that runs on a schedule, whether you open the app or not. Times are in ${ws.timezone.replace(/_/g, " ")}.`}>
        {editor && rows && !full ? (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" small />
            New routine
          </button>
        ) : null}
      </PageHead>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="card list">
        {rows === null ? null : rows.length ? (
          rows.map((r) => (
            <div key={r.id} className="row rt-row">
              <Face agent={r.agent} />
              <span className="main">
                <b className="wrap">{r.title}</b>
                <small className="wrap">
                  {AGENTS[r.agent].god} · {daysText(r.days)} at {timeText(r.at_time)}
                  {r.last_run_at ? ` · last ran ${ago(r.last_run_at)}` : ""}
                </small>
                <span className="rt-what">{r.instruction}</span>
                {r.last_note ? <span className="rt-note">{r.last_note}</span> : null}
                {r.last_thread_id ? (
                  <button type="button" className="link-u self-start text-[12.5px]" onClick={() => navigate(`/chat/${r.last_thread_id}`)}>
                    Open the last run
                  </button>
                ) : null}
              </span>
              {editor ? (
                <span className="rt-act">
                  {asking === r.id ? (
                    <>
                      <button type="button" className="btn sm danger" onClick={() => act(() => sb.from("routines").delete().eq("id", r.id).eq("workspace_id", ws.id))}>
                        Yes, delete
                      </button>
                      <button type="button" className="btn sm" onClick={() => setAsking(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn sm ghost" onClick={() => onRun(r)}>
                        Run now
                      </button>
                      <Switch on={r.enabled} label={`${r.title} on or off`} onChange={(on) => act(() => sb.from("routines").update({ enabled: on }).eq("id", r.id).eq("workspace_id", ws.id))} />
                      <button type="button" className="icon-btn" aria-label="Delete routine" title="Delete routine" onClick={() => setAsking(r.id)}>
                        <Icon name="trash" small />
                      </button>
                    </>
                  )}
                </span>
              ) : (
                <span className={`status${r.enabled ? "" : " idle"}`}>{r.enabled ? "On" : "Paused"}</span>
              )}
            </div>
          ))
        ) : (
          <Empty title="No routines yet">Example: every Monday at 8am, Aphrodite plans the week&apos;s posts.</Empty>
        )}
      </div>
      {full ? <p className="hint-s">You have {MAX_ROUTINES} routines, the most you can have. Delete one to add another.</p> : null}
      <Drawer open={adding} title="New routine" onClose={closeForm}>
        <RoutineForm
          sb={sb}
          ws={ws}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      </Drawer>
    </>
  );
}

function RoutineForm({ sb, ws, onSaved }: { sb: SupabaseClient; ws: Workspace; onSaved: () => void }) {
  const team = workingAgents();
  const [agent, setAgent] = useState<AgentKey>("social");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [at, setAt] = useState(DEFAULT_TIME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const c = cleanRoutine({ agent, title, instruction, days, at_time: at });
    if (!c.ok) return setError(c.error);
    setBusy(true);
    setError("");
    const { error } = await sb.from("routines").insert({ workspace_id: ws.id, ...c.value });
    setBusy(false);
    if (error) return setError(message(error));
    onSaved();
  }

  return (
    <form onSubmit={save}>
      <div className="fld">
        <label className={label} htmlFor="rt-agent">
          Teammate
        </label>
        <select id="rt-agent" className="sel" value={agent} onChange={(e) => setAgent(e.target.value as AgentKey)}>
          {team.map((k) => (
            <option key={k} value={k}>
              {AGENTS[k].god} · {AGENTS[k].name}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label className={label} htmlFor="rt-title">
          Name
        </label>
        <input id="rt-title" className={input} value={title} maxLength={120} placeholder="Plan next week's posts" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="fld">
        <label className={label} htmlFor="rt-what">
          What to do
        </label>
        <textarea
          id="rt-what"
          className="ta"
          value={instruction}
          maxLength={4000}
          placeholder="Look at last week's results and draft 5 posts for next week. Type / and a skill name to use one, like /plan-weekly-posts."
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <fieldset className="fld">
        <legend className={label}>Days</legend>
        <div className="daypick">
          {DAYS.map((d, i) => (
            <label key={d}>
              <input type="checkbox" checked={days.includes(i)} onChange={() => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i].sort()))} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="fld">
        <label className={label} htmlFor="rt-time">
          Time ({ws.timezone.replace(/_/g, " ")})
        </label>
        <input id="rt-time" type="time" className={input} value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Saving..." : "Save routine"}
      </button>
    </form>
  );
}
