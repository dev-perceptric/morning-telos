import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

// Error tracking in the browser. Off until NEXT_PUBLIC_SENTRY_DSN is set. It is read at build time, so it must be
// set where the image is built, not only where it runs. A Sentry DSN is safe to share.
const options = sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV);
if (options) Sentry.init(options);

export const onRouterTransitionStart = options ? Sentry.captureRouterTransitionStart : undefined;
