"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { reloadOnce } from "@/lib/staleBuild";

// Shown when the root layout itself fails. It renders its own page, so the app's CSS is not here: styles are inline.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    reloadOnce(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f3f2", color: "#2e2926", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <title>Something went wrong · Morning Telos</title>
        <main style={{ maxWidth: 420, margin: 16, padding: 32, textAlign: "center", background: "#fff", borderRadius: 24, boxShadow: "0 0 0 1px rgba(46,41,38,.1)" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 500 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "rgba(46,41,38,.86)" }}>
            We&apos;ve been told about it. Try again. If it keeps happening, email meet@morningtelos.com
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ height: 36, padding: "0 16px", border: 0, borderRadius: 999, background: "#2e2926", color: "#fff", font: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest ? <p style={{ margin: "16px 0 0", fontSize: 12, color: "#6e6660", fontFamily: "ui-monospace, Menlo, monospace" }}>Ref {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
