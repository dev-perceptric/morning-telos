// Hora's Calendar tab (src/lib/formsWork.ts) and booking rules (src/lib/booking.ts). Every dependency is a fake:
// no Composio, no Google, no Calendly.
import assert from "node:assert/strict";
import test from "node:test";
import { bookingLine, bookingProblem, cleanBooking, daysText, DEFAULT_BOOKING } from "../src/lib/booking.ts";
import { calendlyMeetings, FORMS_MESSAGES, formsAct, formsMeetings, formsSummary, googleMeetings, listIn, SCREEN_ACTIONS, waitingMeetings } from "../src/lib/formsWork.ts";

const rank = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const gateAt = (role: keyof typeof rank) => async (min: keyof typeof rank) =>
  rank[role] >= rank[min] ? { ok: true as const, userId: "u1" } : { ok: false as const, status: 403, error: "Not allowed." };
const NOW = Date.parse("2027-01-06T12:00:00Z");

// ─────────────── reading the calendars ───────────────

const GOOGLE = {
  items: [
    { id: "e1", summary: "Intro call: Maria Lopez", start: { dateTime: "2027-01-07T15:00:00Z" }, end: { dateTime: "2027-01-07T15:30:00Z" }, attendees: [{ email: "me@biz.com", self: true }, { email: "maria@lopez.com", displayName: "Maria Lopez" }, { email: "room@x", resource: true }], hangoutLink: "https://meet.google.com/abc" },
    { id: "e2", summary: "Dentist", start: { dateTime: "2027-01-07T09:00:00Z" }, end: { dateTime: "2027-01-07T10:00:00Z" } },
    { id: "e3", summary: "Kickoff", start: { dateTime: "2027-01-05T14:00:00Z" }, end: { dateTime: "2027-01-05T15:00:00Z" }, attendees: [{ email: "ana@ruiz.com" }], conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://zoom.us/j/1" }] } },
    { id: "e4", summary: "Gone", status: "cancelled", start: { dateTime: "2027-01-08T09:00:00Z" }, end: { dateTime: "2027-01-08T10:00:00Z" } },
    { id: "e5", summary: "Holiday", start: { date: "2027-01-09" }, end: { date: "2027-01-10" } },
    { id: "e6", summary: "Declined only", start: { dateTime: "2027-01-08T11:00:00Z" }, end: { dateTime: "2027-01-08T11:30:00Z" }, attendees: [{ email: "x@y.com", responseStatus: "declined" }] },
    { summary: "No time" },
  ],
};

test("listIn finds the list wherever Composio put it", () => {
  assert.equal(listIn({ items: [{ a: 1 }] }).length, 1);
  assert.equal(listIn({ data: { collection: [{ a: 1 }, { b: 2 }] } }).length, 2);
  assert.equal(listIn([{ a: 1 }, null, "x"]).length, 1);
  assert.deepEqual(listIn({ nothing: true }), []);
  assert.deepEqual(listIn(null), []);
});

test("googleMeetings: meetings with guests, busy time without, done once over, cancelled ones left out", () => {
  const m = googleMeetings(GOOGLE, NOW);
  assert.deepEqual(
    m.map((x) => [x.key, x.status, x.title, x.guests, x.link]),
    [
      ["g:e1", "booked", "Intro call: Maria Lopez", ["Maria Lopez"], "https://meet.google.com/abc"],
      ["g:e2", "busy", "Dentist", [], null],
      ["g:e3", "done", "Kickoff", ["ana@ruiz.com"], "https://zoom.us/j/1"],
      ["g:e5", "busy", "Holiday", [], null],
      ["g:e6", "busy", "Declined only", [], null],
    ],
  );
  assert.equal(m[0].start, "2027-01-07T15:00:00.000Z");
});

test("calendlyMeetings: every active booking is a meeting, with its id from the uri", () => {
  const m = calendlyMeetings(
    {
      collection: [
        { uri: "https://api.calendly.com/scheduled_events/ABC123", name: "30 Minute Meeting", start_time: "2027-01-07T16:00:00Z", end_time: "2027-01-07T16:30:00Z", status: "active", location: { join_url: "https://zoom.us/j/2" } },
        { uri: "https://api.calendly.com/scheduled_events/OLD", name: "Old", start_time: "2027-01-01T16:00:00Z", end_time: "2027-01-01T16:30:00Z", status: "active" },
        { uri: "https://api.calendly.com/scheduled_events/X", name: "Canceled", start_time: "2027-01-08T16:00:00Z", end_time: "2027-01-08T16:30:00Z", status: "canceled" },
      ],
    },
    NOW,
  );
  assert.deepEqual(m.map((x) => [x.key, x.id, x.status, x.link]), [
    ["c:ABC123", "ABC123", "booked", "https://zoom.us/j/2"],
    ["c:OLD", "OLD", "done", null],
  ]);
});

test("waitingMeetings: Hora's pending invites, with the end from the length when there's no end", () => {
  const w = waitingMeetings([
    { id: 9, product: "googlecalendar", tool: "GOOGLECALENDAR_CREATE_EVENT", status: "pending", input: { summary: "Intro: Dan", start_datetime: "2027-01-08T14:00:00Z", event_duration_minutes: 45, attendees: ["dan@price.com", { email: "x@y.com" }] } },
    { id: 10, product: "googlecalendar", tool: "GOOGLECALENDAR_CREATE_EVENT", status: "pending", input: { start_datetime: "2027-01-09T14:00:00Z", end_datetime: "2027-01-09T15:00:00Z" } },
    { id: 11, product: "gmail", tool: "GMAIL_SEND_EMAIL", status: "pending", input: { to: "a@b.com" } },
    { id: 12, product: "googlecalendar", tool: "GOOGLECALENDAR_CREATE_EVENT", status: "done", input: { start_datetime: "2027-01-09T14:00:00Z" } },
    { id: 13, product: "googlecalendar", tool: "GOOGLECALENDAR_CREATE_EVENT", status: "pending", input: { summary: "No time" } },
  ]);
  assert.deepEqual(w.map((x) => [x.key, x.status, x.title, x.end, x.guests, x.approvalId]), [
    ["a:9", "wait", "Intro: Dan", "2027-01-08T14:45:00.000Z", ["dan@price.com", "x@y.com"], 9],
    ["a:10", "wait", "Meeting", "2027-01-09T15:00:00.000Z", [], 10],
  ]);
});

test("formsSummary: what's coming up and what waits", () => {
  const all = [...googleMeetings(GOOGLE, NOW), ...waitingMeetings([{ id: 9, product: "googlecalendar", tool: "GOOGLECALENDAR_CREATE_EVENT", status: "pending", input: { start_datetime: "2027-01-08T14:00:00Z" } }])];
  assert.equal(formsSummary(all, NOW), "1 meeting coming up, and 1 invite waits for your OK.");
  assert.equal(formsSummary(googleMeetings({ items: [GOOGLE.items[1]] }, NOW), NOW), null);
});

// ─────────────── GET ───────────────

const RANGE = { from: "2027-01-04T00:00:00Z", to: "2027-01-11T00:00:00Z" };
function deps(o: { conns?: { toolkit: string; status: string }[]; run?: (tk: string, slug: string, args: Record<string, unknown>) => Promise<unknown>; gate?: ReturnType<typeof gateAt> } = {}) {
  const calls: [string, string, Record<string, unknown>][] = [];
  return {
    calls,
    deps: {
      gate: o.gate ?? gateAt("viewer"),
      connections: async () => o.conns ?? [{ toolkit: "googlecalendar", status: "active" }],
      run: async (tk: "googlecalendar" | "calendly", slug: string, args: Record<string, unknown>) => {
        calls.push([tk, slug, args]);
        if (o.run) return o.run(tk, slug, args);
        if (slug === "GOOGLECALENDAR_EVENTS_LIST") return GOOGLE;
        if (slug === "CALENDLY_GET_CURRENT_USER") return { resource: { uri: "https://api.calendly.com/users/ME" } };
        if (slug === "CALENDLY_LIST_EVENTS") return { collection: [] };
        return null;
      },
      approvals: async () => [],
      now: () => NOW,
    },
  };
}

test("formsMeetings reads Google Calendar's primary calendar for the range", async () => {
  const s = deps();
  const out = await formsMeetings(RANGE, s.deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.source, "googlecalendar");
  assert.equal((out.body.meetings as unknown[]).length, 5);
  assert.deepEqual(s.calls, [["googlecalendar", "GOOGLECALENDAR_EVENTS_LIST", { calendarId: "primary", timeMin: "2027-01-04T00:00:00.000Z", timeMax: "2027-01-11T00:00:00.000Z", singleEvents: true, orderBy: "startTime", maxResults: 250 }]]);
});

test("formsMeetings uses Calendly only when Google isn't connected", async () => {
  const s = deps({ conns: [{ toolkit: "calendly", status: "active" }, { toolkit: "googlecalendar", status: "reconnect" }] });
  const out = await formsMeetings(RANGE, s.deps);
  assert.equal(out.body.source, "calendly");
  assert.deepEqual(out.body.lost, ["googlecalendar"]);
  assert.deepEqual(s.calls.map((c) => c[1]), ["CALENDLY_GET_CURRENT_USER", "CALENDLY_LIST_EVENTS"]);
  assert.equal(s.calls[1][2].user, "https://api.calendly.com/users/ME");
});

test("formsMeetings: no calendar says what to connect; a failed read says why; role and range first", async () => {
  const none = await formsMeetings(RANGE, deps({ conns: [] }).deps);
  assert.equal(none.body.source, null);
  assert.equal(none.body.error, FORMS_MESSAGES.none);
  const failed = await formsMeetings(RANGE, deps({ run: async () => Promise.reject(new Error("Connect Google Calendar again in Settings, Apps.")) }).deps);
  assert.equal(failed.body.error, "Connect Google Calendar again in Settings, Apps.");
  assert.equal((await formsMeetings(RANGE, deps({ gate: async () => ({ ok: false as const, status: 403, error: "Not allowed." }) }).deps)).status, 403);
  assert.deepEqual(await formsMeetings({ from: "2027-01-01", to: "2027-09-01" }, deps().deps), { status: 400, body: { error: FORMS_MESSAGES.range } });
});

// ─────────────── POST: the person's own changes ───────────────

function act(o: { role?: keyof typeof rank; fail?: string } = {}) {
  const runs: [string, string, Record<string, unknown>][] = [];
  const lines: string[] = [];
  return {
    runs,
    lines,
    deps: {
      gate: gateAt(o.role ?? "editor"),
      run: async (tk: "googlecalendar" | "calendly", slug: string, args: Record<string, unknown>) => {
        runs.push([tk, slug, args]);
        if (o.fail) throw new Error(o.fail);
        return null;
      },
      activity: async (t: string) => void lines.push(t),
      now: () => NOW,
    },
  };
}

test("formsAct: cancel and move run the calendar's own action, and guests are told", async () => {
  const s = act();
  assert.deepEqual(await formsAct({ action: "cancel", source: "googlecalendar", id: "e1" }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(await formsAct({ action: "move", source: "googlecalendar", id: "e1", start: "2027-01-08T15:00:00Z", end: "2027-01-08T15:30:00Z" }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(await formsAct({ action: "cancel", source: "calendly", id: "ABC123" }, s.deps), { status: 200, body: { ok: true } });
  assert.deepEqual(s.runs, [
    ["googlecalendar", "GOOGLECALENDAR_DELETE_EVENT", { calendar_id: "primary", event_id: "e1", send_updates: "all" }],
    ["googlecalendar", "GOOGLECALENDAR_PATCH_EVENT", { calendar_id: "primary", event_id: "e1", start_time: "2027-01-08T15:00:00.000Z", end_time: "2027-01-08T15:30:00.000Z", send_updates: "all" }],
    ["calendly", "CALENDLY_CANCEL_SCHEDULED_EVENT", { event_uuid: "ABC123", reason: "Canceled by the host." }],
  ]);
  assert.deepEqual(s.lines, ["You canceled a meeting on the calendar.", "You moved a meeting on the calendar.", "You canceled a meeting on the calendar."]);
  assert.deepEqual(new Set(s.runs.map((r) => r[1])), new Set(Object.values(SCREEN_ACTIONS).flatMap((a) => Object.values(a))), "only the listed actions");
});

test("formsAct: viewers can't change meetings, and bad input never reaches the calendar", async () => {
  const viewer = act({ role: "viewer" });
  assert.equal((await formsAct({ action: "cancel", source: "googlecalendar", id: "e1" }, viewer.deps)).status, 403);
  const s = act();
  const cases: [Record<string, unknown>, string][] = [
    [{ action: "cancel", source: "outlook", id: "e1" }, FORMS_MESSAGES.meeting],
    [{ action: "cancel", source: "googlecalendar" }, FORMS_MESSAGES.meeting],
    [{ action: "move", source: "calendly", id: "x", start: "2027-01-08T15:00:00Z", end: "2027-01-08T16:00:00Z" }, FORMS_MESSAGES.calendlyMove],
    [{ action: "move", source: "googlecalendar", id: "e1", start: "2027-01-08T15:00:00Z", end: "2027-01-08T14:00:00Z" }, FORMS_MESSAGES.time],
    [{ action: "move", source: "googlecalendar", id: "e1", start: "2027-01-01T15:00:00Z", end: "2027-01-01T16:00:00Z" }, FORMS_MESSAGES.past],
    [{ action: "delete_calendar", source: "googlecalendar", id: "e1" }, FORMS_MESSAGES.action],
  ];
  for (const [b, error] of cases) assert.deepEqual(await formsAct(b, s.deps), { status: 400, body: { error } }, error);
  assert.equal(s.runs.length + viewer.runs.length, 0);
});

test("formsAct: the calendar's refusal comes back as the error, with nothing logged", async () => {
  const s = act({ fail: "Connect Google Calendar again in Settings, Apps." });
  assert.deepEqual(await formsAct({ action: "cancel", source: "googlecalendar", id: "e1" }, s.deps), { status: 502, body: { error: "Connect Google Calendar again in Settings, Apps." } });
  assert.deepEqual(s.lines, []);
});

// ─────────────── booking rules ───────────────

test("cleanBooking keeps good rules and fixes bad ones", () => {
  assert.deepEqual(cleanBooking({ days: [5, 1, 3, 3, 9], start: "08:30", end: "16:00", length: 45, gap: 10 }), { days: [1, 3, 5], start: "08:30", end: "16:00", length: 45, gap: 10 });
  assert.deepEqual(cleanBooking(null), DEFAULT_BOOKING);
  assert.deepEqual(cleanBooking({ days: [], start: "09:00", end: "17:00", length: 60, gap: 0 }), { ...DEFAULT_BOOKING, length: 60, gap: 0 });
  assert.deepEqual(cleanBooking({ days: [1], start: "18:00", end: "09:00", length: 7, gap: 99 }), DEFAULT_BOOKING);
});

test("bookingProblem and daysText", () => {
  assert.equal(bookingProblem({ ...DEFAULT_BOOKING, days: [] }), "Pick at least one day.");
  assert.equal(bookingProblem({ ...DEFAULT_BOOKING, start: "17:00", end: "09:00" }), "The end time has to be after the start time.");
  assert.equal(bookingProblem(DEFAULT_BOOKING), null);
  assert.equal(daysText([1, 2, 3, 4, 5]), "Monday to Friday");
  assert.equal(daysText([1, 3, 5]), "Monday, Wednesday and Friday");
  assert.equal(daysText([6]), "Saturday");
});

test("bookingLine is the plain rule Hora gets", () => {
  assert.equal(
    bookingLine(DEFAULT_BOOKING, "America/Chicago"),
    "Booking rules from the owner: book meetings Monday to Friday, 9:00 AM to 5:00 PM (America/Chicago time). Meetings are 30 minutes, with 15 minutes between them. Never book outside these rules unless the person asks.",
  );
  assert.equal(bookingLine({ days: [2, 4], start: "13:00", end: "15:30", length: 60, gap: 0 }), "Booking rules from the owner: book meetings Tuesday and Thursday, 1:00 PM to 3:30 PM. Meetings are 60 minutes. Never book outside these rules unless the person asks.");
});
