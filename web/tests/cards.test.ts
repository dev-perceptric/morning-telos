// Answer cards (src/lib/cards.ts): the strict schema, limits, plain text, what cards send, approving from a card,
// goal helpers and charts. Also the prompt guidance and that internal product names never reach people.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CARD_GUIDE, FORMAT_GUIDE, systemPrompt } from "../src/lib/agentLoop.ts";
import {
  approvalRequest,
  CARD_ID,
  cardsNote,
  chartPoints,
  chartRange,
  chartSummary,
  choicesReady,
  choicesText,
  cleanText,
  emailInputWith,
  emailWords,
  goalStartText,
  goalStatus,
  hideNames,
  INTERNAL_NAMES,
  LIMITS,
  meterPercent,
  meterText,
  namesInternal,
  newCardId,
  picksFrom,
  planGoText,
  postInputWith,
  postWords,
  readCard,
  SHOW_KINDS,
  shiftMonths,
  stepFor,
  storedCards,
  togglePick,
  type Card,
  type ChoicesCard,
} from "../src/lib/cards.ts";
import { SKILL_FILES as SKILLS } from "../src/skills/index.ts";
import { AGENTS, ORDER, SOCIAL_FLOW, workingAgents } from "../src/lib/team.ts";

const ok = (input: unknown, agent: "social" | "chief" = "social"): Card => {
  const r = readCard(input, agent);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.card;
};
const no = (input: unknown, why: RegExp) => {
  const r = readCard(input, "social");
  assert.equal(r.ok, false, `should be refused: ${JSON.stringify(input).slice(0, 120)}`);
  if (!r.ok) assert.match(r.error, why);
};

const CHOICES = {
  kind: "choices",
  questions: [
    { label: "Where should we post?", options: ["LinkedIn", "Instagram", "Facebook"], multi: true, picked: ["LinkedIn"] },
    { label: "How often?", options: ["2 a week", "3 a week", "5 a week"], picked: "3 a week" },
    { label: "Tone", options: ["Friendly", "Expert", "Bold"], picked: ["Expert"] },
  ],
  submit: "Make the plan",
};

// ─────────────── good cards ───────────────

test("every kind reads: choices, quick replies, table, chart, connect, post and email previews, goal, plan, progress", () => {
  const c = ok(CHOICES) as ChoicesCard;
  assert.equal(c.kind, "choices");
  assert.equal(c.agent, "social");
  assert.match(c.id, CARD_ID);
  assert.deepEqual(c.questions.map((q) => q.picked), [["LinkedIn"], ["3 a week"], ["Expert"]]);
  assert.deepEqual(c.questions.map((q) => q.multi), [true, false, false]);
  assert.equal(c.submit, "Make the plan");
  assert.equal(ok({ kind: "choices", questions: [{ label: "Pick", options: ["A", "B"] }] }).kind, "choices");
  assert.deepEqual((ok({ kind: "quick_replies", replies: ["Plan the week after", "Add Instagram"] }) as Extract<Card, { kind: "quick_replies" }>).replies, ["Plan the week after", "Add Instagram"]);

  const t = ok({
    kind: "table",
    title: "Leads",
    note: "25 found",
    columns: ["Business", "Where", "Visits", "Share"],
    rows: [
      { cells: ["Ridgeline Dental", "Austin, TX", 1240, "12.5%"], action: { label: "Draft email", message: "Draft an intro email to Ridgeline Dental" } },
      ["Northpoint HVAC", "Denver, CO", "2,493", "-3%"],
    ],
    actions: [{ label: "Save all 25 to CRM", message: "Save all 25 leads to my CRM" }],
  }) as Extract<Card, { kind: "table" }>;
  assert.deepEqual(t.numeric, [false, false, true, true], "numbers line up on the right");
  assert.equal(t.rows[0].action?.message, "Draft an intro email to Ridgeline Dental");
  assert.equal(t.rows[1].action, null);
  assert.equal(t.actions.length, 1);

  const ch = ok({ kind: "chart", title: "Monthly visits", labels: ["Jun", "Jul", "Aug"], values: [12710, 2493, "2400"] }) as Extract<Card, { kind: "chart" }>;
  assert.equal(ch.type, "line");
  assert.deepEqual(ch.values, [12710, 2493, 2400]);
  assert.equal((ok({ kind: "chart", type: "bar", labels: ["a", "b"], values: [1, 2] }) as Extract<Card, { kind: "chart" }>).type, "bar");

  const cn = ok({ kind: "connect", app: "Gmail", text: "Connect Gmail so I can draft replies.", id: "c_abcdefgh1234" });
  assert.deepEqual(cn, { id: "c_abcdefgh1234", agent: "social", title: null, note: null, kind: "connect", app: "gmail", text: "Connect Gmail so I can draft replies." });

  const pp = ok({ kind: "post_preview", posts: [{ approval_id: 12, network: "linkedin", text: "Line one\n\nLine two", when: "Tue 9:10 AM", image_text: "AI answers decide who gets the call" }] }) as Extract<Card, { kind: "post_preview" }>;
  assert.equal(pp.posts[0].text, "Line one\n\nLine two", "new lines stay in posts");
  assert.equal(pp.posts[0].index, 0);
  const em = ok({ kind: "email_preview", approval_id: 4, to: "ana@example.com", subject: "Your quote", body: "Hi Ana,\n\nHere it is." }) as Extract<Card, { kind: "email_preview" }>;
  assert.equal(em.approval_id, 4);

  const g = ok({ kind: "goal", metric: "followers", lead: "Grow LinkedIn by", target: 150, unit: "followers", due: "2027-01-31" }) as Extract<Card, { kind: "goal" }>;
  assert.equal(g.step, 25);
  const p = ok({ kind: "plan", steps: [{ title: "Find 4 topics", owner: "Artemis" }, { title: "Write 3 posts", note: "you approve each" }] }) as Extract<Card, { kind: "plan" }>;
  assert.deepEqual(p.steps.map((s) => s.agent), ["seo", "social"], "a step without an owner is the teammate's own");
  assert.equal(p.go, "Go");
  const pr = ok({ kind: "progress", goal_id: "g1", lead: "Grow LinkedIn by", target: 150, unit: "followers", due: "2027-01-31", start: "2026-11-20", current: 12, points: [{ at: "2026-11-27", value: 12 }], status: "on_track" });
  assert.equal(pr.kind, "progress");
});

test("a card id is kept when it is a card id, and made otherwise", () => {
  assert.equal(ok({ kind: "quick_replies", replies: ["a", "b"], id: "c_abcdefgh1234" }).id, "c_abcdefgh1234");
  assert.match(ok({ kind: "quick_replies", replies: ["a", "b"], id: "<b>x</b>" }).id, CARD_ID);
  assert.match(newCardId(), CARD_ID);
  assert.equal(newCardId(() => "AB-CD"), "c_abcd00000000");
});

// ─────────────── bad cards ───────────────

test("bad cards are refused with the reason: kind, unknown fields, shapes, limits", () => {
  no({ kind: "poll" }, /kind: must be one of/);
  no("choices", /card: must be an object/);
  no({ kind: "quick_replies", replies: ["a", "b"], html: "<b>" }, /unknown field html/);
  no({ kind: "quick_replies", replies: ["Only one"] }, /needs at least 2/);
  no({ kind: "quick_replies", replies: ["a", "b", "c", "d", "e"] }, /has 5, at most 4/);
  no({ kind: "quick_replies", replies: ["Yes", "yes"] }, /twice/);
  no({ kind: "quick_replies", replies: ["a", "x".repeat(LIMITS.reply + 1)] }, /at most 60/);
  no({ kind: "choices", questions: [] }, /needs at least 1/);
  no({ kind: "choices", questions: Array(5).fill({ label: "Q", options: ["a", "b"] }) }, /at most 4/);
  no({ kind: "choices", questions: [{ label: "Q", options: ["a"] }] }, /needs at least 2/);
  no({ kind: "choices", questions: [{ label: "  ", options: ["a", "b"] }] }, /can't be empty/);
  no({ kind: "table", columns: ["A", "B"], rows: [["only one"]] }, /needs at least 2/);
  no({ kind: "table", columns: ["A"], rows: Array(LIMITS.rows + 1).fill(["x"]) }, /has 51, at most 50/);
  no({ kind: "table", columns: Array(9).fill("C"), rows: [Array(9).fill("x")] }, /at most 8/);
  no({ kind: "table", columns: ["A"], rows: [{ cells: ["x"], action: { label: "Open", url: "https://evil.example" } }] }, /unknown field url/);
  no({ kind: "chart", labels: ["a", "b", "c"], values: [1, 2] }, /needs at least 3/);
  no({ kind: "chart", labels: ["a", "b"], values: [1, "lots"] }, /must be a number/);
  no({ kind: "chart", labels: ["a"], values: [1] }, /needs at least 2/);
  no({ kind: "chart", type: "pie", labels: ["a", "b"], values: [1, 2] }, /line, bar/);
  no({ kind: "post_preview", posts: [{ network: "tiktok", text: "hi" }] }, /linkedin, instagram, facebook, x/);
  no({ kind: "post_preview", posts: [{ network: "x", text: "x".repeat(281) }] }, /at most 280/);
  no({ kind: "post_preview", posts: [{ network: "linkedin", text: "hi", approval_id: -2 }] }, /at least 1/);
  no({ kind: "email_preview", to: "a@b.co", subject: "Hi" }, /body: must be text/);
  no({ kind: "goal", lead: "Grow by", target: 0, unit: "followers", due: "2027-01-31" }, /at least 0.01/);
  no({ kind: "goal", lead: "Grow by", target: 10, unit: "followers", due: "2027-02-30" }, /date like/);
  no({ kind: "goal", metric: "revenue", lead: "Grow by", target: 10, unit: "x", due: "2027-01-31" }, /followers, reach, ai_visibility, other/);
  no({ kind: "plan", steps: [{ title: "A", owner: "Zeus" }] }, /teammate's name/);
  no({ kind: "plan", steps: Array(9).fill({ title: "A" }) }, /at most 8/);
  // show_card only makes the display kinds; goals, plans and progress come from their own tools.
  const r = readCard({ kind: "goal", lead: "Grow by", target: 10, unit: "x", due: "2027-01-31" }, "social", { kinds: SHOW_KINDS });
  assert.equal(r.ok, false);
});

// ─────────────── plain text ───────────────

test("card text stays plain text: HTML is kept as words, control and direction characters go, lines only where allowed", () => {
  const c = ok({ kind: "quick_replies", replies: ['<img src=x onerror="alert(1)">', "a‮b\u0000c​d"] }) as Extract<Card, { kind: "quick_replies" }>;
  assert.equal(c.replies[0], '<img src=x onerror="alert(1)">', "kept as text; React escapes it on screen");
  assert.equal(c.replies[1], "abcd");
  assert.equal(cleanText("one\ntwo   three"), "one two three");
  assert.equal(cleanText("one\r\n\n\n\ntwo", true), "one\n\ntwo");
  const t = ok({ kind: "table", columns: ["<script>alert(1)</script>"], rows: [["**bold** [x](javascript:alert(1))"]] }) as Extract<Card, { kind: "table" }>;
  assert.equal(t.columns[0], "<script>alert(1)</script>");
  assert.equal(t.rows[0].cells[0], "**bold** [x](javascript:alert(1))", "no Markdown either: shown as typed");
});

test("the card screens never put text in as HTML, and approve buttons only go through the approvals route", () => {
  const src = readFileSync(new URL("../src/components/Cards.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(src, /\bfetch\(/, "no direct calls: callApi to our own routes only");
  assert.doesNotMatch(src, /capybaroar|create_posts|\/api\/mcp|composio\.dev/i, "a card never posts or sends by itself");
  assert.match(src, /approvalRequest\(/);
  const routes = [...src.matchAll(/callApi<[^>]*>\(\s*sb,\s*("[^"]+"|req\.path)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(routes)].sort(), ['"/api/apps/connect"', '"/api/apps/wordpress"', "req.path"].sort());
  assert.deepEqual(approvalRequest("ws-1", 7, "approve", { posts: [{ text: "x" }] }), { path: "/api/approvals/7", body: { workspaceId: "ws-1", action: "approve", input: { posts: [{ text: "x" }] } } });
  assert.deepEqual(approvalRequest("ws-1", 7, "deny", { posts: [] }), { path: "/api/approvals/7", body: { workspaceId: "ws-1", action: "deny" } }, "a skip never sends details");
  assert.deepEqual(approvalRequest("ws-1", 7, "approve"), { path: "/api/approvals/7", body: { workspaceId: "ws-1", action: "approve" } });
});

test("stored cards are checked again on the way out, and broken ones are dropped", () => {
  const good = ok(CHOICES);
  const again = storedCards({ cards: [good, { kind: "quick_replies", replies: ["one"] }, { ...good, id: "nope" }, null, "x"] });
  assert.equal(again.length, 1);
  assert.deepEqual(again[0], good);
  assert.deepEqual(storedCards(null), []);
  assert.deepEqual(storedCards({ cards: "x" }), []);
  for (const c of [
    ok({ kind: "table", columns: ["A", "B"], rows: [["x", 1]] }),
    ok({ kind: "plan", steps: [{ title: "A", owner: "Artemis", note: "n" }] }),
    ok({ kind: "post_preview", posts: [{ approval_id: 3, network: "x", text: "hi" }] }),
    ok({ kind: "goal", metric: "followers", lead: "Grow by", target: 150, unit: "followers", due: "2027-01-31" }),
  ]) {
    assert.deepEqual(storedCards({ cards: [c] }), [c], c.kind);
  }
});

// ─────────────── names the person never sees ───────────────

test("internal product names are swapped in card text and replies", () => {
  assert.equal(hideNames("Arrowsterr's data and Capybaroar posts via Composio, MoltSets and DataForSEO"), "your SEO tools data and your social tools posts via your apps, lead search and search data");
  assert.equal(namesInternal("all clear"), false);
  assert.equal(namesInternal("capybaroar"), true);
  const c = ok({ kind: "table", title: "Arrowsterr keywords", columns: ["From Capybaroar"], rows: [["DataForSEO says 3"]] }) as Extract<Card, { kind: "table" }>;
  const text = JSON.stringify(c);
  for (const n of INTERNAL_NAMES) assert.ok(!text.toLowerCase().includes(n.toLowerCase()), n);
});

test("prompts never name the services behind the team: every teammate's prompt and every System skill", () => {
  for (const k of ORDER) {
    const p = systemPrompt({ name: "Ana's Bakery", website: "anasbakery.com", tone: "warm" }, k, { tools: true, writes: "ask", missing: ["Social media (still being set up for this business)"], teammates: workingAgents().filter((x) => x !== k) });
    for (const n of INTERNAL_NAMES) assert.ok(!p.toLowerCase().includes(n.toLowerCase()), `${AGENTS[k].god}'s prompt names ${n}`);
  }
  for (const [name, body] of Object.entries(SKILLS)) for (const n of INTERNAL_NAMES) assert.ok(!body.toLowerCase().includes(n.toLowerCase()), `skill ${name} names ${n}`);
});

// ─────────────── prompt guidance ───────────────

test("every teammate's prompt teaches cards: choices for options, quick replies, tables and charts, connect cards, previews, goals then plans", () => {
  const joined = CARD_GUIDE.join(" ");
  for (const w of ["choices card", "quick_replies", "table card", "chart card", "connect card", "post_preview", "email_preview", "set_goal", "set_plan", "update_step", "log_progress"]) assert.ok(joined.includes(w), w);
  assert.match(joined, /instead of saying you can't/);
  assert.match(FORMAT_GUIDE.join(" "), /small Markdown table/, "the Markdown table stays for small tables");
  for (const k of ORDER) {
    const p = systemPrompt({ name: "Ana's Bakery", website: null }, k, { tools: true, missing: [], teammates: [] });
    for (const line of CARD_GUIDE) assert.ok(p.includes(line), `${AGENTS[k].god} is missing: ${line}`);
    assert.doesNotMatch(p, /—/, "no em dashes");
  }
  const aph = systemPrompt({ name: "Ana's Bakery", website: null }, "social", { tools: true, missing: [], teammates: [] });
  for (const line of SOCIAL_FLOW) assert.ok(aph.includes(line), line);
  assert.match(SOCIAL_FLOW.join(" "), /set_goal[\s\S]*choices card[\s\S]*set_plan[\s\S]*connect card[\s\S]*post_preview[\s\S]*log_progress/, "goal, choices, plan, connect, previews, progress, in that order");
});

// ─────────────── what cards send ───────────────

test("choices: the picks go back as the person's message, and a reloaded card finds them again", () => {
  const c = ok(CHOICES) as ChoicesCard;
  const picks = [["LinkedIn"], ["3 a week"], ["Expert"]];
  assert.equal(choicesText(c, picks), "Where should we post: LinkedIn. How often: 3 a week. Tone: Expert.");
  assert.equal(choicesText(c, [["Instagram", "LinkedIn"], ["2 a week"], ["Bold"]]), "Where should we post: LinkedIn, Instagram. How often: 2 a week. Tone: Bold.", "in the card's order");
  assert.deepEqual(picksFrom(c, "Where should we post: LinkedIn, Instagram. How often: 2 a week. Tone: Bold."), [["LinkedIn", "Instagram"], ["2 a week"], ["Bold"]]);
  assert.deepEqual(picksFrom(c, "Something else"), [[], [], []]);
  assert.equal(choicesReady(c, picks), true);
  assert.equal(choicesReady(c, [["LinkedIn"], [], ["Expert"]]), false);
  assert.deepEqual(togglePick({ multi: false }, ["2 a week"], "5 a week"), ["5 a week"]);
  assert.deepEqual(togglePick({ multi: true }, ["LinkedIn"], "Instagram"), ["LinkedIn", "Instagram"]);
  assert.deepEqual(togglePick({ multi: true }, ["LinkedIn", "Instagram"], "LinkedIn"), ["Instagram"]);
});

test("goal and plan answers name what the person started", () => {
  assert.equal(goalStartText({ lead: "Grow LinkedIn by", target: 150, unit: "followers", due: "2027-01-31" }, Date.parse("2026-11-20")), "Start the goal: Grow LinkedIn by 150 followers by Jan 31.");
  assert.equal(planGoText([{ title: "Find 4 topics.", agent: "seo" }, { title: "Write 3 posts", agent: "social" }]), "Go. Run the plan: 1. Find 4 topics (Artemis). 2. Write 3 posts (Aphrodite).");
});

test("editing a preview changes the approval's own details: the post's words, or the email's to, subject and body", () => {
  const input = { posts: [{ channel_ids: ["c1"], text: "Old", channel_text: { c1: "Old" } }, { channel_ids: ["c1"], text: "Two" }] };
  const next = postInputWith(input, 0, "New words");
  assert.deepEqual(next, { posts: [{ channel_ids: ["c1"], text: "New words", channel_text: { c1: "New words" } }, { channel_ids: ["c1"], text: "Two" }] });
  assert.equal(input.posts[0].text, "Old", "the original stays as it was");
  assert.equal(postWords(next, 0), "New words");
  assert.equal(postWords(input, 1), "Two");
  assert.equal(postWords(input, 5), null);
  assert.equal(postWords({ text: "Top" }), "Top");

  const mail = { recipient_email: "a@b.co", subject: "Hi", body: "Old", is_html: false };
  assert.deepEqual(emailInputWith(mail, { to: "c@d.co", subject: "Hello", body: "New" }), { recipient_email: "c@d.co", subject: "Hello", body: "New", is_html: false });
  assert.deepEqual(emailInputWith({ to: ["a@b.co"], message: "x" }, { to: "c@d.co, e@f.co", subject: "S", body: "B" }), { to: ["c@d.co", "e@f.co"], message: "B", subject: "S" });
  assert.deepEqual(emailWords(mail), { to: "a@b.co", subject: "Hi", body: "Old" });
  assert.deepEqual(emailWords(null), { to: null, subject: null, body: null });
});

// ─────────────── goals and charts ───────────────

test("goal helpers: round steps, month steps that keep month ends, the meter and where a goal stands", () => {
  assert.deepEqual([6, 30, 150, 1000, 25000].map(stepFor), [1, 5, 25, 250, 5000]);
  assert.equal(shiftMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(shiftMonths("2027-02-28", 1), "2027-03-31");
  assert.equal(shiftMonths("2027-01-15", -2), "2026-11-15");
  assert.equal(shiftMonths("2026-12-31", 1), "2027-01-31");
  assert.equal(meterText(12, 150, "followers"), "12 of 150 followers");
  assert.equal(meterText(-3, 1500, "followers"), "0 of 1,500 followers");
  assert.equal(meterPercent(12, 150), 8);
  assert.equal(meterPercent(300, 150), 100);
  const now = Date.parse("2026-12-20T12:00:00Z");
  const g = { status: "active", current: 10, target: 100, created_at: "2026-11-20T12:00:00Z", due_date: "2027-01-19" };
  assert.equal(goalStatus(g, { now }), "needs_you", "half way through time, a tenth of the way there");
  assert.equal(goalStatus({ ...g, current: 45 }, { now }), "on_track");
  assert.equal(goalStatus({ ...g, current: 45 }, { now, pending: 2 }), "needs_you", "an approval waits");
  assert.equal(goalStatus({ ...g, current: 100 }, { now }), "done");
  assert.equal(goalStatus({ ...g, status: "done" }, { now }), "done");
  assert.equal(goalStatus(g, { now: Date.parse("2026-11-23T12:00:00Z") }), "on_track", "never behind in the first week");
});

test("charts: the range starts at 0, points spread across the box, and a summary for screen readers", () => {
  assert.deepEqual(chartRange([5, 10]), { min: 0, max: 10 });
  assert.deepEqual(chartRange([-5, 10]), { min: -5, max: 10 });
  assert.deepEqual(chartRange([0, 0]), { min: 0, max: 1 });
  const box = { w: 100, h: 100, left: 0, right: 0, top: 0, bottom: 0 };
  assert.deepEqual(chartPoints([0, 5, 10], { min: 0, max: 10 }, box), [{ x: 0, y: 100 }, { x: 50, y: 50 }, { x: 100, y: 0 }]);
  assert.equal(chartSummary({ title: "Visits", labels: ["Jun", "Nov"], values: [12710, 2493], unit: "visits" }), "Visits: from 12,710 visits in Jun to 2,493 visits in Nov.");
});

test("cards in words, for the teammate's own history", () => {
  const note = cardsNote([ok(CHOICES), ok({ kind: "post_preview", posts: [{ approval_id: 9, network: "linkedin", text: "x" }] })]);
  assert.match(note, /\[Card: choices\. Where should we post\? \(LinkedIn, Instagram, Facebook\)/);
  assert.match(note, /LinkedIn post \(approval #9\)/);
});
