// Test stand-in for src/lib/wordpress/net.ts (wired by ../tsResolve.mjs): the routes' WordPress calls go to the fake
// site a test puts in `wpStub.fetch`, never to a real one.
import type { SafeFetch } from "../../../src/lib/siteFetch.ts";

export const wpStub = {
  fetch: (async (url: string) => {
    throw new Error(`Test tried to reach ${url}`);
  }) as SafeFetch,
};

export const wpNet = () => ({ fetch: wpStub.fetch, sleep: async () => {} });
