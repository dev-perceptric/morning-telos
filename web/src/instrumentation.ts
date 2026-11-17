import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

// Error tracking on the server. Off until SENTRY_DSN is set on the server.
export function register() {
  const options = sentryOptions(process.env.SENTRY_DSN, process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV);
  if (options) Sentry.init(options);
}

// Errors thrown while handling a request (routes, server components) go to Sentry too. Without init it does nothing.
export const onRequestError = Sentry.captureRequestError;
