// What the chat says while a teammate's tool runs, in plain words: "Theseus is checking katalon.com" instead of
// "SEO and AI visibility: domain overview". And the short name that goes in the "Used: ..." note under the answer.
// Pure, so the agent loop and the tests share it. Tool names come from src/lib/productTools.ts (product__tool), the
// Morning Telos tools (search_knowledge, use_skill, remember) and the WordPress and Apps tools, whose labels already
// read "WordPress: reading pages".

/** The tool as the loop knows it: its API name and the label it was given. */
export type ToolFace = { name: string; label: string };

// What each product tool does, as words after "<Teammate> is ...". {t} is the site, keyword or search when the input
// has one; the words after | are used when it doesn't. Tool names from tests/fixtures/product-tools.json.
const VERBS: Record<string, string> = {
  domain_overview: "checking {t}|checking a website",
  keyword_research: 'researching keywords for "{t}"|researching keywords',
  get_ai_visibility: "checking AI visibility for {t}|checking AI visibility",
  get_visibility_trend: "checking the AI visibility trend",
  get_brand_presence: "checking where {t} shows up|checking where the brand shows up",
  get_prompts: "reading the AI questions we track",
  get_prompt_answers: "reading AI answers",
  add_prompts: "adding AI questions to track",
  get_competitors: "looking at competitors",
  get_cited_sources: "checking which sites AI answers cite",
  get_ai_crawlers: "checking which AI crawlers visit the site",
  get_content_plan: "reading the content plan",
  get_topic_bank: "looking for topics to write about",
  add_to_content_plan: "adding to the content plan",
  update_content_plan: "updating the content plan",
  remove_from_content_plan: "updating the content plan",
  list_brands: "looking up your brands",
  list_channels: "checking your social channels",
  list_channel_groups: "checking your social channels",
  list_campaigns: "looking at your campaigns",
  list_posts: "looking at your posts",
  get_post: "reading a post",
  create_posts: "drafting posts",
  update_post: "updating a post",
  delete_post: "removing a post",
  list_media: "looking at your images",
  upload_media: "adding an image",
  generate_media: "making an image",
  get_generation: "checking on an image",
  get_credits: "checking your credits",
  next_queue_slot: "finding the next open time to post",
  get_analytics: "reading your social results",
  list_webhooks: "checking your webhooks",
  create_webhook: "setting up a webhook",
  set_webhook: "setting up a webhook",
  test_webhook: "testing a webhook",
  delete_webhook: "removing a webhook",
  search_knowledge: 'searching Knowledge for "{t}"|searching Knowledge',
  use_skill: "reading a skill",
  remember: "saving this to memory",
};

/** Short names for the "Used: ..." note, for tools whose label is a sentence. */
const USED: Record<string, string> = { search_knowledge: "Knowledge", use_skill: "a skill", remember: "Memory" };

/** Input fields that name what a tool looks at, in the order they are tried. */
const TARGET_KEYS = ["domain", "url", "website", "site", "target", "query", "q", "keyword", "keywords", "topic", "brand"];

/** The tool's own name, without the product in front ("arrowsterr__domain_overview" is "domain_overview"). */
export const baseName = (name: string) => name.replace(/^[a-z]+__/, "");

/** A web address as a person writes it: "https://www.katalon.com/pricing" is "katalon.com/pricing". */
function cleanTarget(v: string): string {
  const one = v.replace(/\s+/g, " ").trim();
  const site = one.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return site.length > 60 ? `${site.slice(0, 57).trimEnd()}...` : site;
}

/** What the tool is looking at, from its input: a site, a keyword or a search. Null when the input names none. */
export function targetOf(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  for (const k of TARGET_KEYS) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return cleanTarget(v);
    if (Array.isArray(v)) {
      const words = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 2);
      if (words.length) return cleanTarget(words.join(", "));
    }
  }
  return null;
}

/** The part of a label after "Product: ", or the whole label. */
const afterColon = (label: string) => {
  const at = label.indexOf(":");
  return at >= 0 ? label.slice(at + 1).trim() : label.trim();
};
const startsWithVerb = (s: string) => /^[a-z]+ing\b/i.test(s);

/** The quiet line while a tool runs, like "Theseus is checking katalon.com". */
export function progressLine(god: string, tool: ToolFace, input?: unknown): string {
  const verb = VERBS[baseName(tool.name)];
  if (verb) {
    const [withT, without = withT] = verb.split("|");
    const t = targetOf(input);
    return `${god} is ${t && withT.includes("{t}") ? withT.replace("{t}", t) : without}`;
  }
  // Labels that already say what happens ("WordPress: reading pages", "Apps: running an action").
  const rest = afterColon(tool.label);
  if (startsWithVerb(rest)) return `${god} is ${rest[0].toLowerCase()}${rest.slice(1)}`;
  const thing = usedName(tool);
  const t = targetOf(input);
  return t ? `${god} is checking ${t}` : `${god} is working on ${thing}`;
}

/** The short name in "Used: domain overview" under the answer. */
export function usedName(tool: ToolFace): string {
  const base = baseName(tool.name);
  if (USED[base]) return USED[base];
  const at = tool.label.indexOf(":");
  if (at >= 0) {
    const rest = afterColon(tool.label);
    // "WordPress: reading pages" was WordPress. "SEO and AI visibility: domain overview" was the domain overview.
    if (startsWithVerb(rest)) return tool.label.slice(0, at).trim();
    return rest.replace(/^(get|list)\s+/i, "").toLowerCase() || base.replace(/_/g, " ");
  }
  return tool.label.trim() || base.replace(/_/g, " ");
}

/** The note under an answer: "Used: domain overview and keyword research". Null when no tool ran. */
export function usedNote(names: readonly string[]): string | null {
  const u = [...new Set(names.filter(Boolean))];
  if (!u.length) return null;
  const list = u.length < 3 ? u.join(" and ") : `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
  return `Used: ${list}`;
}
