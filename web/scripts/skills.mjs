// Bundles the System skills (src/skills/<agent>/<name>/SKILL.md) into src/skills/index.ts: npm run skills
// The built app reads nothing from src/ at runtime (see the Dockerfile), so the files go in as strings.
// tests/skills.test.ts fails when index.ts is older than the files, so a changed SKILL.md can't ship without it.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = new URL("../src/skills/", import.meta.url);

/** Every SKILL.md under src/skills, as "<agent>/<name>" → its text, sorted. */
export function readSkillFiles(dir = DIR) {
  const out = {};
  for (const agent of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const name of readdirSync(new URL(`${agent}/`, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      out[`${agent}/${name}`] = readFileSync(new URL(`${agent}/${name}/SKILL.md`, dir), "utf8");
    }
  }
  return out;
}

/** The text of src/skills/index.ts for these files. */
export function renderIndex(files) {
  const rows = Object.entries(files).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `// Made by scripts/skills.mjs from src/skills/<agent>/<name>/SKILL.md. Change those files, then run npm run skills.
// System skills: ours, read-only in the app, the same for every workspace (src/lib/skills.ts reads them).

export const SKILL_FILES: Record<string, string> = {
${rows.join("\n")}
};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readSkillFiles();
  writeFileSync(new URL("index.ts", DIR), renderIndex(files));
  console.log(`Wrote src/skills/index.ts with ${Object.keys(files).length} skills.`);
}
