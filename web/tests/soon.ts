// Marks a teammate as coming soon for one test, then puts it back. No teammate is coming soon since plan phase 4,
// step 2, but the "coming soon" paths stay (a new teammate starts there), so tests reach them this way.
import { AGENTS, type AgentKey } from "../src/lib/team.ts";

export async function withSoon<T>(key: AgentKey, fn: () => T | Promise<T>): Promise<T> {
  const was = AGENTS[key].soon;
  AGENTS[key].soon = true;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete AGENTS[key].soon;
    else AGENTS[key].soon = was;
  }
}
