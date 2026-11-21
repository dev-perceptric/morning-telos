"use client";

// Billing, like the current app's Billing page (app/public/app.js renderBilling): the plan in force with this period's
// AI meter, then the plans. The owner picks a plan (Stripe Checkout) or manages it (Stripe's portal); everyone else
// sees where things stand. Stripe sends people back to /billing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { effectivePlan, PAID_PLANS, PLANS, type PaidPlan } from "@/lib/plans";
import { callApi, message } from "./nav";
import type { Workspace } from "./Settings";
import { ErrorText, Notice, PageHead, Section } from "./ui";

type Usage = { plan: string; daysLeft: number; used: number; allowance: number | null; percent: number; hasBilling: boolean };

const BLURB: Record<PaidPlan, string> = {
  starter: "Your full AI team with a monthly AI allowance.",
  pro: "Your full AI team with a bigger AI allowance.",
};

/** `embedded`: drawn inside Settings, which shows the title, so only the Manage billing button stays. */
export function BillingPage({ sb, ws, onChanged, embedded = false }: { sb: SupabaseClient; ws: Workspace; onChanged: () => void; embedded?: boolean }) {
  const owner = ws.role === "owner";
  const plan = effectivePlan(ws);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [usageError, setUsageError] = useState(false);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState(() => (new URLSearchParams(window.location.search).get("checkout") === "done" ? "Thanks! Your plan is active." : ""));

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("checkout")) window.history.replaceState(null, "", window.location.pathname);
    let live = true;
    callApi<Usage>(sb, "/api/billing/usage", { workspaceId: ws.id })
      .then((u) => live && setUsage(u))
      .catch(() => live && setUsageError(true));
    return () => {
      live = false;
    };
  }, [sb, ws.id]);

  const choose = async (p: PaidPlan) => {
    setBusy(p);
    setError("");
    try {
      const out = await callApi<{ url?: string; changed?: boolean }>(sb, "/api/billing/checkout", { workspaceId: ws.id, plan: p });
      track("plan_chosen", { plan: p });
      if (out.url) return window.location.assign(out.url);
      if (out.changed) {
        setDone(`You're on ${PLANS[p].name} now.`);
        onChanged();
      }
    } catch (e) {
      setError(message(e));
    }
    setBusy("");
  };
  const portal = async () => {
    setBusy("portal");
    setError("");
    try {
      const out = await callApi<{ url: string }>(sb, "/api/billing/portal", { workspaceId: ws.id });
      window.location.assign(out.url);
    } catch (e) {
      setError(message(e));
      setBusy("");
    }
  };

  const name = plan.plan === "trial" ? "Free trial" : plan.plan === "internal" ? "Morning Telos team" : plan.plan === "expired" ? "No plan" : PLANS[plan.plan].name;
  const badge = plan.plan === "trial" ? `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left` : plan.plan === "expired" ? "Ended" : (plan.status ?? "active").replace(/_/g, " ");

  return (
    <>
      {(() => {
        const manage =
          owner && usage?.hasBilling ? (
            <button type="button" className="btn" onClick={portal} disabled={busy !== ""}>
              {busy === "portal" ? "Opening..." : "Manage billing"}
            </button>
          ) : null;
        return embedded ? (
          manage ? <div className="set-act">{manage}</div> : null
        ) : (
          <PageHead title="Billing" sub="Your plan and how much of this period's AI allowance your team has used.">
            {manage}
          </PageHead>
        );
      })()}
      {done ? <Notice>{done}</Notice> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="card pad">
        <div className="sh mb-1">
          <h2>{name}</h2>
          <span className={`status${plan.plan === "expired" || plan.status === "past_due" ? " wait" : ""}`}>{badge}</span>
        </div>
        {plan.plan === "internal" ? (
          <p className="text-[13.5px] text-ink-3">No limits for the Morning Telos team.</p>
        ) : (
          <>
            <div className="meter">
              <i style={{ width: `${usage?.percent ?? 0}%` }} />
            </div>
            <p className="text-[13px] text-ink-3">{usage
                ? `${usage.percent}% of this period's AI allowance used.`
                : plan.plan === "expired"
                  ? "Pick a plan to keep your team working."
                  : usageError
                    ? "We couldn't read your AI use right now. Try again later."
                    : "Checking your AI use..."}</p>
          </>
        )}
      </div>
      <Section title="Plans">
        <div className="plans">
          {PAID_PLANS.map((p) => {
            const current = plan.plan === p;
            return (
              <div key={p} className={`card plan${current ? " cur" : ""}`}>
                <h3>{PLANS[p].name}</h3>
                <span className="price">${PLANS[p].price}/month</span>
                <p>{BLURB[p]}</p>
                {current ? (
                  <span className="btn sm static">Current plan</span>
                ) : owner ? (
                  <button type="button" className="btn primary sm" onClick={() => choose(p)} disabled={busy !== ""}>
                    {busy === p ? "Opening..." : `Choose ${PLANS[p].name}`}
                  </button>
                ) : (
                  <span className="hint-s mt-2">The workspace owner can pick a plan.</span>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
