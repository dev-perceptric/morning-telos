"use client";

// The staff console (/staff and /staff/<workspace id>): every customer workspace for the Morning Telos team, with the
// top strip, search, and one workspace's details on the right, like the Approvals page's list and pane. Everything
// comes from POST /api/staff/<action> (src/lib/staff.ts), which answers 404 to anyone who isn't staff.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ago } from "@/lib/home";
import { PRODUCT_NAME, type Product } from "@/lib/partner";
import type { EffectivePlan } from "@/lib/plans";
import { PLANS } from "@/lib/plans";
import { isStaffPlan, MAX_TRIAL_DAYS, PLAN_ORDER, planPatch, readDays, searchWorkspaces, STAFF_PLANS, trialEndingSoon, type StaffAction, type StaffApproval, type StaffJob, type StaffService, type StaffSummary, type StaffWorkspace } from "@/lib/staff";
import { AGENTS, isAgentKey } from "@/lib/team";
import { Icon } from "./icons";
import { callApi, message, navigate } from "./nav";
import { Dropdown, Empty, ErrorText, input, Notice, PageHead, Section, to } from "./ui";

type Overview = { summary: StaffSummary; workspaces: StaffWorkspace[] };
type Detail = { workspace: StaffWorkspace; services: StaffService[]; failedJobs: StaffJob[]; staleApprovals: StaffApproval[]; actions: (StaffAction & { line: string })[] };

const PLAN_LABEL: Record<EffectivePlan, string> = { trial: "Trial", starter: "Starter", pro: "Pro", internal: "Internal", expired: "Expired" };
const PLAN_TONE: Record<EffectivePlan, string> = { trial: "clay", starter: "green", pro: "green", internal: "", expired: "red" };
const SERVICE_TONE: Record<string, string> = { ready: "green", pending: "clay", waiting: "amber", failed: "red", removing: "", removed: "" };

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "None");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const productName = (p: string) => PRODUCT_NAME[p as Product] ?? p;

function PlanTag({ plan }: { plan: EffectivePlan }) {
  return <span className={`tag ${PLAN_TONE[plan]}`}>{PLAN_LABEL[plan]}</span>;
}

/** Whether the signed-in person is staff, for the nav link. Anyone else gets 404 and sees nothing. */
export function useIsStaff(sb: SupabaseClient): boolean {
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    let live = true;
    callApi<{ staff?: boolean }>(sb, "/api/staff/me", {})
      .then((r) => live && setStaff(r.staff === true))
      .catch(() => live && setStaff(false));
    return () => {
      live = false;
    };
  }, [sb]);
  return staff;
}

export function StaffPage({ sb, id }: { sb: SupabaseClient; id: string | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [q, setQ] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    callApi<Overview>(sb, "/api/staff/overview", {})
      .then((d) => {
        if (!live) return;
        setData(d);
        setError("");
      })
      .catch((e) => {
        if (!live) return;
        if (message(e) === "Not found.") setMissing(true);
        else setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [sb, version]);

  if (missing) return <Empty title="Page not found">This page doesn&apos;t exist.</Empty>;
  const rows = data ? searchWorkspaces(data.workspaces, q) : [];
  const s = data?.summary;
  const cells: [string, string, string][] = [
    ["Workspaces", s ? String(s.workspaces) : "·", s ? PLAN_ORDER.filter((p) => s.byPlan[p]).map((p) => `${PLAN_LABEL[p]} ${s.byPlan[p]}`).join(", ") || "None yet" : ""],
    ["Trials ending", s ? String(s.trialsEnding) : "·", "In the next 3 days"],
    ["Failed jobs", s ? String(s.failedJobs) : "·", "In the last day"],
    ["AI spend", s ? usd(s.aiMonth) : "·", "This month"],
    ["Dropped emails", s ? String(s.droppedEmails ?? 0) : "·", "To team addresses, this month"],
  ];

  return (
    <>
      <PageHead title="Staff" sub="Every customer workspace. Only the Morning Telos team can see this page.">
        <button type="button" className="btn" onClick={reload}>
          <Icon name="refresh" small />
          Refresh
        </button>
      </PageHead>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="card kpis">
        {cells.map(([l, v, note]) => (
          <div key={l} className="kpi">
            <small>{l}</small>
            <b>{v}</b>
            <em className="flat">{note}</em>
          </div>
        ))}
      </div>
      <Section title="Workspaces" num={data ? rows.length : undefined}>
        <div className="field mb-3">
          <Icon name="search" small className="ico" />
          <input aria-label="Search workspaces" placeholder="Search by business name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className={`split${id ? " has-pick" : ""}`}>
          <div className="card list">
            {data === null ? null : rows.length ? (
              rows.map((w) => (
                <button key={w.id} type="button" aria-current={id === w.id ? "true" : undefined} className={`row${id === w.id ? " sel" : ""}`} onClick={() => navigate(`/staff/${w.id}`)}>
                  <span className="main">
                    <b>{w.name}</b>
                    <small>{w.ownerEmail ?? "No owner"}</small>
                  </span>
                  <span className="meta">{usd(w.aiMonth)}</span>
                  <PlanTag plan={w.effective} />
                </button>
              ))
            ) : (
              <Empty title={q ? "No matches" : "No workspaces yet"}>{q ? "Try another name or email." : "New sign-ups show up here."}</Empty>
            )}
          </div>
          <div className="card pad pane">
            <a
              className="back m-only"
              href={to("/staff")}
              onClick={(e) => {
                e.preventDefault();
                navigate("/staff");
              }}
            >
              <Icon name="back" small />
              Workspaces
            </a>
            {id ? <WorkspaceDetail key={`${id}:${version}`} sb={sb} id={id} onChanged={reload} /> : <Empty title="Pick a workspace">Its plan, setup, jobs and approvals show up here.</Empty>}
          </div>
        </div>
      </Section>
    </>
  );
}

function WorkspaceDetail({ sb, id, onChanged }: { sb: SupabaseClient; id: string; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState("");
  const [plan, setPlan] = useState<string>("");
  const [days, setDays] = useState("7");
  const [asking, setAsking] = useState<"" | "plan" | "trial">("");
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    callApi<Detail>(sb, "/api/staff/workspace", { workspaceId: id })
      .then((x) => {
        if (!live) return;
        setD(x);
        setPlan((p) => p || x.workspace.plan);
        setError("");
      })
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [sb, id, n]);

  const act = async (action: "plan" | "trial" | "retry", body: Record<string, unknown>, ok: string) => {
    setBusy(action === "retry" ? `retry:${body.jobId}` : action);
    setAsking("");
    setError("");
    setDone("");
    try {
      await callApi(sb, `/api/staff/${action}`, { workspaceId: id, ...body });
      setDone(ok);
      setN((x) => x + 1);
      onChanged();
    } catch (e) {
      setError(message(e));
    }
    setBusy("");
  };

  if (!d) return error ? <ErrorText>{error}</ErrorText> : <p className="hint-s">Loading...</p>;
  const w = d.workspace;
  const pickedDays = readDays(days);
  const samePlan = isStaffPlan(plan) && plan === w.plan && planPatch(plan).status === w.status;
  const planName = (p: string) => (p in PLANS ? PLANS[p as keyof typeof PLANS].name : p);
  const facts: [string, React.ReactNode][] = [
    ["Owner", w.ownerEmail ?? "None"],
    ["Website", w.website ?? "None"],
    ["Plan saved", `${planName(w.plan)}${w.status ? `, ${w.status.replace(/_/g, " ")}` : ""}`],
    ["Plan in force", <PlanTag key="p" plan={w.effective} />],
    ["Trial ends", `${day(w.trialEndsAt)}${w.effective === "trial" ? ` (${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"} left)` : ""}`],
    ["Members", String(w.members)],
    ["AI spend this month", w.allowance === null ? usd(w.aiMonth) : `${usd(w.aiMonth)} of ${usd(w.allowance)}`],
    ["Created", day(w.createdAt)],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="sh mb-1">
          <h2 className="wrap">{w.name}</h2>
          {trialEndingSoon(w) ? <span className="tag amber">Trial ends soon</span> : null}
        </div>
        <p className="hint-s">Workspace {w.id}</p>
      </div>
      {done ? <Notice>{done}</Notice> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <dl className="kv2">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="k">{k}</dt>
            <dd className="v">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">Change plan</h3>
        {w.stripe ? <p className="hint-s">Stripe bills this workspace. Stripe may set the plan back on its next update.</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown label="Plan" value={plan} onChange={(v) => {
              setPlan(v);
              setAsking("");
            }} items={STAFF_PLANS.map((p) => ({ v: p, t: PLANS[p].name }))} />
          {asking === "plan" ? (
            <>
              <button type="button" className="btn sm primary" disabled={busy !== ""} onClick={() => act("plan", { plan }, `Plan set to ${planName(plan)}.`)}>
                Yes, set {planName(plan)}
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking("")}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn sm" disabled={busy !== "" || samePlan} onClick={() => setAsking("plan")}>
              {busy === "plan" ? "Saving..." : "Change plan"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">Extend trial</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Days to add" type="number" min={1} max={MAX_TRIAL_DAYS} inputMode="numeric" className={`${input} w-24`} value={days} onChange={(e) => {
              setDays(e.target.value);
              setAsking("");
            }} />
          <span className="hint-s">days</span>
          {asking === "trial" && pickedDays ? (
            <>
              <button type="button" className="btn sm primary" disabled={busy !== ""} onClick={() => act("trial", { days: pickedDays }, `Trial extended by ${pickedDays} day${pickedDays === 1 ? "" : "s"}.`)}>
                Yes, add {pickedDays} day{pickedDays === 1 ? "" : "s"}
              </button>
              <button type="button" className="btn sm" onClick={() => setAsking("")}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn sm" disabled={busy !== "" || !pickedDays} onClick={() => setAsking("trial")}>
              {busy === "trial" ? "Saving..." : "Extend trial"}
            </button>
          )}
        </div>
        {!pickedDays ? <p className="hint-s">Enter 1 to {MAX_TRIAL_DAYS} days.</p> : null}
      </div>

      <Part title="Setup" num={d.services.length}>
        {d.services.length ? (
          d.services.map((s) => (
            <div key={s.product} className="row items-start">
              <span className="main">
                <b>{productName(s.product)}</b>
                <small className="wrap">{[s.brand_id ? `Brand ${s.brand_id}` : "No brand yet", s.key_prefix ? `key ${s.key_prefix}` : null, `updated ${ago(s.updated_at)}`].filter(Boolean).join(", ")}</small>
                {s.last_error ? <p className="mt-1 text-[13px] text-ink-3">{s.last_error}</p> : null}
              </span>
              <span className={`tag ${SERVICE_TONE[s.status] ?? ""}`}>{s.status}</span>
            </div>
          ))
        ) : (
          <Empty title="No services">This workspace has no setup rows.</Empty>
        )}
      </Part>

      <Part title="Failed jobs" num={d.failedJobs.length}>
        {d.failedJobs.length ? (
          d.failedJobs.map((j) => (
            <div key={j.id} className="row items-start">
              <span className="main">
                <b>{j.kind.replace(/_/g, " ")}</b>
                <small>
                  Job {j.id}, {j.attempts} tries, last tried {when(j.run_at)}
                </small>
                {j.last_error ? <p className="mt-1 text-[13px] text-ink-3">{j.last_error}</p> : null}
              </span>
              <button type="button" className="btn sm" disabled={busy !== ""} onClick={() => act("retry", { jobId: j.id }, `Job ${j.id} will run again within a minute.`)}>
                {busy === `retry:${j.id}` ? "Sending..." : "Retry"}
              </button>
            </div>
          ))
        ) : (
          <Empty title="No failed jobs">Every job is done or still trying.</Empty>
        )}
      </Part>

      <Part title="Approvals waiting over a day" num={d.staleApprovals.length}>
        {d.staleApprovals.length ? (
          d.staleApprovals.map((a) => (
            <div key={a.id} className="row">
              <span className="main">
                <b>{a.title}</b>
                <small>{isAgentKey(a.agent) ? AGENTS[a.agent].god : a.agent}</small>
              </span>
              <span className="meta">{ago(a.created_at)}</span>
            </div>
          ))
        ) : (
          <Empty title="Nothing waiting">No approval has waited more than a day.</Empty>
        )}
      </Part>

      <Part title="Staff changes" num={d.actions.length}>
        {d.actions.length ? (
          d.actions.map((a) => (
            <div key={a.id} className="row">
              <span className="main">
                <b>{a.line}</b>
                <small>{a.staff_email ?? "Staff"}</small>
              </span>
              <span className="meta">{when(a.created_at)}</span>
            </div>
          ))
        ) : (
          <Empty title="No changes yet">Changes staff make here show up in this list.</Empty>
        )}
      </Part>
    </div>
  );
}

function Part({ title, num, children }: { title: string; num: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[14px] font-semibold">
        {title}
        {num ? <span className="ml-2 text-[12px] font-medium text-ink-4">{num}</span> : null}
      </h3>
      <div className="card list">{children}</div>
    </div>
  );
}
