"use client";

// Memory: facts the team learned about the business in chats and keeps (supabase/014_routines_skills_memory.sql).
// Teammates save them with the remember tool. Everyone in the workspace sees each fact, the chat it came from and
// when, and can delete one that's wrong. The list runs as the signed-in person, so row level security decides.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { MAX_MEMORIES, type Memory } from "@/lib/memory";
import { AGENTS, isAgentKey } from "@/lib/team";
import { can } from "@/lib/workspace";
import { message, navigate } from "./nav";
import { ConfirmButton, type Workspace } from "./Settings";
import { ErrorText } from "./ui";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function MemoryPage({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const remove = can(ws.role, "deleteMemory");
  const [rows, setRows] = useState<Memory[] | null>(null);
  const [error, setError] = useState("");

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
    const { error } = await sb.from("memories").delete().eq("id", id).eq("workspace_id", ws.id);
    if (error) return setError(message(error));
    setRows((xs) => xs?.filter((m) => m.id !== id) ?? null);
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 font-serif text-[30px] leading-tight">Memory</h1>
        <p className="text-[15px] text-ink-3">Facts your team learned about {ws.name} in chats. Every teammate reads them. Delete any that are wrong or out of date.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {rows && !rows.length ? (
        <div className="rounded-[12px] bg-sunk px-4 py-3 text-[14px] text-ink-3">Nothing saved yet. When you tell your team something they should keep, like your hours or how you like posts to sound, they save it here.</div>
      ) : null}
      {rows?.length ? (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
            {rows.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-[15px] text-ink">{m.fact}</p>
                  <p className="text-[13px] text-ink-4">
                    {isAgentKey(m.agent) ? `For ${AGENTS[m.agent].god}. ` : ""}Saved {shortDate(m.created_at)}.{" "}
                    {m.thread_id ? (
                      <button type="button" className="font-medium text-clay-2 underline-offset-2 hover:underline" onClick={() => navigate(`/chat/${m.thread_id}`)}>
                        Open the chat
                      </button>
                    ) : null}
                  </p>
                </div>
                {remove ? <ConfirmButton label="Delete" confirm="Yes, delete" onConfirm={() => drop(m.id)} /> : null}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-ink-4">
            {rows.length} of {MAX_MEMORIES} facts.
          </p>
        </>
      ) : null}
    </section>
  );
}
