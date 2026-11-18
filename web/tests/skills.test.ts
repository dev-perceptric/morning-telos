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
import { ACTION_TOOL, SEARCH_TOOL } from "../src/lib/composio/appAction.ts";
import { APP_ACCESS, appAction } from "../src/lib/composio/catalog.ts";
import { HIDDEN, toolName } from "../src/lib/productTools.ts";
import { skillTool } from "../src/lib/skillTool.ts";
import { AGENTS, workingAgents, type AgentKey } from "../src/lib/team.ts";
import { withSoon } from "./soon.ts";

const TOOLS = JSON.parse(readFileSync(new URL("./fixtures/product-tools.json", import.meta.url), "utf8")) as {
  arrowsterr: { read: string[]; write: string[] };
  capybaroar: { read: string[]; write: string[] };
  morningtelos: string[];
};

test("src/skills/index.ts is up to date with the SKILL.md files (run npm run skills)", () => {
  const files = readSkillFiles();
  assert.equal(readFileSync(new URL("../src/skills/index.ts", import.meta.url), "utf8"), renderIndex(files), "Run npm run skills after changing a SKILL.md");
});

test("every working teammate has 2 to 4 System skills (Hephaestus up to 8, with his design skills), and every skill file is in a working teammate's folder", () => {
  const files = readSkillFiles();
  for (const path of Object.keys(files)) assert.ok(workingAgents().includes(path.split("/")[0] as AgentKey), `${path} is not in a working teammate's folder`);
  for (const k of workingAgents()) {
    const n = SYSTEM_SKILLS.filter((s) => s.agent === k).length;
    assert.ok(n >= 2 && n <= (k === "web" ? 8 : 4), `${AGENTS[k].god} has ${n} skills`);
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

test("System skills name only tools their teammate has: its products' tools from the fixture, the app tools if it may use apps, or Morning Telos's own", () => {
  const product = { arrowsterr: [...TOOLS.arrowsterr.read, ...TOOLS.arrowsterr.write], capybaroar: [...TOOLS.capybaroar.read, ...TOOLS.capybaroar.write] };
  const writes = new Set([...TOOLS.arrowsterr.write, ...TOOLS.capybaroar.write]);
  const appTools = [SEARCH_TOOL, ACTION_TOOL];
  for (const s of SYSTEM_SKILLS) {
    const a = AGENTS[s.agent!];
    const apps = a.apps.includes("*") ? (["arrowsterr", "capybaroar"] as const) : a.apps.filter((x): x is "arrowsterr" | "capybaroar" => x !== "*");
    // app_search_actions and app_action only for a teammate in APP_ACCESS (src/lib/composio/catalog.ts).
    const allowed = new Set([...TOOLS.morningtelos, ...apps.flatMap((p) => product[p]), ...(APP_ACCESS[s.agent!] ? appTools : [])]);
    for (const t of s.tools) assert.ok(allowed.has(t), `${s.key} names ${t}, which ${a.god} doesn't have`);
    if (a.readOnly) for (const t of s.tools) assert.ok(!writes.has(t), `${s.key}: ${a.god} only reads, but the skill names ${t}`);
    // Tools Morning Telos never gives an agent (src/lib/productTools.ts HIDDEN).
    for (const t of s.tools) for (const p of apps) assert.ok(!HIDDEN[p].has(t), `${s.key} names ${t}, which agents never get`);
    // Each tool in the header is used in the steps, and each tool the steps lean on is in the header.
    for (const t of s.tools) assert.ok(s.body.includes(t), `${s.key} lists ${t} but never says how to use it`);
    const known = new Set([...product.arrowsterr, ...product.capybaroar, ...TOOLS.morningtelos, ...appTools]);
    for (const w of s.body.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) if (known.has(w)) assert.ok(s.tools.includes(w), `${s.key} uses ${w} but doesn't list it in tools`);
  }
});

test("Iris, Hora, Hermes and Hestia each have their three skills; app skills say where to connect and that changes wait", () => {
  const names = (k: AgentKey) => SYSTEM_SKILLS.filter((s) => s.agent === k).map((s) => s.name);
  assert.deepEqual(names("email"), ["welcome-series", "win-back", "write-a-campaign"]);
  assert.deepEqual(names("forms"), ["book-a-meeting", "reminder-emails", "weekly-schedule"]);
  assert.deepEqual(names("sales"), ["follow-up-new-leads", "quote-follow-up", "update-the-crm"]);
  assert.deepEqual(names("support"), ["answer-an-email", "build-an-faq", "daily-inbox-triage"]);
  for (const s of SYSTEM_SKILLS.filter((x) => ["email", "forms", "sales", "support"].includes(x.agent!))) {
    assert.ok(s.tools.includes("app_search_actions") && s.tools.includes("app_action"), `${s.key} works through the apps`);
    assert.match(s.body, /in Settings, Apps/, `${s.key} says where to connect an app`);
    assert.match(s.body, /approv|Read only\./, `${s.key} says what waits for the owner's OK, or that it only reads`);
    assert.ok(!/delete/i.test(s.body) || /Never delete|never.*delete/i.test(s.body) || /close, delete or merge/.test(s.body), `${s.key} never deletes`);
  }
  // Hestia's skills that answer customers hand refunds, legal and medical questions and angry customers to the owner.
  for (const n of ["answer-an-email", "daily-inbox-triage"]) {
    const s = SYSTEM_SKILLS.find((x) => x.agent === "support" && x.name === n)!;
    assert.match(s.body, /refund/i, n);
    assert.match(s.body, /legal/, n);
    assert.match(s.body, /medical/, n);
    assert.match(s.body, /angry/, n);
  }
});

test("Hephaestus: build-on-framer and the page skills put their work on a connected site builder, never publish on their own, and never delete", () => {
  const web = SYSTEM_SKILLS.filter((s) => s.agent === "web");
  for (const n of ["build-on-framer", "design-a-page", "improve-a-page", "match-the-brand", "plan-the-site", "review-the-design", "write-a-page"]) assert.ok(web.some((s) => s.name === n), n);
  for (const n of ["build-on-framer", "design-a-page", "improve-a-page", "match-the-brand", "review-the-design", "write-a-page"]) {
    const s = web.find((x) => x.name === n)!;
    assert.ok(s.tools.includes("app_search_actions") && s.tools.includes("app_action"), `${n} works through the site builder`);
    assert.match(s.body, /in Settings, Apps/, `${n} says where to connect a site builder`);
    assert.match(s.body, /approv|agreed/, `${n} says changes wait for the owner's OK`);
    if (n !== "match-the-brand") assert.match(s.body, /Never publish/, n);
    assert.doesNotMatch(s.body, /\b(FRAMER|WEBFLOW|WORDPRESS_COM)_\w*(DELETE|REMOVE)/, `${n} never names a delete`);
    // Every action a skill names is one Hephaestus may run.
    for (const slug of s.body.match(/\b(?:FRAMER|WEBFLOW|WORDPRESS_COM)_[A-Z0-9_]+\b/g) ?? []) {
      const toolkit = slug.startsWith("WORDPRESS_COM_") ? "wordpress_com" : slug.split("_")[0].toLowerCase();
      assert.ok(appAction(toolkit, slug), `${n} names ${slug}, which isn't in the catalog`);
    }
  }
  const framer = web.find((x) => x.name === "build-on-framer")!.body;
  assert.match(framer, /search_knowledge/);
  assert.match(framer, /FRAMER_DEPLOY/);
  assert.match(framer, /Ask before you publish/);
  for (const n of ["write-a-page", "improve-a-page"]) assert.match(web.find((x) => x.name === n)!.body, /Framer.*\n.*Webflow.*\n.*WordPress\.com/, `${n} covers each builder`);
});

const body = (n: string) => SYSTEM_SKILLS.find((s) => s.agent === "web" && s.name === n)!.body;
const steps = (n: string) => body(n).split("## Steps")[1].split("\n## ")[0];

test("Hephaestus runs review-the-design before asking to publish in build-on-framer, write-a-page, improve-a-page and design-a-page", () => {
  for (const n of ["build-on-framer", "write-a-page", "improve-a-page", "design-a-page"]) {
    assert.match(steps(n), /^\d+\. Run review-the-design .*before you ask (the owner )?to publish/m, `${n} has a step that runs review-the-design before publishing`);
  }
  // In build-on-framer the review comes before the step that publishes.
  const framer = steps("build-on-framer");
  assert.ok(framer.indexOf("review-the-design") < framer.indexOf("FRAMER_PUBLISH"), "review before FRAMER_PUBLISH");
});

test("Hephaestus's design skills: the brand comes from real sources and is saved to memory, the review lists at most 7 problems and works from the page's structure", () => {
  const brand = body("match-the-brand");
  for (const t of ["search_knowledge", "remember", "FRAMER_GET_AGENT_CONTEXT"]) assert.ok(brand.includes(t), `match-the-brand uses ${t}`);
  assert.match(brand, /Never invent a logo, colors or fonts/);
  assert.match(brand, /Ask the owner/);
  const design = body("design-a-page");
  assert.match(design, /match-the-brand/, "design-a-page starts from the brand");
  for (const w of ["Hero", "Proof", "Services", "How it works", "FAQ", "Book or contact", "phone first", "4.5 to 1", "44px", "gradients", "emoji"]) assert.ok(design.includes(w), `design-a-page covers ${w}`);
  assert.match(design, /Never invent a logo or brand colors/);
  const review = body("review-the-design");
  assert.match(review, /up to 7 problems, biggest first/i);
  assert.match(review, /one approval/);
  assert.match(review, /can't see the page as a picture/, "says it has no screenshot");
  for (const t of ["FRAMER_SERIALIZE_FOR_AGENT", "WEBFLOW_GET_PAGE_DOM", "alt text", "4.5 to 1", "44px", "60 characters", "155"]) assert.ok(review.includes(t), `review-the-design checks ${t}`);
  // Every skill keeps the two rules: nothing goes live without the owner, and no invented facts.
  for (const n of ["design-a-page", "match-the-brand", "review-the-design"]) assert.match(body(n), /Never invent facts, (prices, )?reviews/, n);
  // The Apache 2.0 credit for the parts adapted from Anthropic's frontend-design skill stays in the header.
  for (const n of ["design-a-page", "review-the-design"]) assert.match(readSkillFiles()[`web/${n}`], /^ {2}source: .*frontend-design.*Apache License 2\.0/m, n);
});

test("a teammate marked coming soon can't own a skill, and the / menu skips it", async () => {
  await withSoon("sales", () => {
    assert.deepEqual(cleanSkill({ agent: "sales", name: "a", description: "d", body: "b" }), { ok: false, error: "Pick who uses this skill." });
    assert.equal(menuAgent("@Hermes and @Aphrodite /", "chief"), "social");
  });
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
  assert.equal(cleanSkill({ agent: "sales", name: "a", description: "d", body: "b" }).ok, true, "Hermes takes work now");
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
  // Skills name product tools short; the prompt says how they appear in the teammate's tool list.
  assert.match(ok.content, new RegExp(`create_posts is ${toolName("capybaroar", "create_posts")}`));
});

test("the / menu: the query after /, whose skills to show, matches best first, and the pick put in place", () => {
  assert.equal(slashQuery("/"), "");
  assert.equal(slashQuery("please /Plan"), "plan");
  assert.equal(slashQuery("a/b"), null, "not in the middle of a word or a link");
  assert.equal(slashQuery("https://x.com/"), null);
  assert.equal(slashQuery("/plan now"), null, "the cursor left the word");
  assert.equal(menuAgent("hi", "chief"), "chief");
  assert.equal(menuAgent("@Hermes and @Aphrodite /", "chief"), "sales", "the first tagged teammate");
  assert.equal(menuAgent("@Hestia /", "seo"), "support");
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
