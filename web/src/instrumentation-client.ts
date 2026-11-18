import * as Sentry from "@sentry/nextjs";
import { startAnalytics } from "@/lib/analytics";
import { sentryOptions } from "@/lib/sentry";

// Error tracking in the browser. Off until NEXT_PUBLIC_SENTRY_DSN is set. It is read at build time, so it must be
// set where the image is built, not only where it runs. A Sentry DSN is safe to share.
const options = sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV);
if (options) Sentry.init(options);

// Product analytics (PostHog, src/lib/analytics.ts). Off until NEXT_PUBLIC_POSTHOG_KEY is set, read at build time like
// the DSN. When it's off, posthog-js is never loaded.
startAnalytics();

export const onRouterTransitionStart = options ? Sentry.captureRouterTransitionStart : undefined;
