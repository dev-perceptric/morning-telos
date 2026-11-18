// Skills: playbooks a teammate follows for one kind of job, in the Agent Skills format (a SKILL.md with a short
// header between two "---" lines, then steps and rules in Markdown). Copied from Omniscient's src/lib/skills/format.ts
// and trimmed to the two scopes Morning Telos needs:
//   System     ours, read-only, shipped as files in src/skills/<agent>/<name>/SKILL.md (bundled by npm run skills)
//   Workspace  the team's own, rows in `skills` (supabase/014_routines_skills_memory.sql); owners and admins edit
// A person picks one by typing / in the composer; the teammate can pick one on its own with use_skill.
// Pure, so the screens, the server and the tests read skills the same way.

import type Anthropic from "@anthropic-ai/sdk";
import { SKILL_FILES } from "../skills/index.ts";
import { isAgentKey, parseMentions, workingAgents, type AgentKey } from "./team.ts";

export type Scope = "system" | "workspace";

export type Skill = {
  /** "system:<agent>/<name>" or the row's id. */
  key: string;
  scope: Scope;
  /** Null: for every teammate (Workspace skills only). */
  agent: AgentKey | null;
  /** Lowercase words joined by dashes. What / and use_skill use. */
  name: string;
  title: string;
  description: string;
  /** Tools the steps name (System skills). */
  tools: string[];
  /** The steps and rules, without the header. */
  body: string;
};

export type SkillRow = { id: string; agent: string | null; name: string; description: string; body: string; updated_at?: string };

export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 1000;
export const MAX_BODY = 20_000;
export const MAX_SKILLS = 100;
/** Most skills listed in one teammate's prompt. */
export const CATALOG_MAX = 40;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");

/** "find-keywords" reads as "Find keywords". */
export const titleOf = (name: string) => {
  const t = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** SKILL.md split into its header (name, description, tools) and body. Unknown header keys are left out. */
export function parseSkill(md: string): { name: string; description: string; tools: string[]; body: string; title: string } {
  const text = md.replace(/\r\n/g, "\n");
  const out = { name: "", description: "", tools: [] as string[], body: text, title: "" };
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end > 0) {
      for (const line of text.slice(4, end).split("\n")) {
        const at = line.indexOf(":");
        if (at < 1) continue;
        const k = line.slice(0, at).trim().toLowerCase();
        const v = line.slice(at + 1).trim();
        if (k === "name") out.name = v;
        else if (k === "description") out.description = v;
        else if (k === "tools")
          out.tools = v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
      }
      out.body = text.slice(end + 4).replace(/^\n+/, "");
    }
  }
  out.title = out.body.match(/^# (.+)$/m)?.[1]?.trim() || titleOf(out.name);
  return out;
}

/** What's wrong with a System SKILL.md, in plain words. Empty when it's fine. */
export function skillProblems(md: string): string[] {
  const s = parseSkill(md);
  const out: string[] = [];
  if (!md.startsWith("---\n")) out.push("Start SKILL.md with a header between two --- lines.");
  if (!s.name) out.push("Add a name to the header, like name: find-keywords.");
  else if (!NAME.test(s.name) || s.name.length > MAX_NAME) out.push("Write the name in lowercase words joined by dashes, like find-keywords.");
  if (!s.description) out.push("Add a description to the header.");
  else if (s.description.length > MAX_DESCRIPTION) out.push(`Keep the description under ${MAX_DESCRIPTION} characters.`);
  else if (!/Use it when/.test(s.description)) out.push('Say when to use it in the description, starting with "Use it when".');
  if (!/^# /m.test(s.body)) out.push("Add a title line that starts with #.");
  if (s.body.length > MAX_BODY) out.push(`Keep the steps under ${MAX_BODY.toLocaleString("en-US")} characters.`);
  return out;
}

/** The System skills, from src/skills (keys "<agent>/<name>"). A file in a folder that isn't a working teammate is left out. */
export function systemSkills(files: Record<string, string> = SKILL_FILES): Skill[] {
  return Object.entries(files).flatMap(([path, md]) => {
    const [agent] = path.split("/");
    if (!isAgentKey(agent)) return [];
    const s = parseSkill(md);
    return [{ key: `system:${path}`, scope: "system" as const, agent, name: s.name, title: s.title, description: s.description, tools: s.tools, body: s.body }];
  });
}

export const SYSTEM_SKILLS: Skill[] = systemSkills();

/** A Workspace skill row as one Skill. */
export function skillFromRow(r: SkillRow): Skill {
  const h1 = r.body.match(/^# (.+)$/m)?.[1]?.trim();
  return { key: r.id, scope: "workspace", agent: isAgentKey(r.agent) ? r.agent : null, name: r.name, title: h1 || titleOf(r.name), description: r.description, tools: [], body: r.body };
}

/**
 * The skills one teammate can use: the workspace's own (for this teammate or for everyone) first, then the System
 * skills for this teammate. A Workspace skill with the same name as a System one takes its place.
 */
export function skillsFor(agent: AgentKey, rows: SkillRow[], system: Skill[] = SYSTEM_SKILLS): Skill[] {
  const own = rows.map(skillFromRow).filter((s) => s.agent === null || s.agent === agent);
  // A skill for this teammate wins over one for everyone with the same name.
  own.sort((a, b) => Number(b.agent === agent) - Number(a.agent === agent));
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const s of [...own, ...system.filter((x) => x.agent === agent)]) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
  }
  return out;
}

/** Check a Workspace skill from the form. Returns what to save, or a message to show. */
export function cleanSkill(input: { agent?: unknown; name?: unknown; description?: unknown; body?: unknown }): { ok: true; value: { agent: AgentKey | null; name: string; description: string; body: string } } | { ok: false; error: string } {
  const agent = input.agent === undefined || input.agent === null || input.agent === "" ? null : input.agent;
  if (agent !== null && !(isAgentKey(agent) && workingAgents().includes(agent))) return { ok: false, error: "Pick who uses this skill." };
  const name = slugOf(String(input.name ?? ""));
  if (!name) return { ok: false, error: "Give the skill a name." };
  const description = String(input.description ?? "").replace(/\s+/g, " ").trim();
  if (!description) return { ok: false, error: "Say when the team should use it." };
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: `Keep the description under ${MAX_DESCRIPTION.toLocaleString("en-US")} letters.` };
  const body = String(input.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "Write the steps the teammate should follow." };
  if (body.length > MAX_BODY) return { ok: false, error: `Keep the steps under ${MAX_BODY.toLocaleString("en-US")} letters.` };
  return { ok: true, value: { agent, name, description, body } };
}

// ─────────────── the prompt ───────────────

// Text from people must not close our tags and pass for our own instructions.
const safe = (s: string) => s.replace(/<\/?(skill|skills)\b/gi, (m) => m.replace("<", "&lt;"));
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const FOLLOW =
  "Follow its steps and rules. It names product tools without their product: get_ai_visibility is arrowsterr__get_ai_visibility in your tools, and create_posts is capybaroar__create_posts. Where a step needs a tool you don't have, say what you'd need and do what you can with the tools you have.";

/**
 * The list of skills a teammate can pick from, for its system prompt, or "" when there are none. Stable for a
 * workspace and teammate, so it caches with the rest of the prompt.
 */
export function skillCatalog(list: Skill[]): string {
  const usable = list.filter((s) => s.description.trim()).slice(0, CATALOG_MAX);
  if (!usable.length) return "";
  return `Skills are your team's ways of doing a job.
- When a request clearly matches one, call use_skill with its name before anything else, then follow what it returns.
- Use at most one skill a request. Skip skills for quick questions and small talk.
- Never say a skill exists unless it's in this list.

<skills>
${usable.map((s) => `- ${s.name}: ${safe(oneLine(s.description)).slice(0, MAX_DESCRIPTION)}`).join("\n")}
</skills>`;
}

const skillText = (s: Skill) => `<skill name="${s.name}">\n# ${safe(oneLine(s.title))}\n\n${safe(s.body.replace(/^# .+\n+/, "")).slice(0, MAX_BODY)}\n</skill>`;

/** What a skill picked with / adds to that turn. */
export function pickedSkillPrompt(s: Skill): string {
  return `The person picked the skill "${s.name}" for this request. ${FOLLOW}\n\n${skillText(s)}`;
}

/** The use_skill tool definition. */
export const USE_SKILL: Anthropic.Beta.BetaTool = {
  name: "use_skill",
  description: "Load one of your skills by its name from the skills list, when the request clearly matches it. Returns the skill's steps and rules to follow for this request.",
  input_schema: { type: "object", properties: { name: { type: "string", description: "The skill's name from the list, like plan-weekly-posts." } }, required: ["name"] },
};

/** What use_skill returns for a name, or why it can't. */
export function skillResult(list: Skill[], name: unknown): { ok: true; skill: Skill; text: string } | { ok: false; text: string } {
  const want = typeof name === "string" ? name.trim().replace(/^\//, "").toLowerCase() : "";
  const s = list.find((x) => x.name === want);
  if (!s) return { ok: false, text: "No skill has that name. Answer without a skill, or pick a name from the list." };
  return { ok: true, skill: s, text: `Use the skill "${s.name}" for this request. ${FOLLOW}\n\n${skillText(s)}` };
}

// ─────────────── the / menu ───────────────

/** The text after the / the cursor sits in, like "plan" in "do /plan", or null when the cursor isn't in one. */
export function slashQuery(before: string): string | null {
  const m = before.match(/(?:^|\s)\/([a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Whose skills the / menu shows: the first teammate tagged in the message who can take work, else `fallback`. */
export function menuAgent(text: string, fallback: AgentKey): AgentKey {
  return parseMentions(text).find((k) => workingAgents().includes(k)) ?? fallback;
}

/** Skills that match what's typed after /, best first: name start, then a word start, then anywhere, then the description. */
export function matchSkills<T extends Pick<Skill, "name" | "title" | "description">>(list: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  const score = (x: T) => {
    if (x.name.startsWith(s)) return 0;
    if (x.name.split("-").some((w) => w.startsWith(s)) || x.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(s))) return 1;
    if (x.name.includes(s) || x.title.toLowerCase().includes(s)) return 2;
    if (x.description.toLowerCase().includes(s)) return 3;
    return 9;
  };
  return list
    .map((x, i) => ({ x, i, r: score(x) }))
    .filter((m) => m.r < 9)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((m) => m.x);
}

/** Puts a picked skill in place of the / being typed. Returns the new text and where the cursor goes. */
export function insertSkill(text: string, cursor: number, name: string): { text: string; cursor: number } {
  const before = text.slice(0, cursor).replace(/\/([a-z0-9-]*)$/i, `/${name} `);
  return { text: before + text.slice(cursor), cursor: before.length };
}

/** The skill a message picked with /name, from this teammate's list. The first one that matches wins. */
export function pickedSkill(text: string, list: Skill[]): Skill | null {
  for (const m of String(text).matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,!?:;])/g)) {
    const s = list.find((x) => x.name === m[1].toLowerCase());
    if (s) return s;
  }
  return null;
}
