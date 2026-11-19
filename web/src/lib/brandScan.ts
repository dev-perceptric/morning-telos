// Learning the brand from the website (supabase/021_brand.sql), as part of the website scan (src/lib/siteScan.ts)
// and as the one-time learn_brand job for workspaces made before brands existed. Omniscient's scanBrand
// (src/lib/experiences/brandScan.ts) does the same: the home page, up to 4 of its stylesheets, then colors, fonts and
// the logo from them. The tone comes from the scan's Claude answer when there is one, and a rule-based guess otherwise.
// A brand that can't be learned never fails a scan: it only tells staff. Pure apart from what it is handed.
import { brandFrom, guessTone, type FoundBrand } from "./brand.ts";
import { readLook } from "./brandLook.ts";
import type { JobResult } from "./jobs.ts";
import { safeRequest, type Page } from "./siteFetch.ts";
import { siteUrl } from "./siteScan.ts";

/** Most stylesheets read for one brand. */
export const MAX_SHEETS = 4;

export type BrandDeps = {
  /** A stylesheet's text, read with the safe fetch (public internet only). "" when it can't be read. */
  fetchCss: (url: string) => Promise<string>;
  /** The saved brand's source, or null when there is none. A brand people changed ("manual") is kept. */
  current: () => Promise<"website" | "manual" | null>;
  /** Saves what the scan found as the website's brand. null removes an old website brand: the site shows none now. */
  save: (brand: FoundBrand | null) => Promise<void>;
  warn: (message: string) => void;
};

/** Most bytes read from one stylesheet. */
export const CSS_MAX_BYTES = 512 * 1024;

/**
 * A stylesheet's text, read by our server through the safe fetch (https, public internet only, checked on the IP it
 * connects to, 10 seconds, 512 KB). "" when it can't be read or isn't CSS. The app itself never loads it.
 */
export async function fetchCss(url: string, request: typeof safeRequest = safeRequest): Promise<string> {
  const r = await request(url, { follow: true, maxBytes: CSS_MAX_BYTES, timeoutMs: 10_000, headers: { Accept: "text/css,*/*;q=0.1" } });
  if (!r.reached || r.status >= 400 || (r.type && !/css|text\/plain/.test(r.type))) return "";
  return r.body.toString("utf8");
}

/** The brand on a home page's HTML and its stylesheets. Never throws: a stylesheet that fails is skipped. */
export async function findBrand(html: string, url: string, tone: string | null, fetchCss: BrandDeps["fetchCss"]): Promise<FoundBrand | null> {
  const look = readLook(html, url);
  const sheets = await Promise.all(look.stylesheets.slice(0, MAX_SHEETS).map((s) => fetchCss(s).catch(() => "")));
  return brandFrom(look, sheets, tone ?? guessTone(look.text));
}

/** Learn and save the brand. Returns what was saved ("kept" when people changed it). Never throws. */
export async function learnBrand(workspaceId: string, home: { html: string; url: string }, tone: string | null, d: BrandDeps): Promise<"saved" | "none" | "kept" | "failed"> {
  try {
    if ((await d.current()) === "manual") return "kept";
    const found = await findBrand(home.html, home.url, tone, d.fetchCss);
    await d.save(found);
    return found ? "saved" : "none";
  } catch (e) {
    d.warn(`Brand for workspace ${workspaceId} wasn't learned: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}

/** The tone line in an About doc ("How we sound: ..."), for workspaces scanned before brands existed. */
export function voiceFromAbout(body: string | null | undefined): string | null {
  const m = String(body ?? "").match(/^How we sound:[ \t]*(.+)$/m);
  if (!m) return null;
  // The first sentence is enough: "Warm and casual. We talk like a neighbor." becomes "warm and casual".
  return m[1].split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "").trim() || null;
}

export type LearnJobDeps = BrandDeps & {
  workspaceId: string | null;
  workspace: () => Promise<{ website: string | null } | null>;
  fetchPage: (url: string) => Promise<Page>;
  /** The About doc's text from the last website scan, or null. */
  aboutDoc: () => Promise<string | null>;
};

/**
 * The learn_brand job: one try per workspace that had a website before 021_brand.sql. Only the home page and its
 * stylesheets are read, with no Claude call, and Knowledge isn't touched. A brand already saved is left alone.
 * It never retries: the next website scan learns the brand anyway.
 */
export async function learnBrandJob(d: LearnJobDeps): Promise<JobResult> {
  if (!d.workspaceId) return { status: "done" };
  const ws = await d.workspace();
  const home = siteUrl(ws?.website);
  if (!home) return { status: "done" };
  if ((await d.current()) !== null) return { status: "done" };
  const page = await d.fetchPage(home);
  if (!page.ok) {
    d.warn(`Brand for workspace ${d.workspaceId} wasn't learned: ${page.error}`);
    return { status: "done" };
  }
  const tone = voiceFromAbout(await d.aboutDoc().catch(() => null));
  await learnBrand(d.workspaceId, { html: page.html, url: page.url }, tone, d);
  return { status: "done" };
}
