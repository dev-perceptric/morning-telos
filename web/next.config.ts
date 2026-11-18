import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Version skew protection: a tab from an older deploy does a full reload instead of mixing two builds.
  deploymentId: process.env.GIT_COMMIT || undefined,
  // PostHog goes through our own address (src/lib/analytics.ts), so ad blockers don't drop it and the browser
  // only talks to this site. PostHog's paths end in a slash, so Next must not redirect them.
  skipTrailingSlashRedirect: true,
  // No other site can show the app in a frame, so nobody can trick a click on Approve or Delete.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
