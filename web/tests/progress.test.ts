// The quiet line while a tool runs and the "Used: ..." note (src/lib/progress.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseName, progressLine, targetOf, usedName, usedNote } from "../src/lib/progress.ts";

const product = (name: string, nice: string, label = "SEO and AI visibility") => ({ name: `arrowsterr__${name}`, label: `${label}: ${nice}` });

test("a product tool reads as plain words, with the site it checks", () => {
  assert.equal(progressLine("Theseus", product("domain_overview", "domain overview"), { domain: "katalon.com" }), "Theseus is checking katalon.com");
  assert.equal(progressLine("Theseus", product("domain_overview", "domain overview"), { url: "https://www.katalon.com/" }), "Theseus is checking katalon.com");
  assert.equal(progressLine("Theseus", product("domain_overview", "domain overview"), {}), "Theseus is checking a website");
  assert.equal(progressLine("Theseus", product("keyword_research", "keyword research"), { keywords: ["sourdough", "bread", "rye"] }), 'Theseus is researching keywords for "sourdough, bread"');
  assert.equal(progressLine("Theseus", product("get_ai_visibility", "get ai visibility"), {}), "Theseus is checking AI visibility");
  assert.equal(progressLine("Leo", { name: "capybaroar__create_posts", label: "Social media: create posts" }, { posts: [] }), "Leo is drafting posts");
  assert.equal(progressLine("Alexander", { name: "search_knowledge", label: "Searching Knowledge" }, { query: "refund policy" }), 'Alexander is searching Knowledge for "refund policy"');
});

test("never the raw label: no product name and colon in the line", () => {
  const line = progressLine("Theseus", product("domain_overview", "domain overview"), { domain: "katalon.com" });
  assert.doesNotMatch(line, /SEO and AI visibility|:/);
});

test("labels that already say what happens are used as they are, and unknown tools still read well", () => {
  assert.equal(progressLine("Archon", { name: "wordpress__list_pages", label: "WordPress: reading pages" }), "Archon is reading pages");
  assert.equal(progressLine("Midas", { name: "app_action", label: "Apps: running an action" }), "Midas is running an action");
  assert.equal(progressLine("Alexander", { name: "use_skill", label: "Reading a skill" }), "Alexander is reading a skill");
  assert.equal(progressLine("Theseus", product("brand_audit", "brand audit"), { site: "anasbakery.com/menu" }), "Theseus is checking anasbakery.com/menu");
  assert.equal(progressLine("Theseus", product("brand_audit", "brand audit"), {}), "Theseus is working on brand audit");
});

test("the short name for the Used note", () => {
  assert.equal(usedName(product("domain_overview", "domain overview")), "domain overview");
  assert.equal(usedName(product("get_competitors", "get competitors")), "competitors");
  assert.equal(usedName({ name: "search_knowledge", label: "Searching Knowledge" }), "Knowledge");
  assert.equal(usedName({ name: "wordpress__list_pages", label: "WordPress: reading pages" }), "WordPress");
  assert.equal(usedName({ name: "x", label: "Label x" }), "Label x");
});

test("usedNote lists each tool once, in plain words", () => {
  assert.equal(usedNote([]), null);
  assert.equal(usedNote(["domain overview"]), "Used: domain overview");
  assert.equal(usedNote(["domain overview", "Knowledge", "domain overview"]), "Used: domain overview and Knowledge");
  assert.equal(usedNote(["a", "b", "c"]), "Used: a, b and c");
});

test("targetOf: only plain strings, cut to a short line", () => {
  assert.equal(targetOf(null), null);
  assert.equal(targetOf([1]), null);
  assert.equal(targetOf({ domain: "  " }), null);
  assert.equal(targetOf({ query: "a\nb" }), "a b");
  assert.ok(targetOf({ url: `https://x.com/${"y".repeat(100)}` })!.length <= 60);
  assert.equal(baseName("capybaroar__list_posts"), "list_posts");
});

test("no em dashes in what the lines say", () => {
  const lines = [progressLine("Theseus", product("domain_overview", "domain overview"), { domain: "a.com" }), usedNote(["a", "b"])!];
  for (const l of lines) assert.doesNotMatch(l, /[–—]/);
});
