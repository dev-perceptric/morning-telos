// Lets a test load app modules written without file extensions (`import "./plans"`), the way Next resolves them:
// "./x" is "./x.ts" or "./x/index.ts", and "@/x" is "src/x". src/lib/serverAuth.ts loads a stand-in
// (stubs/serverAuth.ts) so tests choose who is signed in and hand routes a fake database, and src/lib/claude.ts loads
// stubs/claude.ts so tests hand the chat route a fake Claude (nothing reaches Anthropic).
// Copied from Omniscient's tests/server/tsResolve.mjs. Registered by the tests that need it.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = new URL("../../src/", import.meta.url);
const STUBS = {
  [new URL("lib/serverAuth", src).href]: new URL("./stubs/serverAuth.ts", import.meta.url).href,
  [new URL("lib/claude", src).href]: new URL("./stubs/claude.ts", import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  const s = specifier.startsWith("@/") ? new URL(specifier.slice(2), src).href : specifier;
  if ((s.startsWith(".") || s.startsWith("file:")) && context.parentURL?.startsWith(src.href)) {
    const url = new URL(s, context.parentURL).href.replace(/\.ts$/, "");
    if (STUBS[url]) return next(STUBS[url], context);
    const path = fileURLToPath(new URL(s, context.parentURL));
    if (!existsSync(path) || !/\.[cm]?[jt]s$/.test(path)) for (const ext of [".ts", "/index.ts"]) if (existsSync(path + ext)) return next(pathToFileURL(path + ext).href, context);
  }
  return next(s, context);
}
