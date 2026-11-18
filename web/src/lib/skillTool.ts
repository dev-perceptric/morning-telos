// The use_skill tool: a teammate loads one of its skills (src/lib/skills.ts) by name and follows it.
// A standalone AgentTool (src/lib/agentLoop.ts): the skill list comes in as a loader, so tests use a fake.
import type { AgentTool } from "./agentLoop.ts";
import { USE_SKILL, skillResult, type Skill } from "./skills.ts";
import type { AgentKey } from "./team.ts";

/** use_skill for one workspace. `load` gives the skills a teammate can use (skillsFor). */
export function skillTool(load: (agent: AgentKey) => Promise<Skill[]>): AgentTool {
  return {
    definition: USE_SKILL,
    label: "Reading a skill",
    async run(input, ctx) {
      const r = skillResult(await load(ctx.agent), input.name);
      return r.ok ? { content: r.text } : { content: r.text, isError: true };
    },
  };
}
