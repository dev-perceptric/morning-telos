// Hermes's leads (src/lib/leads.ts) and his save_lead and find_leads tools (src/lib/leadTools.ts). Fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import type { ToolContext } from "../src/lib/agentLoop.ts";
import { leadToolSource, type LeadToolDeps } from "../src/lib/leadTools.ts";
import { cleanLead, followupsByEmail, leadsSummary, type Lead } from "../src/lib/leads.ts";

test("cleanLead checks every field, and a change keeps what wasn't sent", () => {
  assert.deepEqual(cleanLead({ name: " Maria Lopez ", company: "Lopez Dental", email: "MARIA@Lopez.com", value: "$4,800", stage: "open", next_step: "Follow up", next_date: "2027-01-10", notes: "Wants SEO" }), {
    ok: true,
    value: { name: "Maria Lopez", company: "Lopez Dental", email: "maria@lopez.com", value: 4800, stage: "open", next_step: "Follow up", next_date: "2027-01-10", notes: "Wants SEO" },
  });
  assert.deepEqual(cleanLead({ stage: "won" }, true), { ok: true, value: { stage: "won" } });
  assert.deepEqual(cleanLead({ email: "" }, true), { ok: true, value: { email: null } });
  for (const [v, error] of [
    [{ name: " " }, "Give the lead's name."],
    [{ name: "A", email: "nope" }, "That email doesn't look right."],
    [{ name: "A", value: "lots" }, "Give the deal value as a number."],
    [{ name: "A", value: -5 }, "Give the deal value as a number."],
    [{ name: "A", stage: "maybe" }, "The stage is open, won or lost."],
    [{ name: "A", next_date: "Friday" }, "Give the next date as YYYY-MM-DD."],
  ] as const)
    assert.deepEqual(cleanLead(v as Record<string, unknown>), { ok: false, error }, error);
});

test("leadsSummary: open deals, their worth, and follow-ups waiting", () => {
  assert.equal(leadsSummary([], 0), null);
  assert.equal(leadsSummary([{ stage: "open", value: 4800 }, { stage: "open", value: 3200 }, { stage: "won", value: 1000 }], 2), "2 open deals worth $8,000, and 2 follow-ups wait for your OK.");
  assert.equal(leadsSummary([{ stage: "open", value: null }], 0), "1 open deal.");
});

test("followupsByEmail: Hermes's waiting emails by the address they go to", () => {
  const m = followupsByEmail([
    { id: 1, product: "gmail", status: "pending", input: { recipient_email: "Maria@Lopez.com", subject: "Checking in", body: "Hi Maria" } },
    { id: 2, product: "outlook", status: "pending", input: { to: ["dan@price.com", "ops@price.com"], subject: "Quote", body: "Hi Dan" } },
    { id: 3, product: "gmail", status: "done", input: { recipient_email: "maria@lopez.com", body: "old" } },
    { id: 4, product: "hubspot", status: "pending", input: { email: "x@y.com" } },
  ]);
  assert.deepEqual([...m.keys()].sort(), ["dan@price.com", "maria@lopez.com", "ops@price.com"]);
  assert.equal(m.get("maria@lopez.com")![0].approvalId, 1);
});

// ─────────────── Hermes's tools ───────────────

const WS = { id: "w1", name: "B", website: null } as ToolContext["workspace"];
const ctx = (agent: ToolContext["agent"]): ToolContext => ({ workspace: WS, agent, threadId: "t1", trust: 0, emit: () => {} });
const lead = (o: Partial<Lead>): Lead => ({ id: "11111111-1111-4111-8111-111111111111", name: "Maria Lopez", company: "Lopez Dental", email: "maria@lopez.com", phone: null, value: 4800, stage: "open", next_step: "", next_date: null, last_contact: null, notes: "", source: "hermes", created_at: "", updated_at: "", ...o });

function fake(saved: Lead[] = []) {
  const calls: string[] = [];
  const deps: LeadToolDeps = {
    find: async (ws, q) => (calls.push(`find ${ws} ${q.text ?? ""} ${q.stage ?? ""}`), saved),
    byEmail: async (ws, email) => saved.find((l) => l.email === email) ?? null,
    byId: async (ws, id) => saved.find((l) => l.id === id) ?? null,
    insert: async (ws, f) => (calls.push(`insert ${ws} ${JSON.stringify(f)}`), lead({ ...f, id: "22222222-2222-4222-8222-222222222222" } as Partial<Lead>)),
    update: async (ws, id, f) => (calls.push(`update ${ws} ${id} ${JSON.stringify(f)}`), lead({ ...saved.find((l) => l.id === id), ...f } as Partial<Lead>)),
    now: () => Date.parse("2027-01-08T12:00:00Z"),
  };
  return { deps, calls };
}

test("only Hermes gets save_lead and find_leads", async () => {
  const src = leadToolSource(fake().deps);
  assert.deepEqual((await src(ctx("sales"))).tools.map((t) => t.definition.name), ["save_lead", "find_leads"]);
  assert.deepEqual((await src(ctx("support"))).tools, []);
});

test("save_lead adds a new lead, or changes the one with that email, and marks contact when asked", async () => {
  const empty = fake();
  const [save] = (await leadToolSource(empty.deps)(ctx("sales"))).tools;
  const added = await save.run({ name: "Dan Price", email: "dan@price.com", value: 3200, contacted: true }, ctx("sales"));
  assert.match(String(added.content), /^Added the lead: Dan Price/);
  assert.match(empty.calls[0], /"source":"hermes","last_contact":"2027-01-08T12:00:00.000Z"/);

  const one = fake([lead({})]);
  const [save2] = (await leadToolSource(one.deps)(ctx("sales"))).tools;
  const changed = await save2.run({ email: "maria@lopez.com", stage: "won" }, ctx("sales"));
  assert.match(String(changed.content), /^Changed the lead: Maria Lopez, Lopez Dental \| maria@lopez\.com \| \$4,800 \| won/);
  assert.match(one.calls[0], /^update w1 11111111-1111-4111-8111-111111111111 \{"email":"maria@lopez.com","stage":"won"\}$/);
});

test("save_lead refuses bad input and unknown ids without saving", async () => {
  const f = fake();
  const [save] = (await leadToolSource(f.deps)(ctx("sales"))).tools;
  assert.deepEqual(await save.run({ email: "a@b.com" }, ctx("sales")), { content: "Give the lead's name.", isError: true });
  assert.equal((await save.run({ id: "33333333-3333-4333-8333-333333333333", stage: "won" }, ctx("sales"))).isError, true);
  assert.deepEqual(f.calls, []);
});

test("find_leads lists what matches, in the agent's own workspace", async () => {
  const f = fake([lead({ next_step: "Call", next_date: "2027-01-10" })]);
  const [, find] = (await leadToolSource(f.deps)(ctx("sales"))).tools;
  const out = await find.run({ query: "maria", stage: "open" }, ctx("sales"));
  assert.match(String(out.content), /^1\. Maria Lopez, Lopez Dental \| maria@lopez\.com \| \$4,800 \| open \| next: Call on 2027-01-10 \| id /);
  assert.deepEqual(f.calls, ["find w1 maria open"]);
  const none = fake();
  const [, find2] = (await leadToolSource(none.deps)(ctx("sales"))).tools;
  assert.equal((await find2.run({}, ctx("sales"))).content, "No leads yet.");
});
