// Product analytics with PostHog, copied from Arrowsterr's src/lib/analytics.ts: who uses which part of Morning
// Telos, grouped by workspace. Off until NEXT_PUBLIC_POSTHOG_KEY is set. It is read at build time, so it is a repo
// variable passed to the image build (.github/workflows/build-images.yml). Off also for people whose browser asks
// not to be tracked (Do Not Track or Global Privacy Control).
//
// When it's off, posthog-js is never loaded: it is imported only after the checks pass. Events go through /ingest
// on our own address (next.config.ts rewrites), so ad blockers don't drop them and no other host is called.
// People are known by their user id only, never their email or name. No session replays, no autocapture, and URLs
// lose their query, hash and invite tokens before they leave the browser.
import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";

/** The events we count, named object_verb in the past tense. */
export type EventName = "signed_up" | "trial_started" | "first_chat_sent" | "approval_decided" | "plan_chosen";
export type EventProps = Record<string, string | number | boolean | null | undefined>;

// ─────────────── pure parts (tests/analytics.test.ts) ───────────────

export type Privacy = { doNotTrack?: string | null; windowDoNotTrack?: string | null; globalPrivacyControl?: boolean };

/** True when analytics may run: a key was set at build time and the browser didn't ask us not to track. */
export function analyticsOn(key: string | null | undefined, p: Privacy = {}): boolean {
  if (!key?.trim()) return false;
  if (p.doNotTrack === "1" || p.doNotTrack === "yes" || p.windowDoNotTrack === "1" || p.globalPrivacyControl === true) return false;
  return true;
}

/** The group every event belongs to: the workspace on screen. Null for no workspace. */
export function workspaceGroup(workspaceId: string | null | undefined): { type: "workspace"; key: string } | null {
  const key = workspaceId?.trim();
  return key ? { type: "workspace", key } : null;
}

/** A URL with no query, hash or invite token, so sign-in codes and invite links never reach PostHog. */
export function cleanUrl(url: unknown): unknown {
  if (typeof url !== "string" || !url) return url;
  // Not a URL, like PostHog's "$direct" referrer.
  if (!url.startsWith("/") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url, "https://x.invalid");
    const path = u.pathname.replace(/^\/invite\/[^/]+/, "/invite/:token");
    return url.startsWith("/") ? path : `${u.origin}${path}`;
  } catch {
    return "";
  }
}

const URL_KEYS = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer", "$pathname", "$initial_pathname", "$prev_pageview_pathname"];
type Bag = Record<string, unknown> | undefined;
const scrubBag = (b: Bag) => {
  if (!b) return b;
  const out = { ...b };
  for (const k of URL_KEYS) if (k in out) out[k] = cleanUrl(out[k]);
  return out;
};

/** before_send: clean every URL an event carries. */
export function scrubEvent(cr: CaptureResult | null): CaptureResult | null {
  if (!cr) return cr;
  return { ...cr, properties: scrubBag(cr.properties) as CaptureResult["properties"], $set: scrubBag(cr.$set), $set_once: scrubBag(cr.$set_once) };
}

/** PostHog's settings. Everything that could record what people type or see is off. */
export function posthogConfig(): Partial<PostHogConfig> {
  return {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    person_profiles: "identified_only",
    // Page views are sent on each route change by the app (usePageViews), with clean URLs.
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    respect_dnt: true,
    before_send: scrubEvent,
  };
}

/** True when a moment was less than `ms` ago, for "just signed up" and "workspace just made". */
export function isRecent(iso: string | null | undefined, now: number, ms = 864e5): boolean {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && at <= now + 60_000 && now - at < ms;
}

// ─────────────── the browser ───────────────

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
let client: Promise<PostHog | null> | null = null;

function privacy(): Privacy {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return { doNotTrack: nav.doNotTrack, windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack ?? null, globalPrivacyControl: nav.globalPrivacyControl };
}

/** Start PostHog. Called once from instrumentation-client.ts. Does nothing when it's off. */
export function startAnalytics() {
  if (client || typeof window === "undefined" || !analyticsOn(KEY, privacy())) return;
  client = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, posthogConfig());
      return posthog;
    })
    .catch(() => null);
}

const withPosthog = (fn: (p: PostHog) => void) => {
  client?.then((p) => p && fn(p)).catch(() => undefined);
};

/** The signed-in person, by user id only. */
export const identify = (userId: string) => withPosthog((p) => p.identify(userId));

/** The workspace on screen, so usage reads per team as well as per person. */
export function inWorkspace(workspaceId: string, props: { plan?: string } = {}) {
  const g = workspaceGroup(workspaceId);
  if (g) withPosthog((p) => p.group(g.type, g.key, props));
}

/** Something worth counting. */
export const track = (event: EventName, props: EventProps = {}) => withPosthog((p) => p.capture(event, props));

/** One page view, for the page in the address bar. */
export const pageView = () => withPosthog((p) => p.capture("$pageview"));

/** An event once per browser, like signed_up. The mark lives in browser storage. */
export function trackOnce(mark: string, event: EventName, props: EventProps = {}) {
  if (!client) return;
  const k = `mt.tracked.${mark}`;
  try {
    if (window.localStorage.getItem(k)) return;
    window.localStorage.setItem(k, "1");
  } catch {
    return;
  }
  track(event, props);
}

/** Signed out: the next person on this browser starts fresh. */
export const resetAnalytics = () => withPosthog((p) => p.reset());
