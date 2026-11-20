"use client";

// The Use cases page, like the approved demo: results to pick from, in groups, each run by one teammate with the
// business's own apps. "See how it works" opens the teammate's page and "Try in chat" starts a chat with the use
// case's starter message (src/lib/useCases.ts), the same way Home starts one.

import { useState } from "react";
import { AGENTS } from "@/lib/team";
import { starterMessage, USE_CASE_GROUPS, casesIn, type UseCase, type UseCaseGroup } from "@/lib/useCases";
import { can } from "@/lib/workspace";
import { Face } from "./Chat";
import { Logos } from "./Home";
import { navigate } from "./nav";
import type { Workspace } from "./Settings";
import { PageHead, to } from "./ui";

export function UseCasesPage({ ws, onTry }: { ws: Workspace; onTry: (text: string) => void }) {
  const [only, setOnly] = useState<UseCaseGroup | null>(null);
  const editor = can(ws.role, "chat");
  const groups = USE_CASE_GROUPS.filter((g) => !only || g.id === only);
  return (
    <>
      <PageHead title="Use cases" sub="Pick a result. The right teammate runs it with your own apps." />
      <div className="chips uc-tabs" role="group" aria-label="Show">
        <button type="button" className={`chip${only === null ? " on" : ""}`} aria-pressed={only === null} onClick={() => setOnly(null)}>
          All
        </button>
        {USE_CASE_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`chip${only === g.id ? " on" : ""}`} aria-pressed={only === g.id} onClick={() => setOnly(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g.id} className="uc-sec">
          <h2>{g.label}</h2>
          <div className="uc-grid">
            {casesIn(g.id).map((u) => (
              <UseCaseCard key={u.id} u={u} editor={editor} onTry={onTry} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function UseCaseCard({ u, editor, onTry }: { u: UseCase; editor: boolean; onTry: (text: string) => void }) {
  const a = AGENTS[u.agent];
  const page = `/team/${u.agent}`;
  return (
    <article className="card uc">
      <div className="uc-apps">{u.apps.length ? <Logos ids={u.apps} /> : <Face agent={u.agent} size={28} />}</div>
      <h3>{u.title}</h3>
      <span className="uc-who">
        {a.god} · {a.name}
      </span>
      <p>{u.line}</p>
      <ul>
        {u.outcomes.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>
      <div className="ft">
        <a
          href={to(page)}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate(page);
          }}
        >
          See how it works →
        </a>
        {editor ? (
          <button type="button" className="btn primary sm" onClick={() => onTry(starterMessage(u))}>
            Try in chat
          </button>
        ) : null}
      </div>
    </article>
  );
}
