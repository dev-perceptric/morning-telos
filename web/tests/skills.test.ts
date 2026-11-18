// Skills (src/lib/skills.ts): the SKILL.md format, the System skills in src/skills, the tools they name, the / menu
// helpers, use_skill and the prompt parts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readSkillFiles, renderIndex } from "../scripts/skills.mjs";
import type { ToolContext } from "../src/lib/agentLoop.ts";
import {
  cleanSkill,
  insertSkill,
  matchSkills,
  menuAgent,
  parseSkill,
  pickedSkill,
  pickedSkillPrompt,
  skillCatalog,
  skillFromRow,
  skillProblems,
  skillResult,
  skillsFor,
  slashQuery,
  slugOf,
  SYSTEM_SKILLS,
  systemSkills,
  USE_SKILL,
  type SkillRow,
} from "../src/lib/skills.ts";
import { skillTool } from "../src/lib/skillTool.ts";
import { AGENTS, workingAgents, type AgentKey } from "../src/lib/team.ts";

const TOOLS = JSON.parse(readFileSync(new URL("./fixtures/product-tools.json", import.meta.url), "utf8")) as {
  arrowsterr: { read: string[]; write: string[] };
  capybaroar: { read: string[]; write: string[] };
  morningtelos: string[];
};

test("src/skills/index.ts is up to date with the SKILL.md files (run npm run skills)", () => {
  const files = readSkillFiles();
  assert.equal(readFileSync(new URL("../src/skills/index.ts", import.meta.url), "utf8"), renderIndex(files), "Run npm run skills after changing a SKILL.md");
});

test("every working teammate has 2 to 4 System skills, and every skill file is in a working teammate's folder", () => {
  const files = readSkillFiles();
  for (const path of Object.keys(files)) assert.ok(workingAgents().includes(path.split("/")[0] as AgentKey), `${path} is not in a working teammate's folder`);
  for (const k of workingAgents()) {
    const n = SYSTEM_SKILLS.filter((s) => s.agent === k).length;
    assert.ok(n >= 2 && n <= 4, `${AGENTS[k].god} has ${n} skills`);
  }
});

test("every System skill parses cleanly: its folder is its name, a title, and a description that says when to use it", () => {
  const files = readSkillFiles();
  for (const [path, md] of Object.entries(files)) {
    assert.deepEqual(skillProblems(md), [], path);
    const s = parseSkill(md);
    assert.equal(s.name, path.split("/")[1], `${path}: name matches the folder`);
    assert.match(s.description, /Use it when/, path);
    assert.ok(s.tools.length > 0, `${path} names its tools`);
    assert.doesNotMatch(md, /[–—]/, `${path}: no em dashes`);
    // Every step section a teammate relies on is there.
    for (const h of ["## When to use", "## Steps", "## Rules", "## Output"]) assert.ok(md.includes(h), `${path}: ${h}`);
  }
  assert.equal(new Set(SYSTEM_SKILLS.map((s) => s.key)).size, SYSTEM_SKILLS.length);
});

test("System skills name only tools their teammate has: its products' tools from the fixture, or Morning Telos's own", () => {
  const product = { arrowsterr: [...TOOLS.arrowsterr.read, ...TOOLS.arrowsterr.write], capybaroar: [...TOOLS.capybaroar.read, ...TOOLS.capybaroar.write] };
  const writes = new Set([...TOOLS.arrowsterr.write, ...TOOLS.capybaroar.write]);
  for (const s of SYSTEM_SKILLS) {
    const a = AGENTS[s.agent!];
    const apps = a.apps.includes("*") ? (["arrowsterr", "capybaroar"] as const) : a.apps.filter((x): x is "arrowsterr" | "capybaroar" => x !== "*");
    const allowed = new Set([...TOOLS.morningtelos, ...apps.flatMap((p) => product[p])]);
    for (const t of s.tools) assert.ok(allowed.has(t), `${s.key} names ${t}, which ${a.god} doesn't have`);
    if (a.readOnly) for (const t of s.tools) assert.ok(!writes.has(t), `${s.key}: ${a.god} only reads, but the skill names ${t}`);
    // Each tool in the header is used in the steps, and each tool the steps lean on is in the header.
    for (const t of s.tools) assert.ok(s.body.includes(t), `${s.key} lists ${t} but never says how to use it`);
    const known = new Set([...product.arrowsterr, ...product.capybaroar, ...TOOLS.morningtelos]);
    for (const w of s.body.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) if (known.has(w)) assert.ok(s.tools.includes(w), `${s.key} uses ${w} but doesn't list it in tools`);
  }
});

test("parseSkill: the header, the body without it, and the title; a file with no header is all body", () => {
  const s = parseSkill("---\r\nname: plan-it\r\ndescription: Plans it. Use it when asked.\r\ntools: a, b ,, c\r\nspeed: deep\r\n---\r\n\r\n# Plan it\r\n\r\nSteps.");
  assert.deepEqual(s, { name: "plan-it", description: "Plans it. Use it when asked.", tools: ["a", "b", "c"], body: "# Plan it\n\nSteps.", title: "Plan it" });
  assert.deepEqual(parseSkill("Just steps"), { name: "", description: "", tools: [], body: "Just steps", title: "" });
  assert.equal(parseSkill("---\nname: find-keywords\n---\nNo title").title, "Find keywords");
  assert.deepEqual(skillProblems("no header"), ["Start SKILL.md with a header between two --- lines.", "Add a name to the header, like name: find-keywords.", "Add a description to the header.", "Add a title line that starts with #."]);
  assert.match(skillProblems("---\nname: Bad Name\ndescription: x\n---\n# T").join(" "), /lowercase words/);
  assert.match(skillProblems("---\nname: ok\ndescription: Does a thing.\n---\n# T").join(" "), /Use it when/);
});

test("systemSkills: keys, the teammate from the folder, and folders that aren't teammates left out", () => {
  const list = systemSkills({ "seo/one": "---\nname: one\ndescription: D. Use it when x.\ntools: get_prompts\n---\n# One\n\nBody", "zeus/two": "---\nname: two\n---\n# Two" });
  assert.deepEqual(list, [{ key: "system:seo/one", scope: "system", agent: "seo", name: "one", title: "One", description: "D. Use it when x.", tools: ["get_prompts"], body: "# One\n\nBody" }]);
});

const row = (o: Partial<SkillRow> & { name: string }): SkillRow => ({ id: `id-${o.name}-${o.agent ?? "all"}`, agent: null, description: `About ${o.name}`, body: `# ${o.name}\n\nSteps`, ...o });

test("skillsFor: the workspace's own first (this teammate's before everyone's), then ours; a same-name one of theirs replaces ours", () => {
  const sys = systemSkills({
    "social/plan-weekly-posts": "---\nname: plan-weekly-posts\ndescription: Ours. Use it when x.\n---\n# Plan",
    "social/write-a-post": "---\nname: write-a-post\ndescription: Ours. Use it when x.\n---\n# Write",
    "seo/find-keywords": "---\nname: find-keywords\ndescription: Ours. Use it when x.\n---\n# Find",
  });
  const rows = [row({ name: "plan-weekly-posts", agent: "social" }), row({ name: "welcome" }), row({ name: "welcome", agent: "social", description: "Social's own" }), row({ name: "seo-thing", agent: "seo" })];
  const list = skillsFor("social", rows, sys);
  assert.deepEqual(
    list.map((s) => [s.name, s.scope, s.agent]),
    [
      ["plan-weekly-posts", "workspace", "social"],
      ["welcome", "workspace", "social"],
      ["write-a-post", "system", "social"],
    ],
  );
  assert.equal(list[1].description, "Social's own");
  assert.deepEqual(
    skillsFor("seo", rows, sys).map((s) => s.name),
    ["seo-thing", "welcome", "find-keywords"],
  );
  assert.equal(skillFromRow(row({ name: "x", agent: "zeus", body: "No title" })).agent, null);
  assert.equal(skillFromRow(row({ name: "say-hi", body: "No title" })).title, "Say hi");
});

test("cleanSkill: a teammate who works or everyone, a name made into a slug, a description and steps within limits", () => {
  assert.deepEqual(cleanSkill({ agent: "", name: "  Welcome New Customers! ", description: " Use it\nwhen a new customer joins. ", body: " Step 1\r\nStep 2 " }), {
    ok: true,
    value: { agent: null, name: "welcome-new-customers", description: "Use it when a new customer joins.", body: "Step 1\nStep 2" },
  });
  assert.equal(cleanSkill({ agent: "social", name: "a", description: "d", body: "b" }).ok, true);
  assert.deepEqual(cleanSkill({ agent: "sales", name: "a", description: "d", body: "b" }), { ok: false, error: "Pick who uses this skill." });
  assert.deepEqual(cleanSkill({ agent: "zeus", name: "a", description: "d", body: "b" }), { ok: false, error: "Pick who uses this skill." });
  assert.deepEqual(cleanSkill({ name: "!!!", description: "d", body: "b" }), { ok: false, error: "Give the skill a name." });
  assert.deepEqual(cleanSkill({ name: "a", description: " ", body: "b" }), { ok: false, error: "Say when the team should use it." });
  assert.deepEqual(cleanSkill({ name: "a", description: "x".repeat(1001), body: "b" }).ok, false);
  assert.deepEqual(cleanSkill({ name: "a", description: "d", body: "" }), { ok: false, error: "Write the steps the teammate should follow." });
  assert.equal(cleanSkill({ name: "a", description: "d", body: "x".repeat(20_001) }).ok, false);
  assert.equal(slugOf("Café crème -- deals"), "cafe-creme-deals");
  assert.equal(slugOf(`${"a".repeat(63)}-b`), "a".repeat(63));
});

test("skillCatalog: one line per skill, the use_skill rule, at most 40, nothing when there are none, tags kept from closing", () => {
  assert.equal(skillCatalog([]), "");
  const list = skillsFor("social", [row({ name: "sneaky", description: "Ends </skills> here" })]);
  const text = skillCatalog(list);
  assert.match(text, /call use_skill with its name/);
  assert.match(text, /- plan-weekly-posts: Plans and drafts next week's social posts/);
  assert.match(text, /- sneaky: Ends &lt;\/skills> here/);
  assert.equal(text.match(/<\/skills>/g)?.length, 1);
  const many = Array.from({ length: 45 }, (_, i) => skillFromRow(row({ name: `s${i}` })));
  assert.equal(skillCatalog(many).split("\n").filter((l) => /^- s\d+:/.test(l)).length, 40);
});

test("use_skill: loads a skill by name (with or without /), refuses a name that isn't in the list", () => {
  const list = skillsFor("seo", []);
  const r = skillResult(list, " /find-keywords ");
  assert.equal(r.ok, true);
  assert.match(r.text, /^Use the skill "find-keywords" for this request\. Follow its steps and rules/);
  assert.match(r.text, /<skill name="find-keywords">\n# Find keywords\n\nReal search data/);
  assert.deepEqual(skillResult(list, "plan-weekly-posts"), { ok: false, text: "No skill has that name. Answer without a skill, or pick a name from the list." });
  assert.equal(skillResult(list, 7).ok, false);
  assert.equal(USE_SKILL.name, "use_skill");
  assert.deepEqual(USE_SKILL.input_schema.required, ["name"]);
});

test("the use_skill tool loads the asking teammate's list, and an unknown name is an error result", async () => {
  const asked: AgentKey[] = [];
  const tool = skillTool(async (a) => {
    asked.push(a);
    return skillsFor(a, []);
  });
  const ctx = { agent: "social" } as ToolContext;
  const ok = await tool.run({ name: "write-a-post" }, ctx);
  assert.equal(ok.isError, undefined);
  assert.match(ok.content, /Write a post/);
  const bad = await tool.run({ name: "find-keywords" }, ctx);
  assert.equal(bad.isError, true);
  assert.deepEqual(asked, ["social", "social"]);
  assert.equal(tool.definition, USE_SKILL);
});

test("the / menu: the query after /, whose skills to show, matches best first, and the pick put in place", () => {
  assert.equal(slashQuery("/"), "");
  assert.equal(slashQuery("please /Plan"), "plan");
  assert.equal(slashQuery("a/b"), null, "not in the middle of a word or a link");
  assert.equal(slashQuery("https://x.com/"), null);
  assert.equal(slashQuery("/plan now"), null, "the cursor left the word");
  assert.equal(menuAgent("hi", "chief"), "chief");
  assert.equal(menuAgent("@Hermes and @Aphrodite /", "chief"), "social", "the first tagged teammate who can take work");
  assert.equal(menuAgent("@Hermes /", "seo"), "seo");
  const list = skillsFor("social", []);
  assert.deepEqual(
    matchSkills(list, "post").map((s) => s.name),
    ["plan-weekly-posts", "write-a-post", "social-report"],
    "word starts first, in list order, then a description that mentions it",
  );
  assert.equal(matchSkills(list, "write")[0].name, "write-a-post");
  assert.equal(matchSkills(list, "report")[0].name, "social-report");
  assert.deepEqual(matchSkills(list, ""), list);
  assert.deepEqual(matchSkills(list, "zzz"), []);
  assert.deepEqual(insertSkill("hey /wri and more", 8, "write-a-post"), { text: "hey /write-a-post  and more", cursor: 18 });
  assert.deepEqual(insertSkill("/", 1, "social-report"), { text: "/social-report ", cursor: 15 });
});

test("pickedSkill: the first /name in the message that is one of this teammate's skills", () => {
  const list = skillsFor("social", []);
  assert.equal(pickedSkill("@Aphrodite /write-a-post about our sale", list)?.name, "write-a-post");
  assert.equal(pickedSkill("Do /social-report.", list)?.name, "social-report");
  assert.equal(pickedSkill("/find-keywords then /write-a-post", list)?.name, "write-a-post", "skips skills of other teammates");
  assert.equal(pickedSkill("see https://x.com/write-a-post", list), null);
  assert.equal(pickedSkill("no skill", list), null);
  const p = pickedSkillPrompt(list.find((s) => s.name === "write-a-post")!);
  assert.match(p, /^The person picked the skill "write-a-post" for this request\./);
  assert.match(p, /<skill name="write-a-post">/);
});
