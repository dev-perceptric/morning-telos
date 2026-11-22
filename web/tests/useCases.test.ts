// Use cases (src/lib/useCases.ts): the catalog's shape, that every teammate can do its use cases with tools and apps
// it has, the starter messages "Try in chat" sends, the starter packs Home suggests, and the /use-cases route.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appsFor, directFor } from "../src/lib/composio/catalog.ts";
import { productsFor } from "../src/lib/productTools.ts";
import { parseRoute, routePath } from "../src/lib/routes.ts";
import { pickedSkill, skillsFor } from "../src/lib/skills.ts";
import { AGENTS, isAgentKey, parseMentions } from "../src/lib/team.ts";
import {
  DEFAULT_PACK,
  industryOf,
  isUseCaseApp,
  SOCIAL_APPS,
  STARTER_PACKS,
  starterMessage,
  suggestedUseCases,
  USE_CASE_GROUPS,
  USE_CASES,
  findUseCase,
  caseAppName,
  casesIn,
} from "../src/lib/useCases.ts";

// Product and vendor names customers never see.
const INTERNAL = /capybaroar|arrowsterr|composio|moltsets|dataforseo/i;

test("catalog: every use case has its fields, a known group and a unique id", () => {
  assert.ok(USE_CASES.length >= 30);
  const ids = new Set(USE_CASES.map((u) => u.id));
  assert.equal(ids.size, USE_CASES.length);
  const groups = new Set(USE_CASE_GROUPS.map((g) => g.id));
  for (const u of USE_CASES) {
    assert.match(u.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, u.id);
    assert.ok(groups.has(u.group), u.id);
    assert.ok(u.title.trim() && u.line.trim() && u.ask.trim(), u.id);
    assert.equal(u.outcomes.length, 3, u.id);
    for (const o of u.outcomes) assert.ok(o.trim(), u.id);
    assert.match(u.line, /\.$/, u.id);
    assert.match(u.ask, /[.?]$/, u.id);
    assert.ok(findUseCase(u.id) === u);
  }
  // Every group has cards, and the page lists them all in the groups' order.
  for (const g of USE_CASE_GROUPS) assert.ok(casesIn(g.id).length > 0, g.id);
  assert.equal(casesIn(null).length, USE_CASES.length);
  assert.equal(findUseCase("nope"), undefined);
});

test("catalog: the rows asked for, in their groups", () => {
  const titles = (g: Parameters<typeof casesIn>[0]) => casesIn(g).map((u) => u.title);
  assert.deepEqual(titles("marketing"), ["Social media manager", "Content repurposer", "Social analyst", "Email newsletter", "Welcome and win-back emails", "Promotions planner", "Competitor watch", "Brand mentions", "Ad copy writer"]);
  assert.deepEqual(titles("sales"), ["Speed-to-lead", "Quote follow-up", "Outreach drafts", "Pipeline clean-up", "Meeting prep", "Call follow-up", "Pitch research"]);
  assert.deepEqual(titles("service"), ["Inbox answers", "Help desk", "FAQ builder", "Upset customer alert", "Review requests"]);
  assert.deepEqual(titles("operations"), ["Booking assistant", "Reminders and no-shows", "My week", "Form follow-up", "Morning brief", "Weekly business report", "Hand-off desk"]);
  assert.deepEqual(titles("website"), ["AI visibility tracker", "SEO specialist", "Competitor traffic check", "Content plan", "Page writer", "Website checkup", "Page fixer"]);
  // Left out until the team has the tools for them.
  for (const t of [/lead research/i, /review repl/i, /\bads?\b manager/i, /invoice/i, /social inbox/i, /order question/i, /meeting notes/i, /starter website/i])
    assert.ok(!USE_CASES.some((u) => t.test(u.title)), String(t));
});

test("catalog: every teammate exists, takes work, and has a tool or app for each of its use cases", () => {
  for (const u of USE_CASES) {
    assert.ok(isAgentKey(u.agent), u.id);
    assert.ok(!AGENTS[u.agent].soon, u.id);
    const products = productsFor(u.agent);
    const toolkits = appsFor(u.agent, false).toolkits;
    const direct = directFor(u.agent, false);
    assert.ok(products.length + toolkits.length + direct.length > 0, `${u.id}: ${u.agent} has no tools`);
    for (const a of u.apps) {
      assert.ok(isUseCaseApp(a), `${u.id}: unknown app ${a}`);
      const can = (SOCIAL_APPS as readonly string[]).includes(a) ? products.includes("capybaroar") : toolkits.includes(a) || direct.includes(a);
      assert.ok(can, `${u.id}: ${AGENTS[u.agent].god} can't use ${a}`);
      assert.ok(caseAppName(a).trim(), a);
    }
    assert.equal(new Set(u.apps).size, u.apps.length, u.id);
  }
});

test("catalog: plain words, no dashes, no internal product names", () => {
  for (const u of USE_CASES) {
    const text = [u.title, u.line, u.ask, ...u.outcomes, ...u.apps.map(caseAppName), AGENTS[u.agent].god, AGENTS[u.agent].name, starterMessage(u)].join("\n");
    assert.doesNotMatch(text, INTERNAL, u.id);
    assert.doesNotMatch(text, /[–—]/, u.id);
    // Short lines a 9th grader reads at a glance.
    assert.ok(u.line.split(/\s+/).length <= 14, `${u.id}: line is long`);
    for (const o of u.outcomes) assert.ok(o.split(/\s+/).length <= 8, `${u.id}: ${o}`);
  }
  for (const g of USE_CASE_GROUPS) assert.doesNotMatch(g.label, INTERNAL);
});

test("starterMessage: tags the teammate, then the use case and the ask", () => {
  const u = findUseCase("social-manager")!;
  assert.equal(starterMessage(u), "@Leo /plan-weekly-posts Start: Social media manager. Keep my channels full, on brand and on schedule.");
  const plain = findUseCase("pitch-research")!;
  assert.equal(plain.skill, undefined);
  assert.equal(starterMessage(plain), "@Alexander Start: Pitch research. Look into a business I want to pitch and tell me how to open.");
  for (const x of USE_CASES) {
    const m = starterMessage(x);
    // The chat sends it to the right teammate.
    assert.deepEqual(parseMentions(m).slice(0, 1), [x.agent], x.id);
    assert.ok(m.includes(`Start: ${x.title}.`), x.id);
  }
});

test("starterMessage: a use case's skill is one of its teammate's System skills, and the chat picks it", () => {
  const withSkill = USE_CASES.filter((u) => u.skill);
  assert.ok(withSkill.length >= 15);
  for (const u of withSkill) {
    const list = skillsFor(u.agent, []);
    assert.ok(list.some((s) => s.scope === "system" && s.name === u.skill), `${u.id}: ${u.agent} has no skill ${u.skill}`);
    // The same check the server makes on the message (src/lib/brainServer.ts).
    assert.equal(pickedSkill(starterMessage(u), list)?.name, u.skill, u.id);
  }
  for (const u of USE_CASES.filter((x) => !x.skill)) assert.equal(pickedSkill(starterMessage(u), skillsFor(u.agent, [])), null, u.id);
});

test("starter packs: three real use cases for each kind of business, and the default", () => {
  const kinds = Object.keys(STARTER_PACKS);
  assert.deepEqual(kinds.sort(), ["accounting", "agencies", "clinics", "ecommerce", "fitness", "home-services", "insurance", "law", "logistics", "real-estate", "recruiting", "saas"]);
  for (const [k, ids] of Object.entries(STARTER_PACKS)) {
    assert.equal(new Set(ids).size, 3, k);
    for (const id of ids) assert.ok(findUseCase(id), `${k}: ${id}`);
  }
  assert.deepEqual(STARTER_PACKS.clinics.map((id) => findUseCase(id)!.title), ["Reminders and no-shows", "Review requests", "Inbox answers"]);
  assert.deepEqual(STARTER_PACKS["home-services"].map((id) => findUseCase(id)!.title), ["Speed-to-lead", "Quote follow-up", "Review requests"]);
  assert.deepEqual(STARTER_PACKS.saas.map((id) => findUseCase(id)!.title), ["AI visibility tracker", "Content repurposer", "Competitor watch"]);
  assert.deepEqual(STARTER_PACKS.recruiting.map((id) => findUseCase(id)!.title), ["Outreach drafts", "Inbox answers", "Weekly business report"]);
  assert.deepEqual(suggestedUseCases(null).map((u) => u.title), ["Social media manager", "Morning brief", "AI visibility tracker"]);
  assert.deepEqual(suggestedUseCases(null).map((u) => u.id), DEFAULT_PACK);
  assert.deepEqual(suggestedUseCases("law").map((u) => u.title), ["Speed-to-lead", "Booking assistant", "Page writer"]);
});

test("industryOf: reads the kind of business from its own words", () => {
  assert.equal(industryOf(""), null);
  assert.equal(industryOf(null), null);
  assert.equal(industryOf("We sell handmade candles."), null);
  assert.equal(industryOf("What we sell: Dental cleanings, whitening and braces.\nWho our customers are: Patients in Leeds."), "clinics");
  assert.equal(industryOf("We are a family plumbing and HVAC company. Emergency plumbers 24/7."), "home-services");
  assert.equal(industryOf("Our realtors help home buyers find properties in Austin."), "real-estate");
  assert.equal(industryOf("A law firm with 12 attorneys. Litigation and contracts."), "law");
  assert.equal(industryOf("Shop our online store. Free shipping over $50. Add to cart."), "ecommerce");
  assert.equal(industryOf("Bookkeeping, payroll and tax returns for small businesses. Our CPAs."), "accounting");
  assert.equal(industryOf("A boutique gym with yoga, pilates and personal training."), "fitness");
  assert.equal(industryOf("Freight and trucking across Europe, with our own warehouses."), "logistics");
  assert.equal(industryOf("An independent insurance agency. Home and auto insurance and coverage reviews."), "insurance");
  assert.equal(industryOf("A staffing firm. We recruit nurses and help job seekers."), "recruiting");
  assert.equal(industryOf("Scheduling software for teams. Our SaaS has an API."), "saas");
  assert.equal(industryOf("A creative agency for brands. Our agency makes campaigns."), "agencies");
  // Footer words don't make a business a law firm.
  assert.equal(industryOf("We sell candles. Legal. Privacy."), null);
});

test("routes: /use-cases is its own page", () => {
  assert.deepEqual(parseRoute("/use-cases"), { page: "useCases" });
  assert.deepEqual(parseRoute("/use-cases/"), { page: "useCases" });
  assert.equal(routePath({ page: "useCases" }), "/use-cases");
  assert.deepEqual(parseRoute("/use-cases/x"), { page: "home" });
});
