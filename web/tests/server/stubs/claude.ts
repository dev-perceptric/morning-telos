// Test stand-in for src/lib/claude.ts (wired by ../tsResolve.mjs). The chat route gets `claude.client`, which a test
// sets to a fake; null means ANTHROPIC_API_KEY isn't set. Nothing here reaches Anthropic.
export const claude = { client: null as unknown };

export const teamClient = () => claude.client;

/** The router call (src/lib/router.ts) asks for JSON in a schema. The team's own calls never do. */
export const isRouter = (p: unknown) => Boolean((p as { output_config?: { format?: unknown } } | null)?.output_config?.format);

/** The router's answer, picking `god`, with its own small usage. */
export const routerReply = (god: string, model = "claude-haiku-5-5") => ({
  id: "r",
  type: "message",
  role: "assistant",
  model,
  content: [{ type: "text", text: JSON.stringify({ agent: god, reason: "Fits the job" }) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 400, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
