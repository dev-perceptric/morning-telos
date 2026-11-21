// A server route's error, answered as one plain line. The full error goes to the server log and to Sentry.
import * as Sentry from "@sentry/nextjs";
import { errorText, FALLBACK, isTechnical } from "./plainError.ts";

/** The line a person sees for this error: ours when it's plain, else `fallback`. */
export function routeErrorText(e: unknown, fallback = FALLBACK): string {
  const m = errorText(e);
  return m && !isTechnical(m) ? m : fallback;
}

/** Log the full error under `area`, then answer with one plain line. */
export function routeError(e: unknown, area: string, fallback = FALLBACK, status = 500): Response {
  const m = errorText(e) || String(e);
  console.error(`${area}: ${m}`);
  Sentry.captureMessage(`${area}: ${m}`, { level: "error", tags: { area } });
  return Response.json({ error: routeErrorText(e, fallback) }, { status, headers: { "Cache-Control": "no-store" } });
}
