"use client";

// Home works like ChatGPT's new chat screen: one question in the middle of the page and the message box under it.
// Nothing else, so the page is only about asking the team. The trial pill stays at the top while a trial runs.

import { effectivePlan } from "@/lib/plans";
import { trialPill } from "@/lib/home";
import type { ModelChoice } from "@/lib/models";
import { can } from "@/lib/workspace";
import { Composer, useSkillRows } from "./Chat";
import { navigate } from "./nav";
import type { Workspace } from "./Settings";
import type { SupabaseClient } from "@supabase/supabase-js";
import { to } from "./ui";

export function Home({
  sb,
  ws,
  draft,
  onDraft,
  onStart,
  model,
  onModel,
}: {
  sb: SupabaseClient;
  ws: Workspace;
  name: string;
  draft: string;
  onDraft: (v: string) => void;
  onStart: (text: string) => void;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
}) {
  const editor = can(ws.role, "chat");
  const skills = useSkillRows(sb, ws.id);
  const pill = trialPill(effectivePlan(ws));

  return (
    <div className="home-c">
      {pill ? (
        <a
          className={`trialbar${pill.warn ? " warn" : ""}`}
          href={to("/billing")}
          onClick={(e) => {
            e.preventDefault();
            navigate("/billing");
          }}
        >
          {pill.lead} <b>{pill.strong}</b> · {pill.cta} →
        </a>
      ) : null}
      <div className="home-mid">
        <h1 className="home-q">What can your team do for you?</h1>
        <Composer
          value={draft}
          onChange={onDraft}
          onSend={onStart}
          disabled={!editor}
          placeholder={
            editor
              ? "Ask anything. Type @ to tag a teammate, or / for a skill"
              : "Viewers can read chats but can't send messages."
          }
          autoFocus={editor}
          skills={skills}
          down
          rows={2}
          model={model}
          onModel={onModel}
        />
      </div>
    </div>
  );
}
