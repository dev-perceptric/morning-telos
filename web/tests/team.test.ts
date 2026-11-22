// The roster (src/lib/team.ts): the same 8 agents as the old app, @ tags, and the lists in SQL and on disk that must match.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MODEL_CHOICES, MODELS, modelFor } from "../src/lib/models.ts";
import { agentByGod, agentFace, agentPicture, AGENTS, insertMention, LEAD, mentionMatches, mentionQuery, OLD_NAMES, ORDER, parseMentions, workingAgents } from "../src/lib/team.ts";

test("the same 8 agents, job titles and order as the old app, with the new names; every one works now", () => {
  assert.deepEqual(ORDER, ["chief", "sales", "support", "forms", "email", "social", "seo", "web"]);
  assert.deepEqual(
    ORDER.map((k) => AGENTS[k].god),
    ["Alexander", "Midas", "Irene", "Cleo", "Cyrus", "Leo", "Theseus", "Archon"],
  );
  // Plan phase 4 gate: Cyrus, Cleo, Midas and Irene left Coming soon.
  assert.deepEqual(workingAgents(), ORDER);
  for (const k of ORDER) assert.equal(AGENTS[k].soon, undefined, k);
  assert.equal(LEAD, "chief");
  assert.ok(AGENTS.chief.readOnly);
  // The old app (app/lib/agents.js) still uses the Greek god names (OLD_NAMES here), with the same job titles. Its jobs
  // match for the four teammates that worked there; Cyrus, Cleo, Midas and Irene are still "coming soon" in the old app,
  // and here they work through the customer's own apps, so their jobs say that instead (an intended difference until launch).
  const old = readFileSync(new URL("../../app/lib/agents.js", import.meta.url), "utf8");
  const oldName = (k: string) => {
    const n = Object.keys(OLD_NAMES).find((x) => OLD_NAMES[x] === k)!;
    return n[0].toUpperCase() + n.slice(1);
  };
  for (const k of ORDER) {
    const a = AGENTS[k];
    assert.equal(a.key, k);
    assert.ok(old.includes(`god: "${oldName(k)}", name: "${a.name}"`), `${k} name`);
    const appsTeammate = ["sales", "support", "forms", "email"].includes(k);
    assert.equal(old.includes(`${k}: { god: "${oldName(k)}", name: "${a.name}", apps: [], soon: true`), appsTeammate, `${k} is coming soon only in the old app`);
    // Archon's job starts with the old app's, then says he also builds on the owner's own site builder.
    if (k === "web") assert.ok(old.includes(`job: "${a.job.split(". ")[0]}."`), "web job");
    else if (!appsTeammate) assert.ok(old.includes(a.job), `${k} job`);
    assert.doesNotMatch(a.job + a.out.join(" ") + (a.rules ?? []).join(" "), /[—–]/);
  }
});

test("Cyrus, Cleo, Midas and Irene: honest jobs that name their apps and the owner's OK", () => {
  assert.match(AGENTS.email.job, /Gmail or Outlook after you approve/);
  assert.match(AGENTS.forms.job, /Google Calendar or Calendly/);
  assert.match(AGENTS.sales.job, /Nothing goes out until you approve it/);
  assert.match(AGENTS.support.job, /hands refunds, legal questions and upset customers to you/);
  for (const k of ["sales", "support", "forms", "email"] as const) {
    const a = AGENTS[k];
    assert.equal(a.out.length, 3, k);
    assert.ok(a.rules && a.rules.length >= 4, k);
    // Short sentences for the Team page.
    for (const s of a.job.split(/\. /)) assert.ok(s.split(" ").length <= 25, `${k}: ${s}`);
  }
});

test("Archon: an honest job that names Framer, Webflow, WordPress, WordPress.com and Shopify and the owner's OK, and keeps Arrowsterr", () => {
  const a = AGENTS.web;
  assert.deepEqual(a.apps, ["arrowsterr"]);
  assert.match(a.job, /Framer/);
  assert.match(a.job, /Webflow/);
  assert.match(a.job, /WordPress\.com/);
  assert.match(a.job, /WordPress,/);
  assert.match(a.job, /Shopify/);
  assert.match(a.job, /Nothing goes live until you approve it/);
  assert.equal(a.out.length, 3);
  assert.ok(a.rules && a.rules.length >= 4);
  assert.match(a.rules.join(" "), /Never publish, add or change anything on the website without the owner's OK, unless the owner put you on autopilot\./);
  assert.match(a.rules.join(" "), /Never invent/);
  // His own WordPress and Shopify: drafts and hidden pages first, the preview link, and nothing about the store's sales.
  const rules = a.rules.join(" ");
  assert.match(rules, /your own WordPress site/);
  assert.match(rules, /start as drafts\. Show the owner the preview link, then publish only after they approve\./);
  assert.match(rules, /On Shopify, new pages and blog posts start hidden/);
  assert.match(rules, /Never touch products, orders, customers or discounts\./);
  for (const r of a.rules) assert.doesNotMatch(r, /[–—]/);
  for (const s of a.job.split(/\. /)) assert.ok(s.split(" ").length <= 25, s);
});

test("every agent has both pictures in public/img/agents", () => {
  for (const k of ORDER) {
    for (const p of [agentFace(k), agentPicture(k)]) assert.ok(existsSync(new URL(`../public${p}`, import.meta.url)), `${p} is missing`);
  }
});

test("the SQL agent and model lists match team.ts and models.ts", () => {
  const sql = readFileSync(new URL("../supabase/011_ai_team.sql", import.meta.url), "utf8");
  const agentLists = [...sql.matchAll(/agent in \(([^)]+)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
  assert.ok(agentLists.length >= 3, "messages, agent_prefs and ai_usage each check the agent");
  for (const list of agentLists) assert.deepEqual(list, ORDER);
  // Approvals and activity (013) check the agent the same way.
  const approvals = readFileSync(new URL("../supabase/013_approvals.sql", import.meta.url), "utf8");
  const more = [...approvals.matchAll(/agent in \(([^)]+)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
  assert.equal(more.length, 2, "approvals and activity each check the agent");
  for (const list of more) assert.deepEqual(list, ORDER);
  const models = sql.match(/model in \(([^)]+)\)/)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(models, [...MODEL_CHOICES]);
});

test("the agent lists in 014 (routines, skills, memories) match team.ts", () => {
  const sql = readFileSync(new URL("../supabase/014_routines_skills_memory.sql", import.meta.url), "utf8");
  const lists = [...sql.matchAll(/agent in \(([^)]+)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
  assert.equal(lists.length, 3);
  for (const list of lists) assert.deepEqual(list, ORDER);
});

test("agentByGod and parseMentions", () => {
  assert.equal(agentByGod("ATHENA"), "chief");
  assert.equal(agentByGod("Zeus"), null);
  assert.equal(agentByGod(undefined), null);
  assert.deepEqual(parseMentions("@Theseus, @archon! and @Theseus"), ["seo", "web"]);
  assert.deepEqual(parseMentions("(@Cyrus) mail ana@cyrus.com"), ["email"]);
  assert.deepEqual(parseMentions("@@Alexander"), []);
  assert.deepEqual(parseMentions(""), []);
});

test("old names from before the rename still reach the same teammate", () => {
  assert.deepEqual(parseMentions("@Hermes and @athena, then @Midas"), ["sales", "chief"]);
  assert.equal(agentByGod("Iris"), "email");
  assert.equal(agentByGod("hephaestus"), "web");
  // The @ menu offers only the new names.
  assert.deepEqual(mentionMatches("her"), []);
});

test("the @ menu: what's being typed, who matches, and putting the name in", () => {
  assert.equal(mentionQuery("ask @Art"), "art");
  assert.equal(mentionQuery("@"), "");
  assert.equal(mentionQuery("ana@art"), null);
  assert.equal(mentionQuery("ask @Art now"), null);
  assert.deepEqual(mentionMatches(""), ORDER);
  assert.deepEqual(mentionMatches("a"), ["chief", "web"]);
  // A job title word matches too, after the names.
  assert.deepEqual(mentionMatches("so"), ["social"]);
  assert.deepEqual(mentionMatches("web"), ["web"]);
  assert.deepEqual(mentionMatches("sales"), ["sales"]);
  assert.deepEqual(mentionMatches("zzz"), []);
  assert.deepEqual(insertMention("hi @the please", 7, "seo"), { text: "hi @Theseus  please", cursor: 12 });
  assert.deepEqual(insertMention("@", 1, "chief"), { text: "@Alexander ", cursor: 11 });
});

test("modelFor: an explicit choice, then the agent's setting, then auto", () => {
  assert.equal(modelFor("haiku", "sonnet"), MODELS.haiku);
  assert.equal(modelFor("auto", "sonnet"), MODELS.sonnet);
  assert.equal(modelFor(null, "opus"), MODELS.opus);
  assert.equal(modelFor("gpt", "nope"), MODELS.auto);
  assert.equal(MODELS.auto, "claude-opus-5-5");
});
