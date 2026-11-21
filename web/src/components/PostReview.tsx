"use client";

// Aphrodite's posts inside an approval card (Approvals page and chat): where each one goes, when, and the words,
// instead of the raw fields. Editing changes the words and the time; the rules are in src/lib/socialWork.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { fromInputs, inputsOf, timeOf } from "@/lib/calendar";
import { networkName } from "@/lib/socialChannels";
import { postWhen, type ReviewPost } from "@/lib/socialWork";
import { NetworkMark } from "./Social";

type Chan = { channel_id: string; network: string; name: string };
const format = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${timeOf(d)}`;
};

export function PostReview({
  sb,
  wsId,
  posts,
  editing,
  onEdit,
}: {
  sb: SupabaseClient;
  wsId: string;
  posts: ReviewPost[];
  editing: boolean;
  onEdit: (index: number | null, edit: { text?: string; at?: string | null }) => void;
}) {
  const [chans, setChans] = useState<Chan[]>([]);
  useEffect(() => {
    let live = true;
    sb.from("social_channels")
      .select("channel_id, network, name")
      .eq("workspace_id", wsId)
      .then(({ data }) => live && setChans((data ?? []) as Chan[]));
    return () => {
      live = false;
    };
  }, [sb, wsId]);
  const chan = (id: string) => chans.find((c) => c.channel_id === id);

  return (
    <div className="prv">
      {posts.map((p, i) => {
        const list = p.channelIds.map(chan).filter((c): c is Chan => !!c);
        const first = list[0];
        const where = [...new Set(list.map((c) => networkName(c.network)))].join(", ");
        return (
          <div key={p.index ?? i} className="po-prev">
            <div className="who">
              {first ? <NetworkMark network={first.network} size={36} /> : null}
              <span className="min-w-0 flex-1">
                <b className="wrap">{first ? first.name || networkName(first.network) : "Your account"}</b>
                <small>
                  {where ? `${where}. ` : ""}
                  {postWhen(p, format)}
                </small>
              </span>
              {p.mode === "draft" ? <span className="tag">Draft</span> : null}
              {posts.length > 1 ? <span className="hint-s">{`${i + 1} of ${posts.length}`}</span> : null}
            </div>
            {editing ? <EditPost p={p} onEdit={(e) => onEdit(p.index, e)} /> : <p>{p.text}</p>}
            {p.media ? <p className="prv-media">{p.media === 1 ? "1 image or video" : `${p.media} images or videos`}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function EditPost({ p, onEdit }: { p: ReviewPost; onEdit: (e: { text?: string; at?: string | null }) => void }) {
  const start = p.at ? inputsOf(new Date(p.at)) : { day: "", time: "" };
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time);
  const id = `prv-${p.index ?? "u"}`;
  const setAt = (d: string, t: string) => {
    const at = fromInputs(d, t);
    if (at) onEdit({ at });
  };
  return (
    <div className="po-f">
      <label htmlFor={`${id}-text`}>Post</label>
      <textarea id={`${id}-text`} defaultValue={p.text} onChange={(e) => onEdit({ text: e.target.value })} />
      {p.at ? (
        <div className="row2">
          <div>
            <label htmlFor={`${id}-day`}>Day</label>
            <input
              id={`${id}-day`}
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setAt(e.target.value, time);
              }}
            />
          </div>
          <div>
            <label htmlFor={`${id}-time`}>Time</label>
            <input
              id={`${id}-time`}
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setAt(day, e.target.value);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
