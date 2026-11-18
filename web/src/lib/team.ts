// The AI team: who is on it, what each one does, and which ones are coming soon.
// Ported from the old app (app/lib/agents.js AGENTS and ORDER), so the names, jobs and order stay the same.
// Shared by the server and the browser. The SQL check lists in supabase/011_ai_team.sql must match ORDER
// (tests/team.test.ts checks they do).

export type AgentKey = "chief" | "sales" | "support" | "forms" | "email" | "social" | "seo" | "web";
/** The products an agent works through. "*" means every product the workspace has. */
export type AgentApp = "arrowsterr" | "capybaroar" | "*";

export type Agent = {
  key: AgentKey;
  /** The name people tag with @. */
  god: string;
  /** The job title. */
  name: string;
  /** One or two sentences on what they do. Also goes into the system prompt. */
  job: string;
  /** What the owner gets, for the Team page. */
  out: string[];
  apps: AgentApp[];
  /** Can't take work yet (plan phase 4). */
  soon?: boolean;
  /** Reads only. Never gets tools that change something. */
  readOnly?: boolean;
};

export const AGENTS: Record<AgentKey, Agent> = {
  chief: {
    key: "chief",
    god: "Athena",
    name: "Chief of Staff",
    apps: ["*"],
    readOnly: true,
    job: "Runs the owner's day. Answers questions about the business using every connected service, and hands work to the right teammate.",
    out: ["Answers with real numbers", "Hands tasks to the right teammate", "Plans your week with you"],
  },
  sales: {
    key: "sales",
    god: "Hermes",
    name: "Sales Rep",
    apps: [],
    soon: true,
    job: "Replies to new leads fast, books the call and follows up every quote until it's a yes or no.",
    out: ["Replies to leads in seconds", "Every quote followed up", "CRM always up to date"],
  },
  support: {
    key: "support",
    god: "Hestia",
    name: "Customer Support",
    apps: [],
    soon: true,
    job: "Answers customers on every channel from your knowledge, and hands the hard ones to a person.",
    out: ["Answers on every channel 24/7", "Escalates the hard ones", "Turns repeat questions into help articles"],
  },
  forms: {
    key: "forms",
    god: "Hora",
    name: "Forms + Scheduling",
    apps: [],
    soon: true,
    job: "Builds forms and booking pages, routes every lead and keeps your calendar full.",
    out: ["Forms built from one sentence", "Booking links and reminders", "Every submission routed"],
  },
  email: {
    key: "email",
    god: "Iris",
    name: "Email Marketing",
    apps: [],
    soon: true,
    job: "Plans and writes email campaigns, welcome flows and win-backs.",
    out: ["Campaigns written in your voice", "Welcome and win-back flows", "Results explained"],
  },
  social: {
    key: "social",
    god: "Aphrodite",
    name: "Social Media",
    apps: ["capybaroar"],
    job: "Plans, writes and schedules your social posts, and reports what works.",
    out: ["A full calendar every week", "Posts in your voice", "Results explained"],
  },
  seo: {
    key: "seo",
    god: "Artemis",
    name: "SEO Specialist",
    apps: ["arrowsterr"],
    job: "Gets you found on Google and in AI answers: keywords, content plan, rankings and AI visibility.",
    out: ["AI visibility tracked", "Content plan built for you", "Knows what to write next"],
  },
  web: {
    key: "web",
    god: "Hephaestus",
    name: "Website Builder",
    apps: ["arrowsterr"],
    job: "Plans and writes website pages people search for, with clear calls to book.",
    out: ["New pages from a message", "Copy that targets real searches", "Clear calls to book"],
  },
};

/** The order the team is shown in, everywhere. */
export const ORDER: AgentKey[] = ["chief", "sales", "support", "forms", "email", "social", "seo", "web"];

/** The agent who answers when nobody is tagged, and who speaks for the team (limits, errors). */
export const LEAD: AgentKey = "chief";

export const isAgentKey = (k: unknown): k is AgentKey => typeof k === "string" && Object.hasOwn(AGENTS, k);

const BY_GOD: Record<string, AgentKey> = Object.fromEntries(ORDER.map((k) => [AGENTS[k].god.toLowerCase(), k]));

/** The agent a name like "Athena" or "athena" stands for, or null. */
export const agentByGod = (name: unknown): AgentKey | null => (typeof name === "string" ? (BY_GOD[name.toLowerCase()] ?? null) : null);

/** Teammates who can take work now. */
export const workingAgents = (): AgentKey[] => ORDER.filter((k) => !AGENTS[k].soon);

/** Agents tagged with @ in a message, in the order they are first tagged. Unknown names are ignored. */
export function parseMentions(text: string): AgentKey[] {
  const out: AgentKey[] = [];
  for (const m of String(text).matchAll(/(?:^|[^\w@])@(\w+)/g)) {
    const k = agentByGod(m[1]);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The text after the @ the cursor sits in, like "art" in "ask @art", or null when the cursor isn't in a tag. */
export function mentionQuery(before: string): string | null {
  const m = before.match(/(?:^|\s)@(\w*)$/);
  return m ? m[1].toLowerCase() : null;
}

/** Teammates for the @ menu: names that start with the query first, then job titles with a word that does. */
export function mentionMatches(query: string): AgentKey[] {
  const q = query.toLowerCase();
  if (!q) return [...ORDER];
  const byName = ORDER.filter((k) => AGENTS[k].god.toLowerCase().startsWith(q));
  const byJob = ORDER.filter(
    (k) =>
      !byName.includes(k) &&
      AGENTS[k].name
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => w.startsWith(q)),
  );
  return [...byName, ...byJob];
}

/** Puts a picked teammate's name in place of the @ being typed. Returns the new text and where the cursor goes. */
export function insertMention(text: string, cursor: number, key: AgentKey): { text: string; cursor: number } {
  const before = text.slice(0, cursor).replace(/@(\w*)$/, `@${AGENTS[key].god} `);
  return { text: before + text.slice(cursor), cursor: before.length };
}

/** The face picture (small, square) and the full picture, served from public/img/agents. */
export const agentFace = (k: AgentKey) => `/img/agents/${k}-f.webp`;
export const agentPicture = (k: AgentKey) => `/img/agents/${k}.webp`;
