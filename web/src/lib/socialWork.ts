// Aphrodite's Posts tab (src/components/Posts.tsx): what goes on the calendar and what a person can do to it.
// Posts come from Capybaroar with the workspace's brand key. Posts Aphrodite wrote while on "Ask me first" are not in
// Capybaroar yet: they are pending approvals of create_posts or update_post (src/lib/approvals.ts), shown on the
// calendar as "waiting". Approving one goes through /api/approvals/<id>, the same as the Approvals page.
// Pure: the routes in src/app/api/work/social and src/app/api/social/disconnect pass the database, the product calls
// and the partner client in as deps.
import { channelGone, type Partner, type PartnerResult } from "./partner.ts";

type Result = { status: number; body: Record<string, unknown> };
type Gate = (min: "owner" | "admin" | "editor" | "viewer") => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;

/** One thing on the calendar. */
export type PostItem = {
  /** Unique on the page: "p:<post id>" or "a:<approval id>:<index>". */
  key: string;
  /** "wait": waiting for the person's OK. "draft": on the calendar in Capybaroar, not set to go out. */
  status: "wait" | "draft" | "sched" | "done" | "failed";
  text: string;
  /** ISO time it goes out, or null for "as soon as it's approved". */
  at: string | null;
  channelIds: string[];
  /** The Capybaroar post, for changes. */
  postId: string | null;
  /** The approval and which post in it, for waiting ones. */
  approvalId: number | null;
  index: number | null;
  /** A link to what went out. */
  url: string | null;
  /** Likes, comments and shares, when Capybaroar has them. */
  engagements: number | null;
  /** Why it failed, in Capybaroar's words. */
  error: string | null;
};

export type Channel = { id: string; network: string; name: string; status: "connected" | "lost" };

type ApiPost = {
  id: string;
  status: string;
  text: string;
  publish_at: string | null;
  channels?: { channel_id: string; status?: string; url?: string | null; error?: string | null; deleted_at?: string | null }[];
};
type ApprovalRow = { id: number; tool: string; input: Record<string, unknown> | null; status: string };

const STATUS: Record<string, PostItem["status"] | null> = {
  draft: "draft",
  review: "draft",
  scheduled: "sched",
  publishing: "sched",
  published: "done",
  partial: "done",
  failed: "failed",
  deleted: null,
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Capybaroar's posts as calendar items. Deleted posts are left out. `engagements` comes from get_analytics' top posts. */
export function postItems(posts: unknown, engagements: ReadonlyMap<string, number> = new Map()): PostItem[] {
  if (!Array.isArray(posts)) return [];
  const out: PostItem[] = [];
  for (const raw of posts as ApiPost[]) {
    if (!raw || typeof raw.id !== "string") continue;
    const status = STATUS[raw.status];
    if (status === undefined || status === null) continue;
    const chans = (raw.channels ?? []).filter((c) => c && typeof c.channel_id === "string" && !c.deleted_at);
    out.push({
      key: `p:${raw.id}`,
      status,
      text: str(raw.text),
      at: iso(raw.publish_at),
      channelIds: chans.map((c) => c.channel_id),
      postId: raw.id,
      approvalId: null,
      index: null,
      url: chans.find((c) => typeof c.url === "string" && c.url)?.url ?? null,
      engagements: engagements.get(raw.id) ?? null,
      error: status === "failed" ? (chans.find((c) => c.error)?.error ?? null) : null,
    });
  }
  return out;
}

/**
 * Aphrodite's pending approvals as waiting calendar items: each post in a create_posts call, and the new version of
 * a post in an update_post call. Anything else (a delete, a different tool) stays on the Approvals page only.
 */
export function approvalItems(rows: readonly ApprovalRow[]): PostItem[] {
  const out: PostItem[] = [];
  for (const r of rows) {
    if (r.status !== "pending" || !r.input) continue;
    const base = { status: "wait" as const, approvalId: r.id, url: null, engagements: null, error: null };
    if (r.tool === "create_posts") {
      const list = Array.isArray(r.input.posts) ? (r.input.posts as Record<string, unknown>[]) : [];
      list.forEach((p, i) => {
        if (!p || typeof p !== "object") return;
        out.push({ ...base, key: `a:${r.id}:${i}`, text: str(p.text), at: iso(p.publish_at), channelIds: ids(p.channel_ids), postId: null, index: i });
      });
    } else if (r.tool === "update_post" && typeof r.input.id === "string") {
      out.push({ ...base, key: `a:${r.id}:0`, text: str(r.input.text), at: iso(r.input.publish_at), channelIds: ids(r.input.channel_ids), postId: r.input.id, index: null });
    }
  }
  return out;
}

/** A waiting post's approval details with the person's edits, for /api/approvals/<id> to run as they left them. */
export function editedApproval(tool: string, input: Record<string, unknown>, index: number | null, edit: { text?: string; at?: string | null; channelIds?: string[] }): Record<string, unknown> {
  const apply = (p: Record<string, unknown>) => {
    const next = { ...p };
    if (edit.text !== undefined) next.text = edit.text;
    if (edit.at !== undefined) {
      if (edit.at) next.publish_at = edit.at;
      else delete next.publish_at;
    }
    if (edit.channelIds !== undefined) next.channel_ids = edit.channelIds;
    return next;
  };
  if (tool === "create_posts" && Array.isArray(input.posts) && index !== null) {
    return { ...input, posts: (input.posts as Record<string, unknown>[]).map((p, i) => (i === index ? apply(p) : p)) };
  }
  return apply(input);
}

type Analytics = { current?: { posts?: number; reach?: number }; previous?: { reach?: number } };

/** Aphrodite's one line at the top of the tab, from the last 30 days. Null when there's nothing to say yet. */
export function summaryLine(a: Analytics | null): string | null {
  const posts = a?.current?.posts ?? 0;
  const reach = a?.current?.reach ?? 0;
  if (!posts) return null;
  const was = a?.previous?.reach ?? 0;
  const people = reach === 1 ? "1 person" : `${reach.toLocaleString("en-US")} people`;
  let line = `Last 30 days: ${posts === 1 ? "1 post" : `${posts} posts`} reached ${people}.`;
  if (was > 0 && reach !== was) {
    const pct = Math.round((Math.abs(reach - was) / was) * 100);
    if (pct > 0) line += ` That's ${pct}% ${reach > was ? "more" : "less"} than the 30 days before.`;
  }
  return line;
}

const parse = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** A day range the calendar may ask for: both dates real, from before to, at most 92 days (Capybaroar's limit). */
export function cleanRange(from: unknown, to: unknown): { ok: true; from: string; to: string } | { ok: false } {
  const f = iso(from), t = iso(to);
  if (!f || !t) return { ok: false };
  const span = Date.parse(t) - Date.parse(f);
  if (span <= 0 || span > 92 * 86_400_000) return { ok: false };
  return { ok: true, from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}

export const SOCIAL_MESSAGES = {
  setup: "Aphrodite's social media is still setting up. Check back in a few minutes.",
  load: "We couldn't load your posts. Try again.",
  range: "Pick a range of up to 92 days.",
  text: "Write the post first.",
  tooLong: "Keep the post under 5,000 characters.",
  channels: "Pick at least one account.",
  time: "Pick a day and time.",
  past: "Pick a time in the future.",
  action: "That action isn't supported.",
  post: "That post was not found.",
  failed: "That didn't save. Try again.",
  disconnectFailed: "We couldn't disconnect that account. Try again.",
  disconnectMissing: "That account isn't connected.",
};

export type WorkDeps = {
  gate: Gate;
  /** Capybaroar's status for the workspace ("ready" once its brand key works). */
  serviceStatus: () => Promise<string | null>;
  /** A read with the brand key (productRead): the tool's JSON text, or null when it fails. */
  read: (tool: string, input: Record<string, unknown>) => Promise<string | null>;
  /** Aphrodite's pending approvals for Capybaroar. */
  approvals: () => Promise<ApprovalRow[]>;
  /** The workspace's social channels (social_channels). */
  channels: () => Promise<Channel[]>;
};

/** GET: the calendar between from and to (viewers and up). */
export async function socialPosts(q: { from: unknown; to: unknown }, d: WorkDeps): Promise<Result> {
  const who = await d.gate("viewer");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const range = cleanRange(q.from, q.to);
  if (!range.ok) return { status: 400, body: { error: SOCIAL_MESSAGES.range } };
  const [status, channels, approvals] = await Promise.all([d.serviceStatus(), d.channels(), d.approvals()]);
  const waiting = approvalItems(approvals);
  // The waiting posts' full approval details, so an edit can be sent with the approval (editedApproval).
  const pending = approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, tool: a.tool, input: a.input ?? {} }));
  if (status !== "ready") return { status: 200, body: { ready: false, items: waiting, approvals: pending, channels, summary: null } };
  const [postsText, statsText] = await Promise.all([d.read("list_posts", { from: range.from, to: range.to }), d.read("get_analytics", { days: 30 })]);
  const posts = parse(postsText);
  if (!posts) return { status: 200, body: { ready: true, items: waiting, approvals: pending, channels, summary: null, error: SOCIAL_MESSAGES.load } };
  const stats = parse(statsText)?.analytics as (Analytics & { top_posts?: { id: string; engagements: number }[] }) | undefined;
  const engagements = new Map((stats?.top_posts ?? []).filter((t) => t && typeof t.id === "string").map((t) => [t.id, Number(t.engagements) || 0]));
  return { status: 200, body: { ready: true, items: [...postItems(posts.posts, engagements), ...waiting], approvals: pending, channels, summary: summaryLine(stats ?? null) } };
}

export type ActDeps = {
  gate: Gate;
  /** A change with the brand key (productWrite). */
  write: (tool: string, input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  /** Writes one activity line for the team's history. */
  activity: (text: string) => Promise<void>;
  now?: () => number;
};

const MAX_TEXT = 5000;

function cleanPost(b: Record<string, unknown>, now: number, needTime: boolean): { ok: true; text: string; at: string | null; channelIds: string[] } | { ok: false; error: string } {
  const text = str(b.text).trim();
  if (!text) return { ok: false, error: SOCIAL_MESSAGES.text };
  if (text.length > MAX_TEXT) return { ok: false, error: SOCIAL_MESSAGES.tooLong };
  const channelIds = ids(b.channelIds);
  if (!channelIds.length) return { ok: false, error: SOCIAL_MESSAGES.channels };
  const at = iso(b.at);
  if (needTime && !at) return { ok: false, error: SOCIAL_MESSAGES.time };
  if (at && Date.parse(at) < now - 60_000) return { ok: false, error: SOCIAL_MESSAGES.past };
  return { ok: true, text, at, channelIds };
}

/**
 * POST: a change the person makes on the calendar (editors and up, the same people who approve). Runs in Capybaroar
 * right away: it's the person's own change, so it needs no approval. Waiting posts are approved or turned down
 * through /api/approvals/<id> instead.
 *   { action: "create", text, at, channelIds }   a new scheduled post
 *   { action: "save", postId, text, at, channelIds }   change a post that hasn't gone out
 *   { action: "delete", postId }   remove a post from the calendar
 */
export async function socialAct(b: Record<string, unknown>, d: ActDeps): Promise<Result> {
  const who = await d.gate("editor");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const now = (d.now ?? Date.now)();
  const action = b.action;
  const postId = str(b.postId);
  let tool: string, input: Record<string, unknown>, did: string;
  if (action === "create") {
    const p = cleanPost(b, now, true);
    if (!p.ok) return { status: 400, body: { error: p.error } };
    tool = "create_posts";
    input = { posts: [{ channel_ids: p.channelIds, text: p.text, publish_at: p.at, mode: "schedule" }] };
    did = "scheduled a post";
  } else if (action === "save") {
    if (!postId) return { status: 400, body: { error: SOCIAL_MESSAGES.post } };
    const p = cleanPost(b, now, true);
    if (!p.ok) return { status: 400, body: { error: p.error } };
    tool = "update_post";
    input = { id: postId, text: p.text, publish_at: p.at, channel_ids: p.channelIds, mode: "schedule" };
    did = "changed a post";
  } else if (action === "delete") {
    if (!postId) return { status: 400, body: { error: SOCIAL_MESSAGES.post } };
    tool = "delete_post";
    input = { id: postId };
    did = "deleted a post";
  } else return { status: 400, body: { error: SOCIAL_MESSAGES.action } };
  const r = await d.write(tool, input);
  if (!r.ok) return { status: 502, body: { error: r.text || SOCIAL_MESSAGES.failed } };
  await d.activity(`You ${did} on the social calendar.`).catch(() => {});
  return { status: 200, body: { ok: true } };
}

export type DisconnectDeps = {
  gate: Gate;
  /** The workspace's Capybaroar brand id, or null before it's set up. */
  brandId: () => Promise<string | null>;
  partner: () => { ok: true; partner: Pick<Partner, "disconnectChannel"> } | { ok: false; error: string };
  /** The channel as we know it (social_channels), or null. */
  channel: (channelId: string) => Promise<Channel | null>;
  /** Removes the channel from social_channels once Capybaroar has let it go. */
  forget: (channelId: string) => Promise<void>;
  activity: (text: string) => Promise<void>;
  log: (message: string) => void;
};

/** POST { channelId }: disconnects one social account (owners and admins, who connect them). */
export async function disconnectSocial(b: Record<string, unknown>, d: DisconnectDeps): Promise<Result> {
  const who = await d.gate("admin");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const channelId = str(b.channelId).trim();
  if (!channelId || channelId.length > 200) return { status: 400, body: { error: SOCIAL_MESSAGES.disconnectMissing } };
  const chan = await d.channel(channelId);
  if (!chan) return { status: 404, body: { error: SOCIAL_MESSAGES.disconnectMissing } };
  const brand = await d.brandId();
  if (!brand) return { status: 409, body: { error: SOCIAL_MESSAGES.setup } };
  const p = d.partner();
  if (!p.ok) {
    d.log(`Disconnect: ${p.error}`);
    return { status: 503, body: { error: SOCIAL_MESSAGES.disconnectFailed } };
  }
  const r: PartnerResult<null> = await p.partner.disconnectChannel(brand, channelId);
  if (!r.ok && !channelGone(r)) {
    d.log(`Disconnect of channel ${channelId} failed: ${r.status} ${r.code} ${r.message}`);
    return { status: r.retryable ? 503 : 502, body: { error: SOCIAL_MESSAGES.disconnectFailed } };
  }
  // Capybaroar also sends channel.lost, which our webhook would show as "Reconnect". Forgetting the row now keeps a
  // removed account from coming back as one that needs reconnecting.
  await d.forget(channelId);
  await d.activity(`You disconnected ${chan.name || "a social account"}.`).catch(() => {});
  return { status: 200, body: { ok: true } };
}
