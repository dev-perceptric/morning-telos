"use client";

// Alexander's Goals tab: every goal the team is working on, with its steps and who owns each, and one drawer to change,
// finish, stop or delete one. Goals are made in chat (set_goal, src/lib/cardTools.ts); editors change them here
// straight in the database, under the goals policies (024_goals.sql).
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { GOAL_STATUS_LABEL, goalStatus, numLabel, type GoalStatus } from "@/lib/cards";
import { GOAL_COLUMNS, goalLine, goalOf, goalPercent, goalsSummary, STEP_COLUMNS, type GoalRow, type StepRow } from "@/lib/goals";
import { AGENTS, type AgentKey } from "@/lib/team";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Drawer, Empty, ErrorText, Notice } from "./ui";

type Item = { goal: GoalRow; status: GoalStatus; steps: StepRow[] };
const TONE: Record<GoalStatus, string> = { on_track: "green", needs_you: "clay", done: "green" };
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function AthenaGoals({ sb, ws, editor, onAsk }: { sb: SupabaseClient; ws: Workspace; editor: boolean; onAsk: (text?: string) => void }) {
  const [view, setView] = useState<"active" | "done">("active");
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      sb.from("goals").select(GOAL_COLUMNS).eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(100),
      sb.from("goal_steps").select(STEP_COLUMNS).eq("workspace_id", ws.id).not("goal_id", "is", null).order("position").limit(800),
      sb.from("approvals").select("thread_id").eq("workspace_id", ws.id).eq("status", "pending").limit(500),
    ]).then(([g, s, a]) => {
      if (!live) return;
      if (g.error || s.error) return setError("We couldn't load the team's goals. Try again.");
      const waiting = new Map<string, number>();
      for (const r of (a.data ?? []) as { thread_id: string | null }[]) if (r.thread_id) waiting.set(r.thread_id, (waiting.get(r.thread_id) ?? 0) + 1);
      const steps = (s.data ?? []) as StepRow[];
      setError("");
      setItems(
        ((g.data ?? []) as Record<string, unknown>[]).map(goalOf).map((goal) => ({
          goal,
          status: goal.status === "stopped" ? "done" : goalStatus(goal, { pending: waiting.get(goal.thread_id) ?? 0 }),
          steps: steps.filter((x) => x.goal_id === goal.id),
        })),
      );
    });
    return () => {
      live = false;
    };
  }, [sb, ws.id, version]);

  const list = (items ?? []).filter((i) => (view === "active" ? i.goal.status === "active" : i.goal.status !== "active"));
  const counts = { active: (items ?? []).filter((i) => i.goal.status === "active").length, done: (items ?? []).filter((i) => i.goal.status !== "active").length };
  const summary = goalsSummary((items ?? []).filter((i) => i.goal.status === "active").map((i) => i.status));

  async function change(fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    const { error: e } = await fn();
    setBusy(false);
    if (e) return setError("That didn't save. Try again.");
    setOpen(null);
    setNote(done);
    setVersion((v) => v + 1);
  }
  // Only the columns editors may change (024_goals.sql grants title, target, unit, due_date and status).
  const update = (id: string, patch: Record<string, unknown>) => sb.from("goals").update(patch).eq("workspace_id", ws.id).eq("id", id);

  return (
    <>
      {summary ? (
        <p className="po-sum">
          <Face agent="chief" size={26} />
          <span>{summary}</span>
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <Notice>{note}</Notice> : null}
      <div className="po-bar">
        <span className="seg" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" aria-checked={view === "active"} onClick={() => setView("active")}>
            Active <span className="seg-n">{counts.active || ""}</span>
          </button>
          <button type="button" role="radio" aria-checked={view === "done"} onClick={() => setView("done")}>
            Done <span className="seg-n">{counts.done || ""}</span>
          </button>
        </span>
        <span className="flex-1" />
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => onAsk("Set a goal: ")}>
            <Icon name="plus" small />
            New goal
          </button>
        ) : null}
      </div>
      <div className="card list vis">
        {list.map((i) => {
          const owners = [...new Set([i.goal.agent, ...i.steps.map((s) => s.agent)])] as AgentKey[];
          const pct = goalPercent(i.goal);
          return (
            <button key={i.goal.id} type="button" className="row" onClick={() => setOpen(i)}>
              <Face agent={i.goal.agent} size={36} />
              <span className="main">
                <b>{goalLine(i.goal)}</b>
                <small>
                  {numLabel(Math.max(0, i.goal.current))} of {numLabel(i.goal.target)} {i.goal.unit}
                  {i.goal.status === "stopped" ? ". Stopped" : ""}
                </small>
              </span>
              <span className="goal-r">
                <span className="faces">
                  {owners.map((a) => (
                    <Face key={a} agent={a} size={22} />
                  ))}
                </span>
                <span className="pg" title={`${pct}% of the way`}>
                  <i style={{ width: `${pct}%` }} />
                </span>
                <span className={`tag ${TONE[i.status]}`}>{i.goal.status === "stopped" ? "Stopped" : GOAL_STATUS_LABEL[i.status]}</span>
              </span>
            </button>
          );
        })}
        {items && !list.length ? (
          view === "active" ? (
            <Empty title="No goals yet">Tell Alexander what you want to reach, like 20 new leads by the end of the month. He splits it into steps for the team.</Empty>
          ) : (
            <Empty title="Nothing done yet">Finished and stopped goals show up here.</Empty>
          )
        ) : null}
        {items === null && !error ? <div className="empty">Loading...</div> : null}
      </div>

      <Drawer open={open !== null} title="Goal" onClose={() => setOpen(null)}>
        {open ? (
          <GoalDrawer
            key={open.goal.id}
            item={open}
            editor={editor}
            busy={busy}
            onSave={(p) => change(() => update(open.goal.id, p), "Saved.")}
            onStatus={(status) => change(() => update(open.goal.id, { status }), status === "done" ? "Marked done." : status === "stopped" ? "Goal stopped." : "Goal started again.")}
            onDelete={() => change(() => sb.from("goals").delete().eq("workspace_id", ws.id).eq("id", open.goal.id), "Goal deleted.")}
          />
        ) : null}
      </Drawer>
    </>
  );
}

const STEP_WORD: Record<StepRow["status"], string> = { todo: "to do", running: "working on it", done: "done" };

function GoalDrawer({
  item,
  editor,
  busy,
  onSave,
  onStatus,
  onDelete,
}: {
  item: Item;
  editor: boolean;
  busy: boolean;
  onSave: (p: { target: number; due_date: string }) => void;
  onStatus: (s: "active" | "done" | "stopped") => void;
  onDelete: () => void;
}) {
  const g = item.goal;
  const [target, setTarget] = useState(String(g.target));
  const [due, setDue] = useState(g.due_date);
  const [asking, setAsking] = useState(false);
  const t = Number(target);
  const valid = Number.isFinite(t) && t > 0 && /^\d{4}-\d{2}-\d{2}$/.test(due);
  const changed = t !== g.target || due !== g.due_date;

  return (
    <>
      <p className="dq">{goalLine(g)}</p>
      <div className="facts dsec">
        <div>
          <small>Now</small>
          <b>
            {numLabel(Math.max(0, g.current))} {g.unit}
          </b>
        </div>
        <div>
          <small>Target</small>
          <b>
            {numLabel(g.target)} {g.unit}
          </b>
        </div>
        <div>
          <small>Due</small>
          <b>{day(g.due_date)}</b>
        </div>
      </div>
      {editor ? (
        <div className="po-f dsec">
          <div className="row2">
            <div>
              <label htmlFor="g-target">Target ({g.unit})</label>
              <input id="g-target" type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <label htmlFor="g-due">Due</label>
              <input id="g-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
        </div>
      ) : null}
      <div className="dsec">
        <h4>Steps</h4>
        {item.steps.length ? (
          <div className="gsteps">
            {item.steps.map((s) => (
              <div key={s.id} className="gstep">
                <Face agent={s.agent} size={28} />
                <span className="mn">
                  <b>{s.title}</b>
                  <small>
                    {AGENTS[s.agent].god}, {STEP_WORD[s.status]}
                  </small>
                </span>
                <i className={`ic ${s.status === "done" ? "done" : ""}`} />
              </div>
            ))}
          </div>
        ) : (
          <p className="hint-s">No steps yet. Ask Alexander to plan them in the goal&apos;s chat.</p>
        )}
      </div>
      <div className="po-foot">
        {editor && g.status === "active" ? (
          <button type="button" className="btn primary" disabled={busy || !valid || !changed} onClick={() => onSave({ target: t, due_date: due })}>
            Save
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => navigate(`/chat/${g.thread_id}`)}>
          <Icon name="message" small />
          Open the goal&apos;s chat
        </button>
        {editor && g.status === "active" ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => onStatus("done")}>
              Mark done
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onStatus("stopped")}>
              Stop
            </button>
          </>
        ) : editor ? (
          <button type="button" className="btn" disabled={busy} onClick={() => onStatus("active")}>
            Start again
          </button>
        ) : null}
        <span className="sp" />
        {editor ? (
          asking ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <button type="button" className="btn sm danger" disabled={busy} onClick={onDelete}>
                Delete goal
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Delete goal" title="Delete goal" onClick={() => setAsking(true)}>
              <Icon name="trash" />
            </button>
          )
        ) : null}
      </div>
    </>
  );
}
