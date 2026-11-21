// Iris's campaign tools (src/lib/campaigns.ts): save_campaign writes or changes a draft on her Campaigns tab, and
// mailing_lists says who's on the business's lists. Nothing is sent: the person approves a campaign on the tab, which
// schedules it (src/lib/emailWork.ts). So they need no approval. Only Iris gets them. Pure: the database comes in.
import type { ToolDef } from "./agentLoop.ts";
import { cleanCampaign, type Campaign } from "./campaigns.ts";
import type { ToolSource } from "./toolRegistry.ts";

export type CampaignToolDeps = {
  byId: (workspaceId: string, id: string) => Promise<Pick<Campaign, "id" | "status" | "subject"> | null>;
  insert: (workspaceId: string, c: { subject: string; body: string; list: string | null; source: "iris" }) => Promise<{ id: string }>;
  update: (workspaceId: string, id: string, c: { subject: string; body: string; list: string | null }) => Promise<void>;
  /** Each list with how many people on it can get email (not unsubscribed). */
  lists: (workspaceId: string) => Promise<{ list: string; people: number }[]>;
};

export function campaignTools(deps: CampaignToolDeps): ToolDef[] {
  const save: ToolDef = {
    definition: {
      name: "save_campaign",
      description:
        "Save an email campaign as a draft on your Campaigns tab, or change a draft (by id). Use {{first_name}} for each person's first name. Leave out the unsubscribe line and the address: they're added to every email. Nothing is sent: the person reads it, sends a test and approves it on the tab.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "A draft's id, to change it." },
          subject: { type: "string" },
          body: { type: "string", description: "The email, as plain text." },
          list: { type: "string", description: "Which list gets it, from mailing_lists. Leave out for everyone." },
        },
        required: ["subject", "body"],
      },
    },
    label: "Saving a campaign",
    async run(input, ctx) {
      const c = cleanCampaign(input);
      if (!c.ok) return { content: c.error, isError: true };
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (id) {
        const found = /^[0-9a-f-]{36}$/i.test(id) ? await deps.byId(ctx.workspace.id, id) : null;
        if (!found) return { content: `No campaign has id ${id.slice(0, 60)}.`, isError: true };
        if (found.status !== "draft") return { content: "That campaign isn't a draft any more, so it can't change. Save a new one.", isError: true };
        await deps.update(ctx.workspace.id, id, c.value);
        return { content: `Changed the draft "${c.value.subject}". The person approves it on your Campaigns tab.` };
      }
      const made = await deps.insert(ctx.workspace.id, { ...c.value, source: "iris" });
      return { content: `Saved the draft "${c.value.subject}" (id ${made.id}). Tell the person it's on your Campaigns tab, where they can send a test and approve it.` };
    },
  };
  const lists: ToolDef = {
    definition: { name: "mailing_lists", description: "The business's mailing lists and how many people on each can get email.", input_schema: { type: "object", properties: {} } },
    label: "Checking the mailing lists",
    async run(_input, ctx) {
      const l = await deps.lists(ctx.workspace.id);
      if (!l.length) return { content: "The mailing list is empty. The person imports contacts in your Settings tab." };
      return { content: l.map((x) => `${x.list}: ${x.people.toLocaleString("en-US")} people`).join("\n") };
    },
  };
  return [save, lists];
}

/** save_campaign and mailing_lists for Iris only. */
export function campaignToolSource(deps: CampaignToolDeps): ToolSource {
  const tools = campaignTools(deps);
  return async (ctx) => ({ tools: ctx.agent === "email" ? tools : [], missing: [] });
}
