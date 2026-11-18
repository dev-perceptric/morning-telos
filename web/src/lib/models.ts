// Which Claude model each choice runs, in one place. The old app had the same four choices (app/lib/agents.js MODELS).
// Prices for these ids are in meter.ts (tests/meter.test.ts checks every id here has one).
// Model ids come from the claude-api skill's current model table: exact ids, never date suffixes.

export const MODEL_CHOICES = ["auto", "opus", "sonnet", "haiku"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];
export const isModelChoice = (m: unknown): m is ModelChoice => typeof m === "string" && (MODEL_CHOICES as readonly string[]).includes(m);

export const MODELS: Record<ModelChoice, string> = {
  // The team's default: the current Opus.
  auto: "claude-opus-5-5",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/**
 * Models that take the server-side refusal fallback (`fallbacks: "default"` with the beta below). On a policy decline
 * the API runs the same request on a fallback model inside the same call. Claude Haiku 5.5 has no server-side fallback.
 */
export const SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Per reply. The calls are not streamed, and 16,000 keeps each one well under the SDK's request timeout. */
export const MAX_TOKENS = 16000;
/** Opus 5.5 defaults to medium too, but it is set on every call so a model change doesn't change it. */
export const EFFORT = "medium" as const;

/** The model id to run: an explicit choice first, then the agent's setting, then auto. */
export function modelFor(choice: unknown, pref?: unknown): string {
  if (isModelChoice(choice) && choice !== "auto") return MODELS[choice];
  if (isModelChoice(pref)) return MODELS[pref];
  return MODELS.auto;
}
