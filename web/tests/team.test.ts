// The roster (src/lib/team.ts): the same 8 agents as the old app, @ tags, and the lists in SQL and on disk that must match.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MODEL_CHOICES, MODELS, modelFor } from "../src/lib/models.ts";
import { agentByGod, agentFace, agentPicture, AGENTS, insertMention, LEAD, mentionMatches, mentionQuery, ORDER, parseMentions, workingAgents } from "../src/lib/team.ts";

test("the same 8 agents, gods and order as the old app", () => {
  assert.deepEqual(ORDER, ["chief", "sales", "support", "forms", "email", "social", "seo", "web"]);
  assert.deepEqual(
    ORDER.map((k) => AGENTS[k].god),
    ["Athena", "Hermes", "Hestia", "Hora", "Iris", "Aphrodite", "Artemis", "Hephaestus"],
  );
  assert.deepEqual(workingAgents(), ["chief", "social", "seo", "web"]);
  assert.equal(LEAD, "chief");
  assert.ok(AGENTS.chief.readOnly);
  // Same text as app/lib/agents.js, so the old and new app describe the team the same way.
  const old = readFileSync(new URL("../../app/lib/agents.js", import.meta.url), "utf8");
  for (const k of ORDER) {
    const a = AGENTS[k];
    assert.equal(a.key, k);
    assert.ok(old.includes(`god: "${a.god}", name: "${a.name}"`), `${k} name`);
    assert.ok(old.includes(a.job), `${k} job`);
    assert.equal(old.includes(`${k}: { god: "${a.god}", name: "${a.name}", apps: [], soon: true`), Boolean(a.soon), `${k} soon`);
    assert.doesNotMatch(a.job + a.out.join(" "), /[—–]/);
  }
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
  const models = sql.match(/model in \(([^)]+)\)/)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(models, [...MODEL_CHOICES]);
});

test("agentByGod and parseMentions", () => {
  assert.equal(agentByGod("ATHENA"), "chief");
  assert.equal(agentByGod("Zeus"), null);
  assert.equal(agentByGod(undefined), null);
  assert.deepEqual(parseMentions("@Artemis, @hephaestus! and @Artemis"), ["seo", "web"]);
  assert.deepEqual(parseMentions("(@Iris) mail ana@iris.com"), ["email"]);
  assert.deepEqual(parseMentions("@@Athena"), []);
  assert.deepEqual(parseMentions(""), []);
});

test("the @ menu: what's being typed, who matches, and putting the name in", () => {
  assert.equal(mentionQuery("ask @Art"), "art");
  assert.equal(mentionQuery("@"), "");
  assert.equal(mentionQuery("ana@art"), null);
  assert.equal(mentionQuery("ask @Art now"), null);
  assert.deepEqual(mentionMatches(""), ORDER);
  assert.deepEqual(mentionMatches("a"), ["chief", "social", "seo"]);
  // A job title word matches too, after the names.
  assert.deepEqual(mentionMatches("so"), ["social"]);
  assert.deepEqual(mentionMatches("web"), ["web"]);
  assert.deepEqual(mentionMatches("sales"), ["sales"]);
  assert.deepEqual(mentionMatches("zzz"), []);
  assert.deepEqual(insertMention("hi @art please", 7, "seo"), { text: "hi @Artemis  please", cursor: 12 });
  assert.deepEqual(insertMention("@", 1, "chief"), { text: "@Athena ", cursor: 8 });
});

test("modelFor: an explicit choice, then the agent's setting, then auto", () => {
  assert.equal(modelFor("haiku", "sonnet"), MODELS.haiku);
  assert.equal(modelFor("auto", "sonnet"), MODELS.sonnet);
  assert.equal(modelFor(null, "opus"), MODELS.opus);
  assert.equal(modelFor("gpt", "nope"), MODELS.auto);
  assert.equal(MODELS.auto, "claude-opus-5-5");
});
