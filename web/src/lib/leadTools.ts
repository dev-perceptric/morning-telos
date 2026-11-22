// Midas's lead tools (src/lib/leads.ts): save_lead adds or changes a lead on the business's own list, and find_leads
// reads it. They only change the app's own data, never anything outside it, so they need no approval. Only Midas
// gets them. Pure: the database comes in as deps (src/lib/teamTools.ts wires the real one).
import type { ToolDef } from "./agentLoop.ts";
import { cleanLead, type Lead, type LeadFields } from "./leads.ts";
import type { ToolSource } from "./toolRegistry.ts";

export type LeadToolDeps = {
  /** The workspace's leads matching the query (name, company or email), or all with `stage`, newest first. */
  find: (workspaceId: string, q: { text?: string; stage?: string; limit: number }) => Promise<Lead[]>;
  /** The lead with this email, or null. */
  byEmail: (workspaceId: string, email: string) => Promise<Lead | null>;
  byId: (workspaceId: string, id: string) => Promise<Lead | null>;
  insert: (workspaceId: string, f: Partial<LeadFields> & { source: "hermes"; last_contact: string | null }) => Promise<Lead>;
  update: (workspaceId: string, id: string, f: Partial<LeadFields> & { last_contact?: string | null }) => Promise<Lead>;
  now?: () => number;
};

const line = (l: Lead) =>
  [`${l.name}${l.company ? `, ${l.company}` : ""}`, l.email, l.value !== null ? `$${l.value.toLocaleString("en-US")}` : null, l.stage, l.next_step ? `next: ${l.next_step}${l.next_date ? ` on ${l.next_date}` : ""}` : null, `id ${l.id}`].filter(Boolean).join(" | ");

const FIELDS = {
  name: { type: "string", description: "The person's name." },
  company: { type: "string", description: "Their business." },
  email: { type: "string", description: "Their email. A lead with this email is changed instead of added again." },
  phone: { type: "string" },
  value: { type: "number", description: "The deal's value in dollars." },
  stage: { type: "string", enum: ["open", "won", "lost"] },
  next_step: { type: "string", description: "The next thing to do, like \"Follow up on the quote\"." },
  next_date: { type: "string", description: "When, as YYYY-MM-DD." },
  notes: { type: "string", description: "What to remember. Replaces the old notes." },
  contacted: { type: "boolean", description: "True when you just heard from or wrote to them." },
};

export function leadTools(deps: LeadToolDeps): ToolDef[] {
  const save: ToolDef = {
    definition: {
      name: "save_lead",
      description:
        "Add a lead or open quote to the business's leads list, or change one (by id, or by email). Keep the list up to date: add every new lead, set the next step and date after each email, and mark won or lost when you know. The person sees it on your Leads tab.",
      input_schema: { type: "object", properties: { id: { type: "string", description: "The lead's id from find_leads, to change it." }, ...FIELDS } },
    },
    label: "Saving a lead",
    async run(input, ctx) {
      const ws = ctx.workspace.id;
      const now = new Date((deps.now ?? Date.now)()).toISOString();
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      const found = id ? await deps.byId(ws, id) : email ? await deps.byEmail(ws, email) : null;
      if (id && !found) return { content: `No lead has id ${id.slice(0, 60)}. Call find_leads to see them.`, isError: true };
      const { contacted, id: _id, ...rest } = input;
      void _id;
      const c = cleanLead(rest, Boolean(found));
      if (!c.ok) return { content: c.error, isError: true };
      if (found) {
        const l = await deps.update(ws, found.id, { ...c.value, ...(contacted === true ? { last_contact: now } : {}) });
        return { content: `Changed the lead: ${line(l)}` };
      }
      const l = await deps.insert(ws, { ...c.value, source: "hermes", last_contact: contacted === true ? now : null });
      return { content: `Added the lead: ${line(l)}` };
    },
  };
  const find: ToolDef = {
    definition: {
      name: "find_leads",
      description: "Look up the business's leads list by name, company or email, or list the open, won or lost ones. Use it before writing to a lead, and to plan follow-ups.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "A name, company or email. Leave out to list by stage." }, stage: { type: "string", enum: ["open", "won", "lost"] }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
    },
    label: "Looking up leads",
    async run(input, ctx) {
      const text = typeof input.query === "string" ? input.query.trim().slice(0, 120) : "";
      const stage = typeof input.stage === "string" && ["open", "won", "lost"].includes(input.stage) ? input.stage : undefined;
      const limit = Math.max(1, Math.min(Math.floor(Number(input.limit)) || 20, 50));
      const list = await deps.find(ctx.workspace.id, { text: text || undefined, stage, limit });
      if (!list.length) return { content: text ? `No lead matches "${text}".` : "No leads yet." };
      return { content: list.map((l, i) => `${i + 1}. ${line(l)}`).join("\n") };
    },
  };
  return [save, find];
}

/** save_lead and find_leads for Midas only. */
export function leadToolSource(deps: LeadToolDeps): ToolSource {
  const tools = leadTools(deps);
  return async (ctx) => ({ tools: ctx.agent === "sales" ? tools : [], missing: [] });
}
