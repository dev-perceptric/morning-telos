"use client";

// Settings, Chrome extension: connects the Morning Telos extension in this browser, the way Omniscient's Settings,
// Chrome extension does. The extension opens this page from its side panel. A click on Connect this browser makes the
// browser its own sign-in session (POST /api/extension/connect) and hands it to the extension on this page only
// (src/lib/extensionConnect.ts). The extension never asks for a password.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { EXTENSION_MARK, handoverMessage, isConnected, type ConnectAnswer } from "@/lib/extensionConnect";
import { callApi } from "./nav";
import { ErrorText, Notice } from "./ui";

export function ExtensionSettings({ sb }: { sb: SupabaseClient }) {
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // The extension marks the page as it loads. Look again for a moment in case it is still starting.
  useEffect(() => {
    const look = () => setFound(document.documentElement.dataset[EXTENSION_MARK] === "1");
    look();
    const t = window.setInterval(look, 500);
    const stop = window.setTimeout(() => window.clearInterval(t), 4000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const out = await callApi<ConnectAnswer>(sb, "/api/extension/connect", {});
      const msg = handoverMessage(out);
      if (!msg) throw new Error("We couldn't connect this browser. Try again.");
      const ok = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", on);
          resolve(false);
        }, 5000);
        function on(e: MessageEvent) {
          if (e.source !== window || e.origin !== window.location.origin || !isConnected(e.data)) return;
          window.clearTimeout(timer);
          window.removeEventListener("message", on);
          resolve(true);
        }
        window.addEventListener("message", on);
        window.postMessage(msg, window.location.origin);
      });
      if (!ok) throw new Error("The extension didn't answer. Reload this page and try again.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad">
      <div className="sh">
        <h2>Chrome extension</h2>
      </div>
      <p className="hint-s">Chat with your team, attach the page you are on and approve work from a side panel in Chrome. It only reads a page when you click, and it never sends anything.</p>
      {done ? (
        <div className="mt-4">
          <Notice>This browser is connected. You can close this tab and open Morning Telos from the toolbar.</Notice>
        </div>
      ) : found ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn primary" disabled={busy} onClick={connect}>
            {busy ? "Connecting" : "Connect this browser"}
          </button>
          <small className="text-[12.5px] text-ink-4">Signs the extension in as you. Sign out in the extension at any time.</small>
        </div>
      ) : (
        <p className="hint-s mt-4">Add the Morning Telos extension to Chrome, then open this page again.</p>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </section>
  );
}
