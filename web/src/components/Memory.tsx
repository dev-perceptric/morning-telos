"use client";

// Memory: facts the team learned about the business in chats and keeps (supabase/014_routines_skills_memory.sql).
// Teammates save them with the remember tool. Everyone in the workspace sees each fact, the chat it came from and
// when, and can delete one that's wrong. The list runs as the signed-in person, so row level security decides.
// The current app has no Memory page, so this one is built from its list rows (.card.list, .row).

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ago } from "@/lib/home";
import { MAX_MEMORIES, type Memory } from "@/lib/memory";
import { AGENTS, isAgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { Face } from "./Chat";
import { Icon } from "./icons";
import { message, navigate } from "./nav";
import type { Workspace } from "./Settings";
import { Empty, ErrorText, PageHead } from "./ui";

export function MemoryPage({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const remove = can(ws.role, "deleteMemory");
  const [rows, setRows] = useState<Memory[] | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("memories").select("id, agent, fact, thread_id, created_at").eq("workspace_id", ws.id).order("created_at", { ascending: false });
    if (error) return setError(/memories/.test(error.message) ? "Memory isn't set up yet. Try again soon." : error.message);
    setError("");
    setRows((data ?? []) as Memory[]);
  }, [sb, ws.id]);
  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function drop(id: string) {
    setError("");
    setAsking(null);
    const { error } = await sb.from("memories").delete().eq("id", id).eq("workspace_id", ws.id);
    if (error) return setError(message(error));
    setRows((xs) => xs?.filter((m) => m.id !== id) ?? null);
  }

  return (
    <>
      <PageHead title="Memory" sub={`Facts your team learned about ${ws.name} in chats. Every teammate reads them. Delete any that are wrong or out of date.`}>
        {rows?.length ? (
          <span className="meta-pill">
            {rows.length} of {MAX_MEMORIES} facts
          </span>
        ) : null}
      </PageHead>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="card list">
        {rows === null ? null : rows.length ? (
          rows.map((m) => {
            const k = isAgentKey(m.agent) ? m.agent : "chief";
            return (
              <div key={m.id} className="row items-start">
                <Face agent={k} />
                <span className="main">
                  <span className="fact">{m.fact}</span>
                  <small className="wrap">
                    {isAgentKey(m.agent) ? `For ${AGENTS[m.agent].god} · ` : "For everyone · "}saved {ago(m.created_at)}
                    {m.thread_id ? (
                      <>
                        {" · "}
                        <button type="button" className="link-u" onClick={() => navigate(`/chat/${m.thread_id}`)}>
                          Open the chat
                        </button>
                      </>
                    ) : null}
                  </small>
                </span>
                {remove ? (
                  asking === m.id ? (
                    <span className="rt-act">
                      <button type="button" className="btn sm danger" onClick={() => drop(m.id)}>
                        Yes, delete
                      </button>
                      <button type="button" className="btn sm" onClick={() => setAsking(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="icon-btn" aria-label="Delete this fact" title="Delete this fact" onClick={() => setAsking(m.id)}>
                      <Icon name="trash" small />
                    </button>
                  )
                ) : null}
              </div>
            );
          })
        ) : (
          <Empty title="Nothing saved yet">When you tell your team something they should keep, like your hours or how you like posts to sound, they save it here.</Empty>
        )}
      </div>
    </>
  );
}
