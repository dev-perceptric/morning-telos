// The AI team, the same names and order as the app (web/src/lib/team.ts, checked by web/tests/extension-sync.test.ts),
// and the @ tagging helpers copied from there.

export const AGENTS = [
  { key: "chief", god: "Athena", name: "Chief of Staff" },
  { key: "sales", god: "Hermes", name: "Sales Rep" },
  { key: "support", god: "Hestia", name: "Customer Support" },
  { key: "forms", god: "Hora", name: "Forms + Scheduling" },
  { key: "email", god: "Iris", name: "Email Marketing" },
  { key: "social", god: "Aphrodite", name: "Social Media" },
  { key: "seo", god: "Artemis", name: "SEO Specialist" },
  { key: "web", god: "Hephaestus", name: "Website Builder" },
];

export const byKey = (k) => AGENTS.find((a) => a.key === k) ?? AGENTS[0];
export const byGod = (name) => AGENTS.find((a) => a.god.toLowerCase() === String(name ?? "").toLowerCase()) ?? null;

/** Teammates tagged with @ in a message, in the order they are first tagged. */
export function parseMentions(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?:^|[^\w@])@(\w+)/g)) {
    const a = byGod(m[1]);
    if (a && !out.includes(a.key)) out.push(a.key);
  }
  return out;
}

/** The text after the @ the cursor sits in, or null when the cursor isn't in a tag. */
export function mentionQuery(before) {
  const m = String(before).match(/(?:^|\s)@(\w*)$/);
  return m ? m[1].toLowerCase() : null;
}

/** Teammates for the @ menu: names that start with the query first, then job titles with a word that does. */
export function mentionMatches(query) {
  const q = String(query).toLowerCase();
  if (!q) return AGENTS.map((a) => a.key);
  const byName = AGENTS.filter((a) => a.god.toLowerCase().startsWith(q)).map((a) => a.key);
  const byJob = AGENTS.filter((a) => !byName.includes(a.key) && a.name.toLowerCase().split(/[^a-z]+/).some((w) => w.startsWith(q))).map((a) => a.key);
  return [...byName, ...byJob];
}

/** Puts a picked teammate's name in place of the @ being typed. Returns the new text and where the cursor goes. */
export function insertMention(text, cursor, key) {
  const before = text.slice(0, cursor).replace(/@(\w*)$/, `@${byKey(key).god} `);
  return { text: before + text.slice(cursor), cursor: before.length };
}
