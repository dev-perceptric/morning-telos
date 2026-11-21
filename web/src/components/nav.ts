"use client";

// Moving between pages without a reload, and small helpers the screens share.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { parseRoute, type Route } from "@/lib/routes";
import { plainError } from "@/lib/plainError";

const EVENT = "mt:navigate";

export function navigate(path: string, replace = false) {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** The page in the address bar. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
  return parseRoute(path);
}

/** Browser storage that never throws (private windows can block it). */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not saved. The app still works, it just won't remember.
  }
}

export const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e));

/** POST to one of the app's own server routes as the signed-in person. Throws the route's error message. */
export async function callApi<T = Record<string, unknown>>(sb: SupabaseClient, path: string, body: Record<string, unknown>): Promise<T> {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach the server. Check your connection and try again.");
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(plainError(out.error));
  return out;
}

/** GET one of the app's own server routes as the signed-in person. Throws the route's error message. */
export async function getApi<T = Record<string, unknown>>(sb: SupabaseClient, path: string): Promise<T> {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" }).catch(() => null);
  if (!res) throw new Error("Couldn't reach the server. Check your connection and try again.");
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(plainError(out.error));
  return out;
}
