// User-facing text rule from CLAUDE.md: no em dashes or en dashes. Checks every screen, route, email and SQL message.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function files(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : /\.(tsx?|sql)$/.test(e.name) ? [new URL(e.name, dir)] : [],
  );
}

test("no em dashes or en dashes in the app's text", () => {
  const all = [...files(new URL("../src/", import.meta.url)), ...files(new URL("../supabase/", import.meta.url))];
  assert.ok(all.length > 5);
  const bad = all.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /[–—]/.test(line))
      .map(({ line, n }) => `${f.pathname.split("/web/")[1]}:${n}: ${line.trim()}`),
  );
  assert.deepEqual(bad, [], "Use a period, comma or colon instead of a dash");
});

// The products behind the team (Capybaroar, Arrowsterr) never show by name: customers see Morning Telos only.
const INTERNAL = /capybaroar|arrowsterr/i;
/** Source without comments, so notes for the next developer don't count. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("no screen names Capybaroar or Arrowsterr", () => {
  const screens = [...files(new URL("../src/components/", import.meta.url)), ...files(new URL("../src/app/", import.meta.url))].filter((f) => f.pathname.endsWith(".tsx"));
  assert.ok(screens.length > 5);
  const bad = screens.flatMap((f) =>
    code(readFileSync(f, "utf8"))
      .split("\n")
      .filter((line) => INTERNAL.test(line))
      .map((line) => `${f.pathname.split("/web/")[1]}: ${line.trim()}`),
  );
  assert.deepEqual(bad, []);
});

test("no route's error for people names Capybaroar or Arrowsterr", () => {
  const routes = files(new URL("../src/app/api/", import.meta.url)).filter((f) => f.pathname.endsWith("route.ts"));
  assert.ok(routes.length > 5);
  const bad = routes.flatMap((f) =>
    [...code(readFileSync(f, "utf8")).matchAll(/error:\s*(["'`])((?:(?!\1).)*)\1/g)].filter((m) => INTERNAL.test(m[2])).map((m) => `${f.pathname.split("/web/")[1]}: ${m[2]}`),
  );
  assert.deepEqual(bad, []);
});

test("the connect messages people see never name the products behind them", async () => {
  const { CONNECT_MESSAGES } = await import("../src/lib/social.ts");
  const { RETURN_MESSAGES, errorText, returnView } = await import("../src/lib/partnerConnect.ts");
  const { APP_MESSAGES } = await import("../src/lib/composio/catalog.ts");
  const texts = [...Object.values(CONNECT_MESSAGES), ...Object.values(RETURN_MESSAGES), ...Object.values(APP_MESSAGES).filter((v) => typeof v === "string")];
  for (const reason of ["cancelled", "failed", "expired", "used", "no_accounts", "taken", "plan_limit", "denied", "not_connected", "brand_gone", "provider_error", "other"]) texts.push(errorText("LinkedIn", reason));
  const ws = "11111111-2222-4333-8444-555555555555";
  for (const product of ["capybaroar", "arrowsterr"] as const)
    for (const q of [{ cb_status: "connected" }, { aw_status: "connected" }, { cb_status: "error", reason: "x" }, { cb_status: "pick", pick: "pick_tok_123" }, {}])
      texts.push(JSON.stringify(returnView({ product, ws, user: "u", item: "linkedin", from: { to: "settings" }, exp: 0 }, q)).replace(/"product":"\w+"/, ""));
  for (const t of texts) {
    assert.doesNotMatch(String(t), INTERNAL, String(t));
    assert.doesNotMatch(String(t), /[–—]/, String(t));
  }
});
