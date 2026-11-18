// Test stand-in for src/lib/claude.ts (wired by ../tsResolve.mjs). The chat route gets `claude.client`, which a test
// sets to a fake; null means ANTHROPIC_API_KEY isn't set. Nothing here reaches Anthropic.
export const claude = { client: null as unknown };

export const teamClient = () => claude.client;
