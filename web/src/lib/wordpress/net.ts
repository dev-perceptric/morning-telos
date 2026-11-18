// The network the server's WordPress calls use: safeRequest's own safe fetch (src/lib/siteFetch.ts), which checks
// every address on the IP it connects to. A file of its own so the route tests swap it for a fake site
// (tests/server/stubs/wordpressNet.ts, wired by tests/server/tsResolve.mjs) and never reach a real one.
import type { WpNet } from "./wordpress.ts";

export const wpNet = (): WpNet => ({});
