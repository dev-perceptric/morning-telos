// Use cases: results a business can ask for, each run by one teammate with the business's own apps. The Use cases page
// lists them in groups, Home suggests three by the business's industry, and "Try in chat" starts a chat with the
// use case's starter message (tagging the teammate, and picking its skill the way the composer's / menu does).
// Pure, so the screens and the tests read one list. Every app here is one the app can connect (src/lib/composio/
// catalog.ts) or a social network Aphrodite posts to; tests/useCases.test.ts checks each teammate can use its apps.

import { appName, isAppId } from "./composio/catalog.ts";
import { networkName } from "./socialChannels.ts";
import { AGENTS, type AgentKey } from "./team.ts";

export type UseCaseGroup = "marketing" | "sales" | "service" | "operations" | "website";

/** The page's groups, in its order. */
export const USE_CASE_GROUPS: { id: UseCaseGroup; label: string }[] = [
  { id: "marketing", label: "Marketing" },
  { id: "sales", label: "Sales and leads" },
  { id: "service", label: "Customer service" },
  { id: "operations", label: "Scheduling and operations" },
  { id: "website", label: "Website and search" },
];

/** The social networks Aphrodite posts to, shown as logos on social use cases. */
export const SOCIAL_APPS = ["instagram", "facebook", "linkedin", "tiktok"] as const;
const isSocialApp = (id: string) => (SOCIAL_APPS as readonly string[]).includes(id);

export type UseCase = {
  id: string;
  group: UseCaseGroup;
  title: string;
  /** The teammate who runs it. */
  agent: AgentKey;
  /** Logos on the card: apps the teammate works in for this result. Empty when it needs none. */
  apps: string[];
  /** One line on what it does. */
  line: string;
  /** Three things the owner gets. */
  outcomes: [string, string, string];
  /** What the owner asks, in their own words, after "Start: <title>." */
  ask: string;
  /** A System skill of this teammate (src/skills/<agent>/<skill>), picked like /<skill> in the composer. */
  skill?: string;
};

const MAIL = ["gmail", "outlook"];

export const USE_CASES: UseCase[] = [
  // Marketing
  {
    id: "social-manager",
    group: "marketing",
    title: "Social media manager",
    agent: "social",
    apps: ["instagram", "facebook", "linkedin", "tiktok"],
    line: "Keeps your channels full, on brand and on schedule.",
    outcomes: ["A full calendar every week", "Posts in your voice", "You approve before anything goes out"],
    ask: "Keep my channels full, on brand and on schedule.",
    skill: "plan-weekly-posts",
  },
  {
    id: "content-repurposer",
    group: "marketing",
    title: "Content repurposer",
    agent: "social",
    apps: ["linkedin", "instagram", "facebook"],
    line: "Turns one blog post or piece of news into a week of posts.",
    outcomes: ["Five posts from one article", "Each one sized for its network", "Drafts ready for your OK"],
    ask: "Turn my latest blog post or news into a week of posts.",
    skill: "write-a-post",
  },
  {
    id: "social-analyst",
    group: "marketing",
    title: "Social analyst",
    agent: "social",
    apps: ["instagram", "facebook", "linkedin", "tiktok"],
    line: "Shows what worked on social and what to post more of.",
    outcomes: ["A weekly social report", "Your best posts and why", "Ideas for next week"],
    ask: "Tell me what worked on social lately and what to post more of.",
    skill: "social-report",
  },
  {
    id: "email-newsletter",
    group: "marketing",
    title: "Email newsletter",
    agent: "email",
    apps: MAIL,
    line: "Writes your newsletter and sends it after you approve.",
    outcomes: ["Written from your news", "Sent from your own inbox", "Nothing goes out without your OK"],
    ask: "Write this month's newsletter from our latest news.",
    skill: "write-a-campaign",
  },
  {
    id: "welcome-win-back",
    group: "marketing",
    title: "Welcome and win-back emails",
    agent: "email",
    apps: MAIL,
    line: "Welcomes new customers and brings past ones back.",
    outcomes: ["A welcome series for new customers", "Win-back emails for past ones", "Written in your voice"],
    ask: "Set up welcome emails for new customers and win-back emails for past ones.",
    skill: "welcome-series",
  },
  {
    id: "promotions-planner",
    group: "marketing",
    title: "Promotions planner",
    agent: "email",
    apps: MAIL,
    line: "Plans your sales and offers, and writes the emails for each one.",
    outcomes: ["A calendar of offers", "An email for each offer", "Sent after you approve"],
    ask: "Plan our next promotions and write the emails for them.",
    skill: "write-a-campaign",
  },
  {
    id: "competitor-watch",
    group: "marketing",
    title: "Competitor watch",
    agent: "seo",
    apps: [],
    line: "Tracks what your competitors rank for and where AI names them.",
    outcomes: ["A weekly competitor note", "Keywords they win", "Where AI names them instead of you"],
    ask: "Keep an eye on my competitors and tell me what they win.",
  },
  {
    id: "brand-mentions",
    group: "marketing",
    title: "Brand mentions",
    agent: "seo",
    apps: [],
    line: "Finds where AI answers mention your business and what they say.",
    outcomes: ["Every AI mention found", "The sites AI trusts", "How people see you"],
    ask: "Find where AI answers mention my business and what they say.",
    skill: "check-ai-visibility",
  },
  {
    id: "ad-copy-writer",
    group: "marketing",
    title: "Ad copy writer",
    agent: "web",
    apps: [],
    line: "Writes ad headlines and landing page text that match your site.",
    outcomes: ["Headlines to test", "Text that matches the page", "In your brand voice"],
    ask: "Write ad copy for my best offer, with headlines to test.",
  },

  // Sales and leads
  {
    id: "speed-to-lead",
    group: "sales",
    title: "Speed-to-lead",
    agent: "sales",
    apps: ["gmail", "hubspot", "calendly"],
    line: "Answers every new lead fast, with a link to book a call.",
    outcomes: ["Replies in minutes", "Calls booked for you", "Your CRM kept up to date"],
    ask: "Answer every new lead fast and offer a time to talk.",
    skill: "follow-up-new-leads",
  },
  {
    id: "quote-follow-up",
    group: "sales",
    title: "Quote follow-up",
    agent: "sales",
    apps: ["gmail", "pipedrive"],
    line: "Follows up on every quote until you get a yes or a no.",
    outcomes: ["Follow-ups on day 2, 5 and 10", "Written in your voice", "Stops when they reply"],
    ask: "Follow up on my open quotes until each one gets an answer.",
    skill: "quote-follow-up",
  },
  {
    id: "outreach-drafts",
    group: "sales",
    title: "Outreach drafts",
    agent: "sales",
    apps: ["gmail", "outlook", "hubspot"],
    line: "Writes first emails to the people you want to work with.",
    outcomes: ["A short, personal first email", "Follow-ups ready to go", "You approve each one"],
    ask: "Draft first emails to the people I want to reach.",
  },
  {
    id: "pipeline-clean-up",
    group: "sales",
    title: "Pipeline clean-up",
    agent: "sales",
    apps: ["hubspot", "pipedrive", "salesforce"],
    line: "Keeps your CRM tidy: stages, next steps and deals that need you.",
    outcomes: ["Deals in the right stage", "A next step on each one", "Deals that need you flagged"],
    ask: "Clean up my CRM: stages, next steps and deals that need attention.",
    skill: "update-the-crm",
  },
  {
    id: "meeting-prep",
    group: "sales",
    title: "Meeting prep",
    agent: "sales",
    apps: ["googlecalendar", "hubspot"],
    line: "A short brief before each sales call.",
    outcomes: ["Who they are and what they need", "Past emails in one place", "Questions to ask"],
    ask: "Prep me for my next sales call.",
  },
  {
    id: "call-follow-up",
    group: "sales",
    title: "Call follow-up",
    agent: "sales",
    apps: ["gmail", "hubspot"],
    line: "Writes a recap and next steps after each call.",
    outcomes: ["A recap email drafted", "Next steps saved to your CRM", "Sent after you approve"],
    ask: "Write the follow-up for my last call, with a recap and next steps.",
  },
  {
    id: "pitch-research",
    group: "sales",
    title: "Pitch research",
    agent: "chief",
    apps: [],
    line: "Looks into a business before you pitch it.",
    outcomes: ["What the business does", "What it likely needs", "Three ways to open"],
    ask: "Look into a business I want to pitch and tell me how to open.",
  },

  // Customer service
  {
    id: "inbox-answers",
    group: "service",
    title: "Inbox answers",
    agent: "support",
    apps: MAIL,
    line: "Answers customer emails from what your team knows, after you approve.",
    outcomes: ["Replies in your voice", "Hard ones sent to you", "Nothing sent without your OK"],
    ask: "Answer the customer emails in my inbox.",
    skill: "answer-an-email",
  },
  {
    id: "help-desk",
    group: "service",
    title: "Help desk",
    agent: "support",
    apps: ["zendesk", "help_scout"],
    line: "Sorts your help desk tickets and drafts a reply for each.",
    outcomes: ["Tickets sorted by need", "A draft reply for each", "Urgent ones sent to you first"],
    ask: "Go through my help desk tickets and draft replies.",
    skill: "daily-inbox-triage",
  },
  {
    id: "faq-builder",
    group: "service",
    title: "FAQ builder",
    agent: "support",
    apps: MAIL,
    line: "Turns the questions customers ask into a clear FAQ.",
    outcomes: ["Built from real questions", "Short, clear answers", "Ready to add to your site"],
    ask: "Build an FAQ from the questions customers ask us.",
    skill: "build-an-faq",
  },
  {
    id: "upset-customer-alert",
    group: "service",
    title: "Upset customer alert",
    agent: "support",
    apps: ["gmail", "outlook", "slack"],
    line: "Spots unhappy customers early and tells you right away.",
    outcomes: ["Upset emails caught early", "A calm reply drafted", "You hear about it first"],
    ask: "Watch my inbox for unhappy customers and tell me right away.",
  },
  {
    id: "review-requests",
    group: "service",
    title: "Review requests",
    agent: "email",
    apps: MAIL,
    line: "Asks happy customers for a review after each job.",
    outcomes: ["Sent after each job", "A one-tap review link", "More reviews over time"],
    ask: "Ask my happy customers for a review after each job.",
  },

  // Scheduling and operations
  {
    id: "booking-assistant",
    group: "operations",
    title: "Booking assistant",
    agent: "forms",
    apps: ["googlecalendar", "calendly"],
    line: "Finds open times, books meetings and sends invites.",
    outcomes: ["No double bookings", "Invites sent after you approve", "Times that suit you"],
    ask: "Help me book meetings at times that work for me.",
    skill: "book-a-meeting",
  },
  {
    id: "reminders-no-shows",
    group: "operations",
    title: "Reminders and no-shows",
    agent: "forms",
    apps: ["googlecalendar", "gmail"],
    line: "Sends a reminder before each booking, so fewer people miss one.",
    outcomes: ["A reminder before each visit", "An easy way to rebook", "Fewer missed bookings"],
    ask: "Send reminders before each booking and help people who miss one rebook.",
    skill: "reminder-emails",
  },
  {
    id: "my-week",
    group: "operations",
    title: "My week",
    agent: "forms",
    apps: ["googlecalendar"],
    line: "Your week on one page: meetings, free time and what to move.",
    outcomes: ["Every meeting in one view", "Free time found", "Clashes flagged"],
    ask: "Show me my week and what I should move.",
    skill: "weekly-schedule",
  },
  {
    id: "form-follow-up",
    group: "operations",
    title: "Form follow-up",
    agent: "forms",
    apps: MAIL,
    line: "Replies to each form someone fills in on your site.",
    outcomes: ["A reply to every form", "A link to book a time", "Sent after you approve"],
    ask: "Follow up on the forms people fill in on my website.",
  },
  {
    id: "morning-brief",
    group: "operations",
    title: "Morning brief",
    agent: "chief",
    apps: ["gmail", "googlecalendar", "slack"],
    line: "What happened overnight and what needs you today.",
    outcomes: ["One page each morning", "What needs you first", "Approvals in one place"],
    ask: "Give me my morning brief: what happened and what needs me today.",
  },
  {
    id: "weekly-report",
    group: "operations",
    title: "Weekly business report",
    agent: "chief",
    apps: ["hubspot", "gmail", "googlecalendar"],
    line: "Leads, bookings and traffic on one page each week.",
    outcomes: ["Every Monday", "Change from last week", "Why the numbers moved"],
    ask: "Give me a weekly report on how the business is doing.",
    skill: "weekly-report",
  },
  {
    id: "hand-off-desk",
    group: "operations",
    title: "Hand-off desk",
    agent: "chief",
    apps: [],
    line: "Tell Athena the job, and she hands it to the right teammate.",
    outcomes: ["One place to ask", "The right teammate on it", "You see who does what"],
    ask: "I have a few jobs for the team. Hand each one to the right teammate.",
  },

  // Website and search
  {
    id: "ai-visibility",
    group: "website",
    title: "AI visibility tracker",
    agent: "seo",
    apps: [],
    line: "How often ChatGPT and Google AI name your business.",
    outcomes: ["A weekly AI report", "Who AI names instead", "Fixes to get named"],
    ask: "Check how often AI answers name my business.",
    skill: "check-ai-visibility",
  },
  {
    id: "seo-specialist",
    group: "website",
    title: "SEO specialist",
    agent: "seo",
    apps: [],
    line: "Finds what people search for and how you can rank for it.",
    outcomes: ["Keywords worth winning", "How hard each one is", "A short list to act on"],
    ask: "Find the keywords I should rank for.",
    skill: "find-keywords",
  },
  {
    id: "competitor-traffic",
    group: "website",
    title: "Competitor traffic check",
    agent: "seo",
    apps: [],
    line: "Any site's traffic and best keywords, next to yours.",
    outcomes: ["Monthly visits", "Top keywords", "Where you can win"],
    ask: "Check a competitor's traffic and best keywords, and compare them with mine.",
  },
  {
    id: "content-plan",
    group: "website",
    title: "Content plan",
    agent: "seo",
    apps: [],
    line: "A plan of posts and pages to write, in the right order.",
    outcomes: ["Topics people search for", "What to write first", "Handed to your writer"],
    ask: "Make a content plan for my website.",
    skill: "plan-content",
  },
  {
    id: "page-writer",
    group: "website",
    title: "Page writer",
    agent: "web",
    apps: ["wordpress", "shopify", "framer", "webflow"],
    line: "Writes pages in your brand style and saves them as drafts.",
    outcomes: ["Built for real searches", "A preview before it goes live", "Clear ways to book or buy"],
    ask: "Write a new page for my website.",
    skill: "write-a-page",
  },
  {
    id: "website-checkup",
    group: "website",
    title: "Website checkup",
    agent: "web",
    apps: [],
    line: "Looks over your site and lists what to fix first.",
    outcomes: ["What works and what doesn't", "Fixes in order", "Quick wins first"],
    ask: "Check my website and tell me what to fix first.",
    skill: "review-the-design",
  },
  {
    id: "page-fixer",
    group: "website",
    title: "Page fixer",
    agent: "web",
    apps: ["wordpress", "shopify", "framer", "webflow"],
    line: "Improves a page you already have and saves the change as a draft.",
    outcomes: ["Clearer words", "Better for search", "Nothing changes until you approve"],
    ask: "Improve one of the pages on my website.",
    skill: "improve-a-page",
  },
];

const BY_ID: Readonly<Record<string, UseCase>> = Object.fromEntries(USE_CASES.map((u) => [u.id, u]));
export const findUseCase = (id: string): UseCase | undefined => (Object.hasOwn(BY_ID, id) ? BY_ID[id] : undefined);

/** An app the use case cards can show: one the app connects, or a social network Aphrodite posts to. */
export const isUseCaseApp = (id: string) => isAppId(id) || isSocialApp(id);
/** The app's name, for the logo's label. */
export const caseAppName = (id: string) => (isSocialApp(id) ? networkName(id) : appName(id));

/** The use cases in one group, or all of them in the page's order. */
export function casesIn(group: UseCaseGroup | null): UseCase[] {
  return group ? USE_CASES.filter((u) => u.group === group) : USE_CASES;
}

/**
 * The first message of the chat "Try in chat" starts: the teammate tagged, their skill picked the way the composer's
 * / menu writes it, then the result asked for. Like "@Aphrodite /plan-weekly-posts Start: Social media manager. Keep
 * my channels full, on brand and on schedule."
 */
export function starterMessage(u: UseCase): string {
  const skill = u.skill ? ` /${u.skill}` : "";
  return `@${AGENTS[u.agent].god}${skill} Start: ${u.title}. ${u.ask}`;
}

// ─────────────── Suggested for you ───────────────

export type Industry =
  | "clinics"
  | "home-services"
  | "real-estate"
  | "law"
  | "ecommerce"
  | "accounting"
  | "fitness"
  | "logistics"
  | "insurance"
  | "recruiting"
  | "saas"
  | "agencies";

/** Three use cases for each kind of business, best first. */
export const STARTER_PACKS: Record<Industry, [string, string, string]> = {
  clinics: ["reminders-no-shows", "review-requests", "inbox-answers"],
  "home-services": ["speed-to-lead", "quote-follow-up", "review-requests"],
  "real-estate": ["speed-to-lead", "social-manager", "meeting-prep"],
  law: ["speed-to-lead", "booking-assistant", "page-writer"],
  ecommerce: ["welcome-win-back", "social-manager", "inbox-answers"],
  accounting: ["inbox-answers", "booking-assistant", "email-newsletter"],
  fitness: ["social-manager", "review-requests", "welcome-win-back"],
  logistics: ["quote-follow-up", "inbox-answers", "weekly-report"],
  insurance: ["speed-to-lead", "quote-follow-up", "review-requests"],
  recruiting: ["outreach-drafts", "inbox-answers", "weekly-report"],
  saas: ["ai-visibility", "content-repurposer", "competitor-watch"],
  agencies: ["social-manager", "ai-visibility", "weekly-report"],
};

/** For a business whose kind we can't tell. */
export const DEFAULT_PACK: [string, string, string] = ["social-manager", "morning-brief", "ai-visibility"];

// Words a business's own description uses, for each kind. Checked in this order, so a tie goes to the more specific
// kind ("insurance agency" is insurance, not an agency).
const INDUSTRY_WORDS: [Industry, RegExp][] = [
  ["clinics", /\b(clinics?|dental|dentists?|dentistry|medical|physio\w*|chiropract\w*|patients?|doctors?|health ?care|veterinar\w*|med ?spa|orthodont\w*)\b/g],
  ["home-services", /\b(plumb\w*|hvac|roof\w*|electricians?|landscap\w*|cleaning|contractors?|handyman|pest control|remodel\w*|painting|movers?|moving company)\b/g],
  ["real-estate", /\b(real estate|realtors?|homes? for sale|propert(y|ies)|brokerage|listings?|home buyers?)\b/g],
  ["law", /\b(law firm|attorneys?|lawyers?|legal (services|advice|help)|litigation|paralegals?)\b/g],
  ["ecommerce", /\b(online store|online shop|e-?commerce|free shipping|shop now|add to cart|our store)\b/g],
  ["accounting", /\b(accounting|accountants?|bookkeep\w*|tax (returns?|prep\w*|filing|planning)|cpas?|payroll)\b/g],
  ["fitness", /\b(gyms?|fitness|yoga|pilates|personal train\w*|crossfit|workouts?|martial arts)\b/g],
  ["logistics", /\b(logistics|freight|trucking|couriers?|warehous\w*|shipping company|supply chain|3pl)\b/g],
  ["insurance", /\b(insurance|insurers?|policyholders?|coverage)\b/g],
  ["recruiting", /\b(recruit\w*|staffing|headhunt\w*|talent acquisition|job seekers?)\b/g],
  ["saas", /\b(saas|software|web app|platform for|apis?)\b/g],
  ["agencies", /\b(agency|agencies|marketing studio|design studio|creative studio)\b/g],
];

/** The kind of business its own words describe (the About doc from its website), or null when we can't tell. */
export function industryOf(text: string | null | undefined): Industry | null {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return null;
  let best: Industry | null = null;
  let most = 0;
  for (const [k, re] of INDUSTRY_WORDS) {
    const n = t.match(re)?.length ?? 0;
    if (n > most) {
      best = k;
      most = n;
    }
  }
  return best;
}

/** Home's three suggestions for the business. */
export function suggestedUseCases(industry: Industry | null): UseCase[] {
  return (industry ? STARTER_PACKS[industry] : DEFAULT_PACK).map((id) => findUseCase(id)).filter((u): u is UseCase => Boolean(u));
}
