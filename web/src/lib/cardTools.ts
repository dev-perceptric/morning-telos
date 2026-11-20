// The card tools every teammate has (src/lib/cards.ts): show_card, and the goal tools set_goal, set_plan,
// update_step and log_progress (src/lib/goals.ts). They only shape the answer or the workspace's own goals, never
// anything outside the app, so they need no approval:
//   show_card    checks the card and shows it. A post or email preview must point at an approval this chat already
//                saved, and shows that approval's own words, so Approve on the card approves exactly what is shown.
//   set_goal     a goal card the person starts (the browser saves the goal as them, through row level security).
//   set_plan     a plan card the person starts with Go (the browser saves the steps).
//   update_step  moves a step to running or done, live on the plan card.
//   log_progress the goal's number: from real data where a product gives it (followers, reach, AI visibility),
//                else the number the teammate gives. Shows a progress card.
// Pure: the database and the products come in as deps (src/lib/teamTools.ts wires the real ones).

import type Anthropic from "@anthropic-ai/sdk";
import type { AgentTool, ToolContext, ToolResult } from "./agentLoop.ts";
import type { Approval } from "./approvals.ts";
import { emailWords, goalSentence, isDay, METRICS, NETWORKS, postWords, readCard, SHOW_KINDS, type Card, type CardKind, type Metric } from "./cards.ts";
import { appName, groupOf, isDirect, isToolkit } from "./composio/catalog.ts";
import { applyReading, goalLine, METRIC_SOURCE, progressCard, type GoalRow, type StepRow } from "./goals.ts";
import type { ToolSource } from "./toolRegistry.ts";
import { AGENTS, workingAgents } from "./team.ts";

export type ApprovalFace = Pick<Approval, "id" | "thread_id" | "product" | "tool" | "status" | "input">;
export type GoalPatch = Pick<GoalRow, "current" | "baseline" | "history" | "checked_at" | "status">;

export type CardToolDeps = {
  /** The approval with this id, only if it is in this workspace. */
  approval: (workspaceId: string, id: number) => Promise<ApprovalFace | null>;
  /** The chat's newest active goal, or null. */
  activeGoal: (workspaceId: string, threadId: string) => Promise<GoalRow | null>;
  /** The steps of the chat's newest started plan, in order. Empty before anyone taps Go. */
  planSteps: (workspaceId: string, threadId: string) => Promise<StepRow[]>;
  setStep: (workspaceId: string, stepId: string, status: StepRow["status"]) => Promise<void>;
  saveGoal: (workspaceId: string, goalId: string, patch: GoalPatch) => Promise<void>;
  /** The goal's raw number from real data (total followers, reach, AI visibility), or null when no product gives it. */
  reading: (workspaceId: string, metric: Metric) => Promise<number | null>;
  /** Pending approvals in a chat, for the goal's status. */
  pending?: (workspaceId: string, threadId: string) => Promise<number>;
  now?: () => number;
  log?: (message: string) => void;
};

export const CARD_TOOL_NAMES = ["show_card", "set_goal", "set_plan", "update_step", "log_progress"] as const;

/** What the tools tell the teammate, by kind: stop and wait for the person, or carry on. */
export const CARD_RESULTS: Record<CardKind, string> = {
  choices: "The choices card is on screen. Stop here and wait. The person's picks come as their next message.",
  quick_replies: "The quick replies are under your answer.",
  table: "The table is on screen. Don't repeat its rows in words.",
  chart: "The chart is on screen. Don't repeat its numbers in words.",
  connect: "The connect card is on screen. Stop here and wait. When the app is connected, the person's next message says so. Then carry on.",
  post_preview: "The post preview is on screen. The owner can edit and approve each post there. Stop here and wait.",
  email_preview: "The email preview is on screen. The owner can edit and approve it there. Stop here and wait.",
  goal: "The goal card is on screen. Stop here and wait for Start. The person can change the number and the date first.",
  plan: "The plan card is on screen. Stop here and wait for Go. The person's next message lists the steps they kept. Then start on step 1 and mark it with update_step.",
  progress: "The progress card is on screen.",
};

const fail = (content: string): ToolResult => ({ content, isError: true });
const why = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** Apps a connect card can name: an app on Settings, Apps, social accounts, or a self-hosted WordPress site. */
export const connectable = (app: string) => app === "social" || isToolkit(app) || isDirect(app);
/** The app's name on the card. */
export const connectName = (app: string) => (app === "social" ? "Social accounts" : appName(app));

const s = (description: string) => ({ type: "string", description });
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });
const sendAction = { type: "object", properties: { label: s("The button's words."), message: s("What it sends as the person's message.") }, required: ["label", "message"] };

export const SHOW_CARD_TOOL: Anthropic.Beta.BetaTool = {
  name: "show_card",
  description:
    "Show an interactive card under your answer. Kinds: choices (questions with options to tap; their picks come back as the person's next message), quick_replies (2 to 4 short replies to tap), table (a list of items, up to 50 rows, with optional buttons that send a message), chart (numbers over time as a line or bars), connect (a Connect button for an app that isn't connected), post_preview (social posts as the network shows them, linked to their approvals), email_preview (an email linked to its approval). Only fill the fields the kind uses. Text is plain words, no Markdown or HTML.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...SHOW_KINDS], description: "Which card." },
      title: s("Optional. A short heading at the top of the card, like 'Leads' or 'Traffic'."),
      note: s("Optional. A few words at the top right, like '25 found' or 'US, estimate'."),
      questions: {
        type: "array",
        description: "choices: 1 to 4 questions.",
        items: {
          type: "object",
          properties: {
            label: s("The question, like 'Where should we post?'"),
            options: strings("2 to 8 short options."),
            multi: { type: "boolean", description: "True when the person may pick more than one." },
            picked: strings("Optional. Options picked to start with, your best guess."),
          },
          required: ["label", "options"],
        },
      },
      submit: s("choices: the button's words, like 'Make the plan'."),
      replies: strings("quick_replies: 2 to 4 short replies, each one a message the person can send."),
      columns: strings("table: the column names, up to 8."),
      rows: {
        type: "array",
        description: "table: up to 50 rows. Each has one cell per column. Numbers as numbers.",
        items: {
          type: "object",
          properties: { cells: { type: "array", items: { type: ["string", "number"] } }, action: { ...sendAction, description: "Optional. A button on the row that sends a message, like 'Draft email'." } },
          required: ["cells"],
        },
      },
      actions: { type: "array", items: sendAction, description: "table: optional, up to 3 buttons under the table. Each sends a message." },
      type: { type: "string", enum: ["line", "bar"], description: "chart: line (default) or bar." },
      labels: strings("chart: 2 to 60 labels along the bottom, like months."),
      values: { type: "array", items: { type: "number" }, description: "chart: one number per label." },
      unit: s("chart: optional unit, like 'visits'."),
      app: s("connect: the app id, like gmail, outlook, googlecalendar, calendly, hubspot, pipedrive, salesforce, slack, zendesk, help_scout, framer, webflow, wordpress_com or shopify; 'social' for the social accounts; 'wordpress' for a self-hosted WordPress site."),
      text: s("connect: one line on why, like 'Connect your LinkedIn page so I can post it. You only do this once.'"),
      brand: s("post_preview: the name the posts appear under. Defaults to the business."),
      posts: {
        type: "array",
        description: "post_preview: up to 10 posts, each saved for approval first (one post per approval).",
        items: {
          type: "object",
          properties: {
            approval_id: { type: "integer", description: "The approval number the save returned." },
            network: { type: "string", enum: [...NETWORKS] },
            text: s("The post's words."),
            when: s("Optional. When it goes out, like 'Tue 9:10 AM'."),
            image_text: s("Optional. A short headline for the image, when the post has one."),
          },
          required: ["network", "text"],
        },
      },
      approval_id: { type: "integer", description: "email_preview: the approval number the save returned." },
      to: s("email_preview: who it goes to."),
      subject: s("email_preview: the subject line."),
      body: s("email_preview: the email's words."),
    },
    required: ["kind"],
  },
};

export const SET_GOAL_TOOL: Anthropic.Beta.BetaTool = {
  name: "set_goal",
  description:
    "Propose a goal when the person states a result they want (more followers, more bookings, more reviews). Shows a goal card: '<lead> <target> <unit> by <due>', where the person can change the number and the date, then taps Start. One goal per chat.",
  input_schema: {
    type: "object",
    properties: {
      metric: { type: "string", enum: [...METRICS], description: "followers or reach (read from the social results), ai_visibility (a percent, read from the SEO data), or other (you log the number)." },
      lead: s("The words before the number, like 'Grow LinkedIn by' or 'Get AI visibility to'."),
      target: { type: "number", description: "The number to reach, like 150." },
      unit: s("The unit after the number, like 'followers', '% of AI answers' or 'bookings'."),
      due: s("The due date, YYYY-MM-DD. Pick a realistic one, often the end of a month."),
      owner: s("Optional. The teammate who owns it, by name. Defaults to you."),
    },
    required: ["metric", "lead", "target", "unit", "due"],
  },
};

export const SET_PLAN_TOOL: Anthropic.Beta.BetaTool = {
  name: "set_plan",
  description: "Propose a plan of steps, each with the teammate who does it. Shows a plan card where the person can remove steps, then taps Go. Use it after a goal starts, or for any job with a few clear steps.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        description: "1 to 8 steps, in order.",
        items: { type: "object", properties: { title: s("The step, like 'Write 3 posts for next week'."), owner: s("The teammate who does it, by name."), note: s("Optional. A few words under it, like 'you approve each'.") }, required: ["title", "owner"] },
      },
      go: s("Optional. The button's words. Defaults to 'Go'."),
    },
    required: ["steps"],
  },
};

export const UPDATE_STEP_TOOL: Anthropic.Beta.BetaTool = {
  name: "update_step",
  description: "Mark a step of the plan the person started as running or done. It changes on the plan card right away.",
  input_schema: {
    type: "object",
    properties: { step: { type: "integer", description: "The step's number in the plan the person started, from 1." }, status: { type: "string", enum: ["running", "done"] } },
    required: ["step", "status"],
  },
};

export const LOG_PROGRESS_TOOL: Anthropic.Beta.BetaTool = {
  name: "log_progress",
  description:
    "Record where this chat's goal stands and show a progress card. Followers, reach and AI visibility are read from real data on their own; for other goals give the current number in value (for a goal that counts up, the amount gained so far).",
  input_schema: {
    type: "object",
    properties: { value: { type: "number", description: "The current number, when it can't be read from real data." } },
  },
};

/** Card tools for every teammate who can take work. */
export function cardToolSource(deps: CardToolDeps): ToolSource {
  return async (ctx) => {
    if (!workingAgents().includes(ctx.agent)) return { tools: [], missing: [] };
    return { tools: cardTools(ctx, deps), missing: [] };
  };
}

/** The five tools for one teammate in one workspace. */
export function cardTools(ctx: ToolContext, deps: CardToolDeps): AgentTool[] {
  const now = () => deps.now?.() ?? Date.now();
  // A registry is made for one workspace and agent. Never let a tool run for another.
  const guard = (run: (input: Record<string, unknown>, c: ToolContext) => Promise<ToolResult>) => async (input: Record<string, unknown>, c: ToolContext) => {
    if (c.workspace.id !== ctx.workspace.id || c.agent !== ctx.agent) return fail("That tool isn't available.");
    try {
      return await run(input, c);
    } catch (e) {
      deps.log?.(`Card tool for ${c.agent} in workspace ${c.workspace.id} failed: ${why(e)}`);
      return fail("That didn't work. Try again, or answer in words.");
    }
  };
  const shown = (card: Card, extra = ""): ToolResult => ({ content: [CARD_RESULTS[card.kind], extra].filter(Boolean).join(" "), cards: [card] });

  const tool = (definition: Anthropic.Beta.BetaTool, label: string, run: (input: Record<string, unknown>, c: ToolContext) => Promise<ToolResult>): AgentTool => ({ definition, label, quiet: true, run: guard(run) });

  return [
    tool(SHOW_CARD_TOOL, "Showing a card", async (input, c) => {
      const checked = readCard(input, c.agent, { kinds: SHOW_KINDS });
      if (!checked.ok) return fail(`The card wasn't shown. ${checked.error}.`);
      const card = checked.card;
      if (card.kind === "connect" && !connectable(card.app)) return fail(`The card wasn't shown. "${card.app}" isn't an app the business can connect here.`);
      if (card.kind === "post_preview") {
        for (const [i, p] of card.posts.entries()) {
          if (p.approval_id === null) continue;
          const ap = await deps.approval(c.workspace.id, p.approval_id);
          if (!ap || ap.thread_id !== c.threadId) return fail(`The card wasn't shown. posts[${i}]: approval #${p.approval_id} isn't one saved in this chat.`);
          if (ap.product !== "capybaroar" || ap.tool !== "create_posts") return fail(`The card wasn't shown. posts[${i}]: approval #${p.approval_id} isn't a social post.`);
          // What the owner approves is what the card shows: the approval's own words.
          const words = postWords(ap.input, p.index);
          if (words === null) return fail(`The card wasn't shown. posts[${i}]: approval #${p.approval_id} has no post at that place.`);
          card.posts[i] = { ...p, text: words };
        }
      }
      if (card.kind === "email_preview" && card.approval_id !== null) {
        const ap = await deps.approval(c.workspace.id, card.approval_id);
        if (!ap || ap.thread_id !== c.threadId) return fail(`The card wasn't shown. Approval #${card.approval_id} isn't one saved in this chat.`);
        if (groupOf(ap.product) !== "mail") return fail(`The card wasn't shown. Approval #${card.approval_id} isn't an email.`);
        // What the owner approves is what the card shows: the approval's own words where it has them.
        const w = emailWords(ap.input);
        Object.assign(card, { to: w.to ?? card.to, subject: w.subject ?? card.subject, body: w.body ?? card.body });
      }
      // Checked again, so text taken from an approval keeps every rule a card's text follows.
      const again = readCard(card, c.agent);
      return again.ok ? shown(again.card) : fail(`The card wasn't shown. ${again.error}.`);
    }),

    tool(SET_GOAL_TOOL, "Setting a goal", async (input, c) => {
      const owner = input.owner;
      const checked = readCard({ kind: "goal", title: "Goal", note: "Change the number or the date", metric: input.metric, lead: input.lead, target: input.target, unit: input.unit, due: input.due }, c.agent);
      if (!checked.ok || checked.card.kind !== "goal") return fail(`The goal wasn't shown. ${checked.ok ? "" : checked.error}.`);
      const card = checked.card;
      const k = typeof owner === "string" && owner.trim() ? workingAgents().find((a) => AGENTS[a].god.toLowerCase() === owner.trim().toLowerCase()) : c.agent;
      if (!k) return fail(`The goal wasn't shown. owner must be a teammate who can take work, like ${AGENTS[c.agent].god}.`);
      card.agent = k;
      const today = new Date(now()).toISOString().slice(0, 10);
      const twoYears = new Date(now() + 730 * 864e5).toISOString().slice(0, 10);
      if (!isDay(card.due) || card.due <= today || card.due > twoYears) return fail("The goal wasn't shown. due must be after today and within two years.");
      const open = await deps.activeGoal(c.workspace.id, c.threadId);
      if (open) return fail(`This chat already has a goal: ${goalLine(open, now())}. Use log_progress for it, or start a new chat for another goal.`);
      return shown(card);
    }),

    tool(SET_PLAN_TOOL, "Making a plan", async (input, c) => {
      const checked = readCard({ kind: "plan", title: "Plan", note: undefined, steps: input.steps, go: input.go }, c.agent);
      if (!checked.ok || checked.card.kind !== "plan") return fail(`The plan wasn't shown. ${checked.ok ? "" : checked.error}.`);
      const card = checked.card;
      const off = card.steps.find((st) => !workingAgents().includes(st.agent));
      if (off) return fail(`The plan wasn't shown. ${AGENTS[off.agent].god} can't take work right now. Give that step to someone else.`);
      card.note = `${card.steps.length} step${card.steps.length === 1 ? "" : "s"}`;
      return shown(card);
    }),

    tool(UPDATE_STEP_TOOL, "Updating the plan", async (input, c) => {
      const n = Number(input.step);
      const status = input.status === "running" || input.status === "done" ? input.status : null;
      if (!status) return fail("status must be running or done.");
      const steps = await deps.planSteps(c.workspace.id, c.threadId);
      if (!steps.length) return fail("No plan has started in this chat yet. The person taps Go on the plan card first.");
      const st = steps.find((x) => x.position === n);
      if (!st) return fail(`step must be a number from 1 to ${steps.length}.`);
      await deps.setStep(c.workspace.id, st.id, status);
      c.emit({ type: "step", plan: st.plan_id, position: st.position, status });
      return { content: `Step ${st.position} (${st.title}) is ${status}.` };
    }),

    tool(LOG_PROGRESS_TOOL, "Checking progress", async (input, c) => {
      const g = await deps.activeGoal(c.workspace.id, c.threadId);
      if (!g) return fail("There is no goal in this chat. Propose one with set_goal first.");
      const source = METRIC_SOURCE[g.metric];
      const reading = source ? await deps.reading(c.workspace.id, g.metric).catch(() => null) : null;
      const given = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
      if (reading === null && given === null) return fail(source ? "The number couldn't be read from real data right now. Give the current number in value." : "Give the current number in value.");
      const patch = reading !== null ? applyReading(g, reading, { now: now() }) : applyReading(g, given!, { now: now(), raw: false });
      await deps.saveGoal(c.workspace.id, g.id, patch);
      const saved: GoalRow = { ...g, ...patch };
      c.emit({ type: "goal", id: g.id, current: saved.current, status: saved.status });
      const pending = (await deps.pending?.(c.workspace.id, c.threadId).catch(() => 0)) ?? 0;
      const checked = readCard(progressCard(saved, { now: now(), pending }), g.agent);
      const line = `Progress saved: ${goalSentence({ lead: g.title, target: g.target, unit: g.unit, due: g.due_date }, now())}, now at ${saved.current}${reading !== null ? ", read from real data" : ""}.${saved.status === "done" ? " The goal is reached." : ""}`;
      return checked.ok ? { content: `${line} ${CARD_RESULTS.progress}`, cards: [checked.card] } : { content: line };
    }),
  ];
}

