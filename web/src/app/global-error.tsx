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
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#faf9f5", color: "#141413", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <title>Something went wrong · Morning Telos</title>
        <main style={{ maxWidth: 420, margin: 16, padding: 32, textAlign: "center", background: "#fff", borderRadius: 8, boxShadow: "0 0 0 1px #e8e6dc" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "#3a3a37" }}>
            We&apos;ve been told about it. Try again. If it keeps happening, email meet@morningtelos.com
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ height: 36, padding: "0 16px", border: 0, borderRadius: 6, background: "#c6613f", color: "#fff", font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest ? <p style={{ margin: "16px 0 0", fontSize: 12, color: "#65645f", fontFamily: "ui-monospace, Menlo, monospace" }}>Ref {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
