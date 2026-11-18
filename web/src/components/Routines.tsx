"use client";

// Routines: a teammate does the same job on a schedule (supabase/014_routines_skills_memory.sql). Ported from the old
// app's Routines page (app/public/app.js renderRoutines). Everyone in the workspace sees them; editors and up add,
// pause, delete and run them now. The list runs as the signed-in person, so row level security decides.
// Run now opens a new chat and streams the routine there (POST /api/chat with routineId).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { cleanRoutine, DAYS, DEFAULT_DAYS, DEFAULT_TIME, daysText, MAX_ROUTINES, timeText, type Routine } from "@/lib/routines";
import { AGENTS, workingAgents, type AgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { message, navigate } from "./nav";
import { ConfirmButton, type Workspace } from "./Settings";
import { Face } from "./Team";
import { btnPrimary, btnSecondary, btnSmall, card, ErrorText, input, label } from "./ui";

const COLUMNS = "id, agent, title, instruction, days, at_time, enabled, last_run_at, last_note, last_thread_id";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function RoutinesPage({ sb, ws, onRun }: { sb: SupabaseClient; ws: Workspace; onRun: (r: Routine) => void }) {
  const editor = can(ws.role, "editRoutines");
  const [rows, setRows] = useState<Routine[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

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

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 font-serif text-[30px] leading-tight">Routines</h1>
        <p className="text-[15px] text-ink-3">Jobs your team does on a schedule. Each run opens a new chat. Times are in {ws.timezone.replace(/_/g, " ")}.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {adding ? (
        <RoutineForm
          sb={sb}
          ws={ws}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      ) : editor && rows && rows.length < MAX_ROUTINES ? (
        <div>
          <button type="button" className={`${btnPrimary} sm:w-auto`} onClick={() => setAdding(true)}>
            Add a routine
          </button>
        </div>
      ) : null}
      {rows && !rows.length && !adding ? (
        <div className="rounded-[12px] bg-sunk px-4 py-3 text-[14px] text-ink-3">No routines yet. For example: every Monday at 8:00 AM, Aphrodite plans the week&apos;s posts.</div>
      ) : null}
      {rows?.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
              <Face agent={r.agent} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-[15px] font-semibold">{r.title}</p>
                  {!r.enabled ? <span className="rounded-full bg-sunk px-2.5 py-0.5 text-[12px] text-ink-3">Paused</span> : null}
                </div>
                <p className="text-[14px] text-ink-3">
                  {AGENTS[r.agent].god}. {daysText(r.days)} at {timeText(r.at_time)}.
                  {r.last_run_at ? ` Last ran ${shortDate(r.last_run_at)}.` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-ink-2">{r.instruction}</p>
                {r.last_note ? <p className="mt-1 text-[14px] text-clay-2">{r.last_note}</p> : null}
                {r.last_thread_id ? (
                  <button type="button" className="mt-1 text-[14px] font-medium text-clay-2 underline-offset-2 hover:underline" onClick={() => navigate(`/chat/${r.last_thread_id}`)}>
                    Open the last run
                  </button>
                ) : null}
              </div>
              {editor ? (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button type="button" className={btnSmall} onClick={() => onRun(r)}>
                    Run now
                  </button>
                  <button type="button" className={btnSmall} onClick={() => act(() => sb.from("routines").update({ enabled: !r.enabled }).eq("id", r.id).eq("workspace_id", ws.id))}>
                    {r.enabled ? "Pause" : "Turn on"}
                  </button>
                  <ConfirmButton label="Delete" confirm="Yes, delete" onConfirm={() => act(() => sb.from("routines").delete().eq("id", r.id).eq("workspace_id", ws.id))} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {rows && rows.length >= MAX_ROUTINES ? <p className="text-[14px] text-ink-3">You have {MAX_ROUTINES} routines, the most you can have. Delete one to add another.</p> : null}
    </section>
  );
}

function RoutineForm({ sb, ws, onClose, onSaved }: { sb: SupabaseClient; ws: Workspace; onClose: () => void; onSaved: () => void }) {
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
    <form className={card} onSubmit={save}>
      <h2 className="text-[18px] font-semibold">New routine</h2>
      <div>
        <label className={label} htmlFor="rt-agent">
          Teammate
        </label>
        <select id="rt-agent" className={input} value={agent} onChange={(e) => setAgent(e.target.value as AgentKey)}>
          {team.map((k) => (
            <option key={k} value={k}>
              {AGENTS[k].god}, {AGENTS[k].name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="rt-title">
          Name
        </label>
        <input id="rt-title" className={input} value={title} maxLength={120} placeholder="Plan next week's posts" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className={label} htmlFor="rt-what">
          What to do
        </label>
        <textarea
          id="rt-what"
          className={`${input} h-28 py-2`}
          value={instruction}
          maxLength={4000}
          placeholder="Look at last week's results and draft 5 posts for next week. Type / and a skill name to use one, like /plan-weekly-posts."
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <fieldset>
        <legend className={label}>Days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px] ${days.includes(i) ? "border-ink bg-sunk font-medium" : "border-line"}`}>
              <input type="checkbox" className="sr-only" checked={days.includes(i)} onChange={() => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i].sort()))} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={label} htmlFor="rt-time">
          Time ({ws.timezone.replace(/_/g, " ")})
        </label>
        <input id="rt-time" type="time" className={`${input} sm:w-40`} value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={`${btnPrimary} sm:w-auto`} disabled={busy}>
          {busy ? "Saving..." : "Save routine"}
        </button>
        <button type="button" className={`${btnSecondary} sm:w-auto`} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
