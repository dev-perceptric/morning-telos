// Sentry settings for the server and the browser. No DSN means Sentry is off: init is never called.

export type SentryOptions = { dsn: string; environment?: string; tracesSampleRate: number; sendDefaultPii: false };

export function sentryOptions(dsn: string | undefined, environment?: string): SentryOptions | null {
  const d = (dsn ?? "").trim();
  if (!d) return null;
  return { dsn: d, environment: environment?.trim() || undefined, tracesSampleRate: 0.05, sendDefaultPii: false };
}
