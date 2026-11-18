import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LoopClient } from "./agentLoop.ts";

// The Claude client for the AI team, made from ANTHROPIC_API_KEY (the "Morning Telos" key in console.anthropic.com).
// Null when the key isn't set, so the chat says the team is starting up instead of failing.
// The SDK retries busy (429) and server (5xx) errors twice on its own.

let made: { key: string; client: Anthropic } | null = null;

export function teamClient(): LoopClient | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (made?.key !== key) made = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 10 * 60 * 1000 }) };
  return made.client;
}
