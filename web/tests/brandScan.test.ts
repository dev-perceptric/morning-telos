// Learning the brand during the website scan and in the one-time learn_brand job (src/lib/brandScan.ts,
// src/lib/siteScan.ts), and reading stylesheets safely (fetchCss in src/lib/siteScanDb.ts). Fixture pages and fakes
// only: nothing reaches a website, Supabase or Anthropic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FoundBrand } from "../src/lib/brand.ts";
import { CSS_MAX_BYTES, fetchCss, findBrand, learnBrand, learnBrandJob, voiceFromAbout, type BrandDeps, type LearnJobDeps } from "../src/lib/brandScan.ts";
import type { Answer, Page } from "../src/lib/siteFetch.ts";
import { parseTone, scanWebsite, SCAN_MODEL, type AskClaude, type ScanDeps } from "../src/lib/siteScan.ts";

const WS = "11111111-2222-4333-8444-555555555555";
const BAKERY = readFileSync(new URL("./fixtures/brand/bakery.html", import.meta.url), "utf8");
const SITE_CSS = readFileSync(new URL("./fixtures/brand/site.css", import.meta.url), "utf8");
const HOME = "https://anasbakery.example/";

const page = (html: string, url = HOME): Page => ({ ok: true, url, status: 200, html, cut: false });
const cssAt = (sheets: Record<string, string>, calls: string[] = []) => async (url: string) => {
  calls.push(url);
  if (!(url in sheets)) throw new Error("not found");
  return sheets[url];
};

function brandDeps(o: Partial<BrandDeps> & { saved?: (FoundBrand | null)[]; warned?: string[]; source?: "website" | "manual" | null } = {}): BrandDeps {
  const saved = o.saved ?? [];
  const warned = o.warned ?? [];
  return {
    fetchCss: cssAt({ "https://anasbakery.example/assets/site.css": SITE_CSS }),
    current: async () => o.source ?? null,
    save: async (b) => void saved.push(b),
    warn: (m) => void warned.push(m),
    ...o,
  };
}

test("findBrand: reads the home page and at most 4 stylesheets; a stylesheet that fails is skipped", async () => {
  const calls: string[] = [];
  const b = await findBrand(BAKERY, HOME, null, cssAt({ "https://anasbakery.example/assets/site.css": SITE_CSS }, calls));
  assert.deepEqual(calls, ["https://anasbakery.example/assets/site.css", "https://cdn.example/theme.css"]);
  assert.equal(b?.primary, "#b5462b");
  assert.equal(b?.accent, "#2f7d6d");
  // No tone from Claude: the rule-based guess from the page's words.
  assert.equal(b?.tone, "warm and simple");
  const many = `<html><head>${Array.from({ length: 8 }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join("")}</head><body></body></html>`;
  const seen: string[] = [];
  await findBrand(many, HOME, null, cssAt({}, seen));
  assert.equal(seen.length, 4);
});

test("learnBrand: saves what it finds, removes a stale website brand when the site shows none, keeps a brand people changed", async () => {
  const saved: (FoundBrand | null)[] = [];
  assert.equal(await learnBrand(WS, { html: BAKERY, url: HOME }, "Warm and simple", brandDeps({ saved })), "saved");
  assert.equal(saved[0]?.tone, "warm and simple");
  assert.equal(saved[0]?.headingFont, "Playfair Display");

  const none: (FoundBrand | null)[] = [];
  assert.equal(await learnBrand(WS, { html: "<html><body><p>Hi</p></body></html>", url: HOME }, null, brandDeps({ saved: none, source: "website" })), "none");
  assert.deepEqual(none, [null]);

  const kept: (FoundBrand | null)[] = [];
  assert.equal(await learnBrand(WS, { html: BAKERY, url: HOME }, null, brandDeps({ saved: kept, source: "manual" })), "kept");
  assert.deepEqual(kept, []);
});

test("learnBrand never throws: a failure only tells staff", async () => {
  const warned: string[] = [];
  const r = await learnBrand(WS, { html: BAKERY, url: HOME }, null, brandDeps({ warned, save: async () => Promise.reject(new Error("Run supabase/021_brand.sql in Supabase.")) }));
  assert.equal(r, "failed");
  assert.match(warned[0], /Brand for workspace .* wasn't learned: Run supabase\/021_brand\.sql/);
});

// ─────────────── inside the website scan ───────────────

function scanDeps(o: Partial<ScanDeps> = {}): ScanDeps {
  return {
    workspaceId: WS,
    workspace: async () => ({ name: "Ana's Bakery", website: "anasbakery.example" }),
    fetchPage: async (url) => (url === HOME ? page(BAKERY) : { ok: false, url, status: 404, error: "404", retryable: false }),
    claude: null,
    save: async () => {},
    meter: async () => {},
    warn: () => {},
    attempt: 1,
    maxAttempts: 3,
    ...o,
  };
}

const ABOUT = { sell: "Bread.", customers: "", area: "Hanoi.", voice: "Warm and simple.", prices: "", contact: "" };

test("the website scan learns the brand too, with the tone from Claude's answer", async () => {
  const saved: (FoundBrand | null)[] = [];
  const claude: AskClaude = async () => ({ text: JSON.stringify({ ...ABOUT, tone: "Cheerful and homely" }), stopReason: "end_turn", model: SCAN_MODEL, usage: { input_tokens: 10, output_tokens: 10 } });
  assert.deepEqual(await scanWebsite(scanDeps({ claude, brand: brandDeps({ saved }) })), { status: "done" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.primary, "#b5462b");
  assert.equal(saved[0]?.tone, "cheerful and homely");
});

test("the website scan: no Claude key still learns the brand with a guessed tone; a brand that fails never fails the scan", async () => {
  const saved: (FoundBrand | null)[] = [];
  assert.deepEqual(await scanWebsite(scanDeps({ brand: brandDeps({ saved }) })), { status: "done" });
  assert.equal(saved[0]?.tone, "warm and simple");
  const broken = brandDeps({ current: async () => Promise.reject(new Error("no table")) });
  assert.deepEqual(await scanWebsite(scanDeps({ brand: broken })), { status: "done" });
  // Without brand deps the scan works as before.
  assert.deepEqual(await scanWebsite(scanDeps()), { status: "done" });
});

test("the website scan doesn't touch the brand when the site can't be read", async () => {
  const saved: (FoundBrand | null)[] = [];
  const r = await scanWebsite(scanDeps({ fetchPage: async (url) => ({ ok: false, url, status: 503, error: "busy", retryable: true }), brand: brandDeps({ saved }) }));
  assert.equal(r.status, "retry");
  assert.deepEqual(saved, []);
});

test("parseTone: the tone in Claude's JSON, cleaned", () => {
  assert.equal(parseTone(JSON.stringify({ tone: "Warm — friendly." })), "warm, friendly");
  assert.equal(parseTone(JSON.stringify({ tone: "" })), null);
  assert.equal(parseTone("nope"), null);
  assert.equal(parseTone("[1]"), null);
});

// ─────────────── the one-time job for older workspaces ───────────────

function jobDeps(o: Partial<LearnJobDeps> & { saved?: (FoundBrand | null)[]; fetched?: string[] } = {}): LearnJobDeps {
  const fetched = o.fetched ?? [];
  return {
    ...brandDeps({ saved: o.saved }),
    workspaceId: WS,
    workspace: async () => ({ website: "anasbakery.example" }),
    fetchPage: async (url) => {
      fetched.push(url);
      return page(BAKERY, url);
    },
    aboutDoc: async () => "Ana's Bakery.\n\nWhat we sell: Bread.\n\nHow we sound: Warm and casual. We talk like a neighbor.\n\nPrices:",
    ...o,
  };
}

test("learn_brand: reads only the home page, takes the tone from the About doc, and saves", async () => {
  const saved: (FoundBrand | null)[] = [];
  const fetched: string[] = [];
  assert.deepEqual(await learnBrandJob(jobDeps({ saved, fetched })), { status: "done" });
  assert.deepEqual(fetched, [HOME]);
  assert.equal(saved[0]?.tone, "warm and casual");
});

test("learn_brand: nothing to do without a website or with a brand already saved; a site that fails is one try only", async () => {
  for (const o of [{ workspaceId: null }, { workspace: async () => ({ website: null }) }, { workspace: async () => null }, { current: async () => "website" as const }]) {
    const fetched: string[] = [];
    assert.deepEqual(await learnBrandJob(jobDeps({ ...o, fetched })), { status: "done" });
    assert.deepEqual(fetched, []);
  }
  const warned: string[] = [];
  const r = await learnBrandJob(jobDeps({ warn: (m) => void warned.push(m), fetchPage: async (url) => ({ ok: false, url, status: 0, error: "The website took too long to answer.", retryable: true }) }));
  assert.deepEqual(r, { status: "done" });
  assert.match(warned[0], /took too long/);
});

test("voiceFromAbout: the first sentence of the How we sound line", () => {
  assert.equal(voiceFromAbout("x\n\nHow we sound: Warm and casual. We talk like a neighbor.\n\ny"), "Warm and casual");
  assert.equal(voiceFromAbout("How we sound:\n\nPrices: $5"), null);
  assert.equal(voiceFromAbout(null), null);
});

// ─────────────── stylesheets through the safe fetch ───────────────

test("fetchCss: css only, through safeRequest with redirects followed and a size cap; anything else is empty", async () => {
  const asked: { url: string; o: Record<string, unknown> }[] = [];
  const answer = (a: Partial<Answer>): Answer => ({ reached: true, url: "u", status: 200, type: "text/css", body: Buffer.from("a{color:red}"), cut: false, location: null, ...a }) as Answer;
  const req = (a: Answer) => (async (url: string, o: Record<string, unknown>) => {
    asked.push({ url, o });
    return a;
  }) as never;
  assert.equal(await fetchCss("https://a.example/s.css", req(answer({}))), "a{color:red}");
  assert.equal(asked[0].o.follow, true);
  assert.equal(asked[0].o.maxBytes, CSS_MAX_BYTES);
  assert.equal(await fetchCss("https://a.example/s.css", req(answer({ type: "text/html" }))), "");
  assert.equal(await fetchCss("https://a.example/s.css", req(answer({ status: 404 }))), "");
  assert.equal(await fetchCss("https://a.example/s.css", req({ reached: false, url: "u", status: 0, error: "private", retryable: false })), "");
});
