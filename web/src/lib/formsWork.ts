// Cleo's Calendar tab (src/components/Meetings.tsx): the business's meetings from Google Calendar (or Calendly when
// Google isn't connected), the invites Cleo is waiting to send, and what a person can do to a meeting.
// Reads run on the workspace's own Composio connection. Invites Cleo made while on "Ask me first" are pending
// approvals of GOOGLECALENDAR_CREATE_EVENT, shown as "waiting"; approving goes through /api/approvals/<id>.
// Pure: the route in src/app/api/work/forms passes the connections and the Composio calls in as deps.

type Result = { status: number; body: Record<string, unknown> };
type Gate = (min: "owner" | "admin" | "editor" | "viewer") => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;

export type CalSource = "googlecalendar" | "calendly";
/** One thing on Cleo's calendar. "busy": the owner's own time (no guests), shown gray and not opened. */
export type Meeting = {
  key: string;
  source: CalSource;
  id: string | null;
  status: "wait" | "booked" | "busy" | "done";
  title: string;
  start: string;
  end: string;
  guests: string[];
  link: string | null;
  approvalId: number | null;
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isoOf = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The first list in Composio's answer: Google puts events in `items`, Calendly in `collection`, some wrap it once more. */
export function listIn(data: unknown, keys = ["items", "events", "collection", "data"]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const o = obj(data);
  for (const k of keys) if (Array.isArray(o[k])) return listIn(o[k]);
  for (const k of keys) if (o[k] && typeof o[k] === "object") return listIn(o[k], keys);
  return [];
}

/** The first video link in Google's conference data. */
const meetLink = (c: unknown) => {
  const points = obj(c).entryPoints;
  return Array.isArray(points) ? str(obj(points.find((p) => obj(p).entryPointType === "video") ?? points[0]).uri, 500) : "";
};

/** Google Calendar's events. With guests besides the owner it's a meeting; without, busy time. */
export function googleMeetings(data: unknown, now: number): Meeting[] {
  const out: Meeting[] = [];
  for (const e of listIn(data)) {
    if (e.status === "cancelled") continue;
    const s = obj(e.start), en = obj(e.end);
    const start = isoOf(s.dateTime) ?? isoOf(s.date);
    const end = isoOf(en.dateTime) ?? isoOf(en.date) ?? start;
    if (!start || !end) continue;
    const guests = (Array.isArray(e.attendees) ? e.attendees : [])
      .map(obj)
      .filter((a) => !a.self && !a.resource && a.responseStatus !== "declined")
      .map((a) => str(a.displayName, 120) || str(a.email, 200))
      .filter(Boolean);
    const id = str(e.id, 200) || null;
    out.push({
      key: `g:${id ?? start}`,
      source: "googlecalendar",
      id,
      status: !guests.length ? "busy" : Date.parse(end) < now ? "done" : "booked",
      title: str(e.summary, 200) || (guests.length ? "Meeting" : "Busy"),
      start,
      end,
      guests,
      link: str(e.hangoutLink, 500) || meetLink(e.conferenceData) || null,
      approvalId: null,
    });
  }
  return out;
}

/** Calendly's scheduled events. Every one is a meeting someone booked. */
export function calendlyMeetings(data: unknown, now: number): Meeting[] {
  const out: Meeting[] = [];
  for (const e of listIn(data)) {
    if (e.status === "canceled") continue;
    const start = isoOf(e.start_time), end = isoOf(e.end_time) ?? start;
    if (!start || !end) continue;
    const uri = str(e.uri, 300);
    const id = uri.split("/").pop() || null;
    out.push({
      key: `c:${id ?? start}`,
      source: "calendly",
      id,
      status: Date.parse(end) < now ? "done" : "booked",
      title: str(e.name, 200) || "Meeting",
      start,
      end,
      guests: [],
      link: str(obj(e.location).join_url, 500) || null,
      approvalId: null,
    });
  }
  return out;
}

type ApprovalRow = { id: number; product: string; tool: string; input: Record<string, unknown> | null; status: string };

/** Cleo's invites waiting for the person's OK: pending GOOGLECALENDAR_CREATE_EVENT approvals. */
export function waitingMeetings(rows: readonly ApprovalRow[]): Meeting[] {
  const out: Meeting[] = [];
  for (const r of rows) {
    if (r.status !== "pending" || r.product !== "googlecalendar" || r.tool !== "GOOGLECALENDAR_CREATE_EVENT" || !r.input) continue;
    const start = isoOf(r.input.start_datetime);
    if (!start) continue;
    const mins = (Number(r.input.event_duration_hour) || 0) * 60 + (Number(r.input.event_duration_minutes) || 0);
    const end = isoOf(r.input.end_datetime) ?? new Date(Date.parse(start) + (mins || 30) * 60_000).toISOString();
    const guests = (Array.isArray(r.input.attendees) ? r.input.attendees : []).map((a) => (typeof a === "string" ? a : str(obj(a).email, 200))).filter(Boolean);
    out.push({ key: `a:${r.id}`, source: "googlecalendar", id: null, status: "wait", title: str(r.input.summary, 200) || "Meeting", start, end, guests, link: null, approvalId: r.id });
  }
  return out;
}

/** A range the calendar may ask for: real dates, in order, at most 92 days. */
export function cleanRange(from: unknown, to: unknown): { ok: true; from: string; to: string } | { ok: false } {
  const f = isoOf(from), t = isoOf(to);
  if (!f || !t) return { ok: false };
  const span = Date.parse(t) - Date.parse(f);
  return span > 0 && span <= 92 * 86_400_000 ? { ok: true, from: f, to: t } : { ok: false };
}

/** Cleo's one line: what's coming up in the range, from now on. */
export function formsSummary(meetings: readonly Meeting[], now: number): string | null {
  const coming = meetings.filter((m) => m.status === "booked" && Date.parse(m.start) >= now);
  const waiting = meetings.filter((m) => m.status === "wait").length;
  if (!coming.length && !waiting) return null;
  const parts = [`${coming.length === 1 ? "1 meeting" : `${coming.length} meetings`} coming up`];
  if (waiting) parts.push(`${waiting === 1 ? "1 invite waits" : `${waiting} invites wait`} for your OK`);
  return `${parts.join(", and ")}.`;
}

export const FORMS_MESSAGES = {
  range: "Pick a range of up to 92 days.",
  none: "Connect Google Calendar or Calendly so Cleo can see your meetings.",
  load: "We couldn't load your calendar. Try again.",
  meeting: "That meeting was not found.",
  time: "Pick a start and end time, with the end after the start.",
  past: "Pick a time in the future.",
  action: "That action isn't supported.",
  calendlyMove: "Calendly meetings can't be moved from here. Cancel it, or ask Cleo to find a new time.",
  failed: "That didn't save. Try again.",
};

type Conn = { toolkit: string; status: string };
export type FormsDeps = {
  gate: Gate;
  /** The workspace's Google Calendar and Calendly connections. */
  connections: () => Promise<Conn[]>;
  /** Runs a read on the workspace's connection. Throws with a plain message when it can't. */
  run: (toolkit: CalSource, slug: string, args: Record<string, unknown>) => Promise<unknown>;
  approvals: () => Promise<ApprovalRow[]>;
  now?: () => number;
};

/** GET: the meetings between from and to (viewers and up). */
export async function formsMeetings(q: { from: unknown; to: unknown }, d: FormsDeps): Promise<Result> {
  const who = await d.gate("viewer");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const range = cleanRange(q.from, q.to);
  if (!range.ok) return { status: 400, body: { error: FORMS_MESSAGES.range } };
  const now = (d.now ?? Date.now)();
  const [conns, approvals] = await Promise.all([d.connections(), d.approvals()]);
  const waiting = waitingMeetings(approvals);
  const lost = conns.filter((c) => c.status !== "active").map((c) => c.toolkit);
  const google = conns.find((c) => c.toolkit === "googlecalendar" && c.status === "active");
  const calendly = conns.find((c) => c.toolkit === "calendly" && c.status === "active");
  const source: CalSource | null = google ? "googlecalendar" : calendly ? "calendly" : null;
  const base = { source, lost, approvals: waiting.map((w) => w.approvalId) };
  if (!source) return { status: 200, body: { ...base, meetings: waiting, summary: formsSummary(waiting, now), error: lost.length ? null : FORMS_MESSAGES.none } };
  let meetings: Meeting[];
  try {
    if (source === "googlecalendar") {
      const data = await d.run("googlecalendar", "GOOGLECALENDAR_EVENTS_LIST", { calendarId: "primary", timeMin: range.from, timeMax: range.to, singleEvents: true, orderBy: "startTime", maxResults: 250 });
      meetings = googleMeetings(data, now);
    } else {
      // Calendly answers { resource: { uri } }; Composio sometimes wraps it once more in data.
      const me = obj(await d.run("calendly", "CALENDLY_GET_CURRENT_USER", {}));
      const user = str(obj(me.resource).uri, 300) || str(obj(obj(me.data).resource).uri, 300) || str(me.uri, 300);
      const data = await d.run("calendly", "CALENDLY_LIST_EVENTS", { user, min_start_time: range.from, max_start_time: range.to, status: "active", count: 100 });
      meetings = calendlyMeetings(data, now);
    }
  } catch (e) {
    return { status: 200, body: { ...base, meetings: waiting, summary: null, error: e instanceof Error && e.message ? e.message : FORMS_MESSAGES.load } };
  }
  const all = [...meetings, ...waiting];
  return { status: 200, body: { ...base, meetings: all, summary: formsSummary(all, now) } };
}

export type FormsActDeps = {
  gate: Gate;
  /** Runs a change on the workspace's connection, as the person. Throws with a plain message when it can't. */
  run: (toolkit: CalSource, slug: string, args: Record<string, unknown>) => Promise<unknown>;
  activity: (text: string) => Promise<void>;
  now?: () => number;
};

/** The changes a person may make on Cleo's calendar, by app. Composio runs nothing else from this tab. */
export const SCREEN_ACTIONS: Record<CalSource, { cancel: string; move?: string }> = {
  googlecalendar: { cancel: "GOOGLECALENDAR_DELETE_EVENT", move: "GOOGLECALENDAR_PATCH_EVENT" },
  calendly: { cancel: "CALENDLY_CANCEL_SCHEDULED_EVENT" },
};

/**
 * POST: a change the person makes to a meeting (editors and up). Guests get Google's or Calendly's own update.
 *   { action: "cancel", source, id }
 *   { action: "move", source: "googlecalendar", id, start, end }
 */
export async function formsAct(b: Record<string, unknown>, d: FormsActDeps): Promise<Result> {
  const who = await d.gate("editor");
  if (!who.ok) return { status: who.status, body: { error: who.error } };
  const source = b.source === "googlecalendar" || b.source === "calendly" ? b.source : null;
  const id = str(b.id, 200);
  if (!source || !id) return { status: 400, body: { error: FORMS_MESSAGES.meeting } };
  let slug: string, args: Record<string, unknown>, did: string;
  if (b.action === "cancel") {
    slug = SCREEN_ACTIONS[source].cancel;
    args = source === "googlecalendar" ? { calendar_id: "primary", event_id: id, send_updates: "all" } : { event_uuid: id, reason: "Canceled by the host." };
    did = "canceled a meeting";
  } else if (b.action === "move") {
    if (source !== "googlecalendar") return { status: 400, body: { error: FORMS_MESSAGES.calendlyMove } };
    const start = isoOf(b.start), end = isoOf(b.end);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return { status: 400, body: { error: FORMS_MESSAGES.time } };
    if (Date.parse(start) < (d.now ?? Date.now)() - 60_000) return { status: 400, body: { error: FORMS_MESSAGES.past } };
    slug = SCREEN_ACTIONS.googlecalendar.move!;
    args = { calendar_id: "primary", event_id: id, start_time: start, end_time: end, send_updates: "all" };
    did = "moved a meeting";
  } else return { status: 400, body: { error: FORMS_MESSAGES.action } };
  try {
    await d.run(source, slug, args);
  } catch (e) {
    return { status: 502, body: { error: e instanceof Error && e.message ? e.message : FORMS_MESSAGES.failed } };
  }
  await d.activity(`You ${did} on the calendar.`).catch(() => {});
  return { status: 200, body: { ok: true } };
}
