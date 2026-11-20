// Connecting social accounts on our own page (src/lib/partnerConnect.ts, src/lib/connectFlow.ts): the sealed state,
// which flow runs, what the return page shows, and the route handlers with a fake gate and a fake partner.
// Nothing reaches Capybaroar, Arrowsterr or Supabase.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TOOLS, TOOLS_PRODUCT } from "../src/lib/connectFlow.ts";
import { finishSetup } from "../src/lib/home.ts";
import type { Connectable, IntegrationConnect, Partner, PartnerResult, Pick, SocialConnect } from "../src/lib/partner.ts";
import {
  cleanIds,
  cleanOrigin,
  cleanQuery,
  connectMode,
  connectReturn,
  errorText,
  listIntegrations,
  listNetworks,
  missingRoute,
  openIn,
  originPath,
  pickOptions,
  pickSave,
  readConnectState,
  RETURN_MESSAGES,
  RETURN_PATH,
  returnView,
  signConnectState,
  sortNetworks,
  startConnect,
  startIntegration,
  startRequest,
  STATE_TTL_MS,
  verifyReturn,
  type ConnectState,
  type ServiceRow,
} from "../src/lib/partnerConnect.ts";
import { sealWith, type Keyring } from "../src/lib/sealing.ts";
import { CONNECT_MESSAGES } from "../src/lib/social.ts";
import { networkLogo, networkName, sameNetwork } from "../src/lib/socialChannels.ts";
import type { Role } from "../src/lib/workspace.ts";
import type { Gate } from "../src/lib/workspaceRoutes.ts";

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-11-20T10:00:00Z");
const ring = (): Keyring => ({ current: "t1", keys: new Map([["t1", randomBytes(32)]]) });
const RING = ring();

const state = (o: Partial<ConnectState> = {}): ConnectState => ({ product: "capybaroar", ws: WS, user: "u1", item: "linkedin", from: { to: "settings" }, exp: NOW + STATE_TTL_MS, ...o });

// ─────────────── the sealed state ───────────────

test("state: a good one opens, with every part", () => {
  const sealed = signConnectState(RING, { product: "capybaroar", ws: WS, user: "u1", item: "linkedin", from: { to: "chat", thread: THREAD, agent: "social" } }, NOW);
  assert.deepEqual(readConnectState(RING, sealed, NOW + 1000), state({ from: { to: "chat", thread: THREAD, agent: "social" } }));
});

test("state: tampered, sealed by another key, or for another use is refused", () => {
  const sealed = signConnectState(RING, { product: "capybaroar", ws: WS, user: "u1", item: "linkedin", from: { to: "settings" } }, NOW);
  const parts = sealed.split(".");
  const body = Buffer.from(parts[4], "base64");
  body[0] ^= 1;
  assert.equal(readConnectState(RING, [...parts.slice(0, 4), body.toString("base64")].join("."), NOW), null, "a changed byte");
  assert.equal(readConnectState(ring(), sealed, NOW), null, "another server's key");
  assert.equal(readConnectState(RING, sealWith(RING, JSON.stringify(state()), "composio-connect"), NOW), null, "sealed for the apps flow");
  assert.equal(readConnectState(RING, "", NOW), null);
  assert.equal(readConnectState(RING, 7, NOW), null);
  assert.equal(readConnectState(RING, "v2.t1.x.y.z", NOW), null);
});

test("state: expired is refused, and so are parts that make no sense", () => {
  const sealed = signConnectState(RING, { product: "capybaroar", ws: WS, user: "u1", item: "linkedin", from: { to: "home" } }, NOW);
  assert.ok(readConnectState(RING, sealed, NOW + STATE_TTL_MS - 1));
  assert.equal(readConnectState(RING, sealed, NOW + STATE_TTL_MS + 1), null);
  const seal = (o: Record<string, unknown>) => sealWith(RING, JSON.stringify({ ...state(), ...o }), "partner-connect");
  for (const bad of [{ product: "omniscient" }, { ws: "not-a-uuid" }, { user: "" }, { item: "../x" }, { exp: "soon" }]) assert.equal(readConnectState(RING, seal(bad), NOW), null, JSON.stringify(bad));
});

test("origin: home, a chat thread or Settings, and back to the right page for each product", () => {
  assert.deepEqual(cleanOrigin({ to: "home" }), { to: "home" });
  assert.deepEqual(cleanOrigin({ to: "chat", thread: THREAD.toUpperCase(), agent: "seo" }), { to: "chat", thread: THREAD, agent: "seo" });
  assert.deepEqual(cleanOrigin({ to: "chat", thread: THREAD, agent: "zeus" }), { to: "chat", thread: THREAD, agent: null });
  assert.deepEqual(cleanOrigin({ to: "chat", thread: "../../evil" }), { to: "settings" });
  assert.deepEqual(cleanOrigin({ to: "https://evil.test" }), { to: "settings" });
  assert.deepEqual(cleanOrigin(null), { to: "settings" });
  assert.equal(originPath({ to: "settings" }, "capybaroar"), "/settings/social");
  assert.equal(originPath({ to: "settings" }, "arrowsterr"), "/settings/apps");
  assert.equal(originPath({ to: "home" }, "capybaroar"), "/");
  assert.equal(originPath({ to: "chat", thread: THREAD, agent: null }, "capybaroar"), `/chat/${THREAD}`);
  assert.equal(RETURN_PATH, "/settings/social/return");
});

// ─────────────── which flow ───────────────

test("connectMode: the partner's list means our page, a 404 means the old connect link, anything else is a hiccup", () => {
  assert.equal(connectMode({ ok: true, status: 200 }), "branded");
  assert.equal(connectMode({ ok: false, status: 404 }), "link");
  assert.equal(connectMode({ ok: false, status: 503 }), "down");
  assert.equal(connectMode({ ok: false, status: 0 }), "down");
  assert.equal(connectMode({ ok: false, status: 401 }), "down");
});

test("missingRoute: only a 404 without the partner's own error means an older product", () => {
  assert.equal(missingRoute({ ok: false, status: 404, code: "http_404" }), true);
  assert.equal(missingRoute({ ok: false, status: 404 }), true);
  assert.equal(missingRoute({ ok: false, status: 404, code: "not_found" }), false);
  assert.equal(missingRoute({ ok: false, status: 422, code: "http_422" }), false);
  assert.equal(missingRoute({ ok: true, status: 200 }), false);
});

test("startRequest: social networks and SEO tools start on their own routes", () => {
  assert.deepEqual(startRequest(undefined, WS, "linkedin", { to: "home" }), { path: "/api/social/connect/start", body: { workspaceId: WS, network: "linkedin", from: { to: "home" } } });
  assert.deepEqual(startRequest("capybaroar", WS, "x", { to: "settings" }).path, "/api/social/connect/start");
  assert.deepEqual(startRequest(TOOLS_PRODUCT, WS, "cloudflare", { to: "settings" }), { path: "/api/seo/connect/start", body: { workspaceId: WS, integration: "cloudflare", from: { to: "settings" } } });
});

test("openIn: a chat and the old connect page open a new tab, Settings and Home go there in the same tab", () => {
  assert.equal(openIn("branded", { to: "chat", thread: THREAD, agent: "social" }), "tab");
  assert.equal(openIn("link", { to: "settings" }), "tab");
  assert.equal(openIn("link", { to: "home" }), "tab");
  assert.equal(openIn("branded", { to: "settings" }), "here");
  assert.equal(openIn("branded", { to: "home" }), "here");
});

test("networks: known ones first in logo order, logos for the ones we have, and linkedin_page is linkedin-page", () => {
  const list = sortNetworks([
    { id: "mastodon", name: "Mastodon", kind: "" },
    { id: "linkedin", name: "LinkedIn", kind: "" },
    { id: "bluesky", name: "Bluesky", kind: "" },
    { id: "instagram", name: "Instagram", kind: "" },
  ]);
  assert.deepEqual(list.map((n) => n.id), ["instagram", "linkedin", "bluesky", "mastodon"]);
  assert.equal(networkLogo("linkedin-page"), "/img/networks/linkedin-page.svg");
  assert.equal(networkLogo("LinkedIn_Page"), "/img/networks/linkedin-page.svg");
  assert.equal(networkLogo("twitter"), "/img/networks/x.svg");
  assert.equal(networkLogo("mastodon"), null);
  assert.equal(networkName("linkedin-page"), "LinkedIn Page");
  assert.ok(sameNetwork("linkedin_page", "linkedin-page"));
  assert.ok(!sameNetwork("linkedin", "linkedin-page"));
  // Every logo the grid names is a small file that's there.
  for (const id of ["instagram", "facebook", "linkedin", "linkedin-page", "x", "tiktok", "youtube", "threads", "pinterest"]) {
    const svg = readFileSync(new URL(`../public/img/networks/${id}.svg`, import.meta.url), "utf8");
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, id);
    assert.doesNotMatch(svg, /<script|on\w+=|href=/i, id);
    assert.ok(svg.length < 4000, `${id} is small`);
  }
});

// ─────────────── the return page ───────────────

test("returnView: connected goes back to where it started, with the network's name", () => {
  assert.deepEqual(returnView(state(), { cb_status: "connected", network: "linkedin" }), {
    kind: "connected",
    product: "capybaroar",
    item: "linkedin",
    name: "LinkedIn",
    title: "LinkedIn connected",
    back: "/settings/social",
    chat: false,
    from: { to: "settings" },
  });
  const chat = returnView(state({ from: { to: "chat", thread: THREAD, agent: "social" } }), { cb_status: "connected" });
  assert.equal(chat.kind, "connected");
  assert.equal(chat.back, `/chat/${THREAD}`);
  assert.equal(chat.kind === "connected" && chat.chat, true);
  assert.equal(returnView(state({ from: { to: "home" } }), { cb_status: "connected" }).back, "/");
});

test("returnView: an error shows a plain line and can be tried again", () => {
  const v = returnView(state(), { cb_status: "error", network: "linkedin", reason: "access_denied" });
  assert.equal(v.kind, "error");
  assert.equal(v.kind === "error" && v.text, "You stopped before LinkedIn finished connecting. Try again and allow access.");
  assert.equal(v.kind === "error" && v.retry, true);
  // A friendly line for every code Capybaroar and Arrowsterr send.
  for (const reason of ["cancelled", "failed", "expired", "used", "no_accounts", "taken", "plan_limit", "denied", "not_connected", "brand_gone", "provider_error"]) {
    const line = errorText("Facebook", reason);
    assert.match(line, /^[A-Z][^—–]*\.$/, reason);
    for (const sentence of line.split(". ")) assert.ok(sentence.split(" ").length <= 14, `${reason}: short sentences`);
  }
  assert.equal(errorText("Facebook", "no_accounts"), "We didn't find a Facebook page or account you can post to. Check that you manage one, then try again.");
  assert.equal(errorText("Facebook", "plan_limit"), "Your plan has no room for more accounts. Remove one or upgrade, then try again.");
  assert.equal(errorText("Cloudflare", "provider_error"), "Cloudflare had a problem on its side. Try again in a few minutes.");
  assert.equal(errorText("X", "weird<script>"), "X didn't connect. Try again.");
  const odd = returnView(state(), { cb_status: "error", reason: "<b>raw partner text</b>" });
  assert.equal(odd.kind === "error" && odd.text, "LinkedIn didn't connect. Try again.", "a reason that isn't a code is never shown");
  assert.equal(returnView(state(), {}).kind, "error", "no status at all");
  assert.equal(returnView(state(), { cb_status: "maybe" }).kind, "error");
});

test("returnView: pick needs a real token, and the network in the address must be the one we sealed", () => {
  assert.deepEqual(returnView(state({ item: "facebook" }), { cb_status: "pick", network: "facebook", pick: "pick_tok_123" }), {
    kind: "pick",
    product: "capybaroar",
    item: "facebook",
    name: "Facebook",
    token: "pick_tok_123",
    back: "/settings/social",
    from: { to: "settings" },
  });
  assert.equal(returnView(state({ item: "facebook" }), { cb_status: "pick", pick: "../../x" }).kind, "error");
  const swapped = returnView(state(), { cb_status: "connected", network: "facebook" });
  assert.equal(swapped.kind === "error" && swapped.text, RETURN_MESSAGES.mismatch);
});

test("returnView: Arrowsterr reads aw_status and integration, never cb_status", () => {
  const s = state({ product: "arrowsterr", item: "google_search_console" });
  const v = returnView(s, { aw_status: "connected", integration: "google_search_console" });
  assert.equal(v.kind, "connected");
  assert.equal(v.kind === "connected" && v.title, "Google Search Console connected");
  assert.equal(v.back, "/settings/apps");
  assert.equal(returnView(s, { cb_status: "connected" }).kind, "error", "the other product's status doesn't count");
  const e = returnView(s, { aw_status: "error", integration: "google_search_console", reason: "denied" });
  assert.equal(e.kind === "error" && e.text, "You stopped before Google Search Console finished connecting. Try again and allow access.");
  assert.equal(e.kind === "error" && e.retry, true);
  assert.equal(returnView(s, { aw_status: "pick", pick: "pick_tok_123" }).kind, "error", "only social networks have a pick step");
  assert.equal(returnView(state(), { aw_status: "connected" }).kind, "error");
});

test("cleanQuery keeps only the params the page reads, as short strings; cleanIds takes 1 to 50 different ids", () => {
  assert.deepEqual(cleanQuery({ cb_status: "connected", network: "x", state: "s", evil: "y", pick: ["a"] }), { cb_status: "connected", network: "x" });
  assert.deepEqual(cleanQuery("x"), {});
  assert.deepEqual(cleanIds(["a", " b "]), ["a", "b"]);
  assert.equal(cleanIds([]), null);
  assert.equal(cleanIds(["a", "a"]), null);
  assert.equal(cleanIds([1]), null);
  assert.equal(cleanIds(Array.from({ length: 100 }, (_, i) => `p${i}`))?.length, 100);
  assert.equal(cleanIds(Array.from({ length: 101 }, (_, i) => `p${i}`)), null);
  assert.equal(cleanIds("a"), null);
});

// ─────────────── fakes ───────────────

const ok = <T>(data: T, status = 200): PartnerResult<T> => ({ ok: true, status, data });
const no = (status: number, code = `http_${status}`): PartnerResult<never> => ({ ok: false, status, code, message: "No.", retryable: status === 0 || status >= 500 });
const NETS: Connectable[] = [
  { id: "linkedin", name: "LinkedIn", kind: "profile" },
  { id: "facebook", name: "Facebook", kind: "page" },
];

function fakeSocial(o: { networks?: PartnerResult<Connectable[]>; start?: PartnerResult<{ url: string }>; pick?: PartnerResult<Pick>; pickConnect?: PartnerResult<{ channels: unknown[] }> } = {}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const client: SocialConnect = {
    async networks() {
      calls.push("networks");
      return o.networks ?? ok(NETS);
    },
    async start(brand, input) {
      calls.push(`start ${brand} ${input.network}`);
      bodies.push(input);
      return o.start ?? ok({ url: `https://www.${input.network}.test/oauth` });
    },
    async pick(token) {
      calls.push(`pick ${token}`);
      return o.pick ?? ok({ network: "facebook", options: [{ id: "p1", name: "Ana's Bakery", picture: null }, { id: "p2", name: "Shop", picture: null }] });
    },
    async pickConnect(token, ids) {
      calls.push(`pickConnect ${token} ${ids.join(",")}`);
      return o.pickConnect ?? ok({ channels: ids.map((id) => ({ id })) });
    },
  };
  return { client, calls, bodies };
}

function fakeOld(link: PartnerResult<{ url: string; expires_at: string | null }> = ok({ url: "https://old.test/connect/tok", expires_at: null })) {
  const calls: string[] = [];
  const partner = {
    product: "capybaroar",
    async connectLink(brand: string) {
      calls.push(`connectLink ${brand}`);
      return link;
    },
  } as unknown as Partner;
  return { partner, calls };
}

/** A gate for one person: their role in each workspace. */
const gateAs =
  (user: string, roles: Record<string, Role>, ws = WS): Gate =>
  async (min) => {
    const rank = { owner: 4, admin: 3, editor: 2, viewer: 1 };
    const role = roles[ws];
    if (!role || rank[role] < rank[min]) return { ok: false, status: 403, error: `You need ${min} access in this workspace to do that.` };
    return { ok: true, userId: user, email: `${user}@example.com` };
  };
const READY: ServiceRow = { status: "ready", brand_id: "cb-1" };

function startDeps(o: { role?: Role; social?: ReturnType<typeof fakeSocial>; old?: ReturnType<typeof fakeOld>; service?: ServiceRow } = {}) {
  const social = o.social ?? fakeSocial();
  const old = o.old ?? fakeOld();
  const logs: string[] = [];
  return {
    social,
    old,
    logs,
    d: {
      gate: gateAs("u1", { [WS]: o.role ?? "admin" }),
      workspaceId: WS,
      service: async () => (o.service === undefined ? READY : o.service),
      social: () => ({ ok: true as const, client: social.client }),
      partner: () => ({ ok: true as const, partner: old.partner }),
      ring: () => RING,
      appOrigin: "https://chat.test/",
      now: NOW,
      log: (m: string) => logs.push(m),
    },
  };
}

// ─────────────── start ───────────────

test("start: an admin gets the network's own sign-in, coming back to our return page with a sealed state", async () => {
  const t = startDeps();
  const r = await startConnect({ network: "LinkedIn", from: { to: "chat", thread: THREAD, agent: "social" } }, t.d);
  assert.deepEqual(r, { status: 200, body: { mode: "branded", url: "https://www.linkedin.test/oauth" } });
  assert.deepEqual(t.social.calls, ["networks", "start cb-1 linkedin"]);
  const { return_url } = t.social.bodies[0] as { return_url: string };
  const back = new URL(return_url);
  assert.equal(`${back.origin}${back.pathname}`, "https://chat.test/settings/social/return");
  assert.deepEqual(readConnectState(RING, back.searchParams.get("state"), NOW), state({ from: { to: "chat", thread: THREAD, agent: "social" } }));
  assert.deepEqual(t.old.calls, []);
});

test("start: owners and admins only", async () => {
  for (const role of ["editor", "viewer"] as const) {
    const t = startDeps({ role });
    const r = await startConnect({ network: "linkedin" }, t.d);
    assert.equal(r.status, 403, role);
    assert.deepEqual(t.social.calls, []);
  }
  assert.equal((await startConnect({ network: "linkedin" }, startDeps({ role: "owner" }).d)).status, 200);
});

test("start: the network must be one the partner lists", async () => {
  for (const network of ["myspace", "", undefined]) {
    const t = startDeps();
    assert.deepEqual(await startConnect({ network }, t.d), { status: 400, body: { error: RETURN_MESSAGES.pickNetwork } }, String(network));
    assert.deepEqual(t.social.calls, ["networks"]);
  }
  for (const network of ["../brands", "a b", 7, "x".repeat(41)]) {
    const t = startDeps();
    assert.deepEqual(await startConnect({ network }, t.d), { status: 400, body: { error: RETURN_MESSAGES.pickNetwork } }, String(network));
    assert.deepEqual(t.social.calls, [], "a bad id never reaches the partner");
  }
});

test("start: falls back to the old connect link when the new calls answer 404", async () => {
  const noList = startDeps({ social: fakeSocial({ networks: no(404, "not_found") }) });
  assert.deepEqual(await startConnect({}, noList.d), { status: 200, body: { mode: "link", url: "https://old.test/connect/tok" } }, "no network needed");
  assert.deepEqual(noList.old.calls, ["connectLink cb-1"]);
  const noStart = startDeps({ social: fakeSocial({ start: no(404) }) });
  assert.deepEqual(await startConnect({ network: "facebook" }, noStart.d), { status: 200, body: { mode: "link", url: "https://old.test/connect/tok" } }, "no start route yet");
  const noBrand = startDeps({ social: fakeSocial({ start: no(404, "not_found") }) });
  assert.deepEqual(await startConnect({ network: "facebook" }, noBrand.d), { status: 502, body: { error: CONNECT_MESSAGES.broken } }, "the partner's own 404 (no such brand) is not a fallback");
  assert.deepEqual(noBrand.old.calls, []);
  const down = startDeps({ social: fakeSocial({ networks: no(503) }) });
  assert.deepEqual(await startConnect({ network: "facebook" }, down.d), { status: 503, body: { error: CONNECT_MESSAGES.busy } }, "a hiccup is not a fallback");
  assert.deepEqual(down.old.calls, []);
});

test("start: a workspace still being set up, a failed start, and a missing partner key get plain lines", async () => {
  assert.deepEqual(await startConnect({ network: "linkedin" }, startDeps({ service: { status: "pending", brand_id: null } }).d), { status: 409, body: { error: CONNECT_MESSAGES.pending } });
  assert.deepEqual(await startConnect({ network: "linkedin" }, startDeps({ service: null }).d), { status: 409, body: { error: CONNECT_MESSAGES.pending } });
  assert.deepEqual(await startConnect({ network: "linkedin" }, startDeps({ social: fakeSocial({ start: no(422, "bad_network") }) }).d), { status: 502, body: { error: CONNECT_MESSAGES.broken } });
  assert.deepEqual(await startConnect({ network: "linkedin" }, startDeps({ social: fakeSocial({ start: no(0, "timeout") }) }).d), { status: 503, body: { error: CONNECT_MESSAGES.busy } });
  const t = startDeps();
  const r = await startConnect({ network: "linkedin" }, { ...t.d, social: () => ({ ok: false, error: "Capybaroar partner key is not set on the server." }) });
  assert.deepEqual(r, { status: 503, body: { error: CONNECT_MESSAGES.notOpen } });
  assert.match(t.logs[0], /partner key/, "the reason goes to staff, not to the screen");
});

test("networks list: admins only, link mode on 404, a plain line on a hiccup", async () => {
  const social = fakeSocial({ networks: ok([{ id: "facebook", name: "Facebook", kind: "" }, { id: "instagram", name: "Instagram", kind: "" }]) });
  const deps = (role: Role, s = social) => ({ gate: gateAs("u1", { [WS]: role }), social: () => ({ ok: true as const, client: s.client }), log: () => {} });
  assert.deepEqual(await listNetworks(deps("admin")), { status: 200, body: { mode: "branded", networks: [{ id: "instagram", name: "Instagram", kind: "" }, { id: "facebook", name: "Facebook", kind: "" }] } });
  assert.equal((await listNetworks(deps("editor"))).status, 403);
  assert.deepEqual(await listNetworks(deps("owner", fakeSocial({ networks: no(404) }))), { status: 200, body: { mode: "link", networks: [] } });
  assert.deepEqual(await listNetworks(deps("owner", fakeSocial({ networks: no(500) }))), { status: 503, body: { error: CONNECT_MESSAGES.busy } });
});

// ─────────────── return and pick ───────────────

const sealed = (o: Partial<Omit<ConnectState, "exp">> = {}, now = NOW) => signConnectState(RING, { product: "capybaroar", ws: WS, user: "u1", item: "facebook", from: { to: "settings" }, ...o }, now);
const verify = (user: string, roles: Record<string, Role>) => ({ ring: () => RING, gateFor: (ws: string) => gateAs(user, roles, ws), now: NOW + 1000 });

test("return: the person who started it gets the view for their workspace", async () => {
  const r = await connectReturn({ state: sealed(), query: { cb_status: "connected", network: "facebook" } }, verify("u1", { [WS]: "admin" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.workspaceId, WS);
  assert.equal((r.body.view as { title: string }).title, "Facebook connected");
});

test("return: expired, another workspace, someone else, or no longer an admin is refused", async () => {
  assert.deepEqual(await connectReturn({ state: sealed({}, NOW - STATE_TTL_MS - 5000), query: {} }, verify("u1", { [WS]: "admin" })), { status: 400, body: { error: RETURN_MESSAGES.expired } });
  assert.deepEqual(await connectReturn({ state: "made up", query: {} }, verify("u1", { [WS]: "admin" })), { status: 400, body: { error: RETURN_MESSAGES.expired } });
  assert.deepEqual(await connectReturn({ state: sealed(), workspaceId: OTHER, query: {} }, verify("u1", { [WS]: "admin", [OTHER]: "owner" })), { status: 403, body: { error: RETURN_MESSAGES.wrongWorkspace } });
  assert.deepEqual(await connectReturn({ state: sealed(), query: {} }, verify("u2", { [WS]: "owner" })), { status: 403, body: { error: RETURN_MESSAGES.someoneElse } });
  assert.equal((await connectReturn({ state: sealed(), query: {} }, verify("u1", { [WS]: "editor" }))).status, 403, "made an editor since");
  assert.equal((await connectReturn({ state: sealed(), query: {} }, verify("u1", { [OTHER]: "owner" }))).status, 403, "not in the state's workspace");
  assert.equal((await verifyReturn({ state: sealed(), workspaceId: WS }, verify("u1", { [WS]: "owner" }))).ok, true);
});

const pickDeps = (s = fakeSocial(), user = "u1", roles: Record<string, Role> = { [WS]: "admin" }) => ({ ...verify(user, roles), social: () => ({ ok: true as const, client: s.client }), log: () => {} });

test("pick: the options after the checks, only for the network we sealed", async () => {
  const s = fakeSocial();
  const r = await pickOptions("pick_tok_123", { state: sealed() }, pickDeps(s));
  assert.deepEqual(r, { status: 200, body: { network: "facebook", name: "Facebook", options: [{ id: "p1", name: "Ana's Bakery", picture: null }, { id: "p2", name: "Shop", picture: null }] } });
  assert.deepEqual(s.calls, ["pick pick_tok_123"]);
  const other = fakeSocial({ pick: ok({ network: "linkedin", options: [] }) });
  assert.deepEqual(await pickOptions("pick_tok_123", { state: sealed() }, pickDeps(other)), { status: 403, body: { error: RETURN_MESSAGES.mismatch } });
  const bad = fakeSocial();
  assert.deepEqual(await pickOptions("../x", { state: sealed() }, pickDeps(bad)), { status: 400, body: { error: RETURN_MESSAGES.pickGone } });
  assert.deepEqual(bad.calls, []);
  assert.equal((await pickOptions("pick_tok_123", { state: sealed() }, pickDeps(fakeSocial(), "u2", { [WS]: "owner" }))).status, 403);
  assert.deepEqual(await pickOptions("pick_tok_123", { state: sealed() }, pickDeps(fakeSocial({ pick: no(404) }))), { status: 410, body: { error: RETURN_MESSAGES.pickGone } });
  assert.equal((await pickOptions("pick_tok_123", { state: sealed({ product: "arrowsterr", item: "gsc" }) }, pickDeps(fakeSocial()))).status, 400);
});

test("pick: connects only ids the partner offered, then shows connected", async () => {
  const s = fakeSocial();
  const r = await pickSave("pick_tok_123", { state: sealed({ from: { to: "home" } }), ids: ["p2"] }, pickDeps(s));
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, 1);
  assert.deepEqual(r.body.view, { kind: "connected", product: "capybaroar", item: "facebook", name: "Facebook", title: "Facebook connected", back: "/", chat: false, from: { to: "home" } });
  assert.deepEqual(s.calls, ["pick pick_tok_123", "pickConnect pick_tok_123 p2"]);
  const sneaky = fakeSocial();
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p9"] }, pickDeps(sneaky)), { status: 400, body: { error: RETURN_MESSAGES.pickSome } });
  assert.deepEqual(sneaky.calls, ["pick pick_tok_123"]);
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: [] }, pickDeps()), { status: 400, body: { error: RETURN_MESSAGES.pickSome } });
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p1"] }, pickDeps(fakeSocial({ pickConnect: no(503) }))), { status: 503, body: { error: CONNECT_MESSAGES.busy } });
  // After a 409 the pick still works: the person tries again with fewer or other accounts.
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p1", "p2"] }, pickDeps(fakeSocial({ pickConnect: no(409, "plan_limit") }))), { status: 409, body: { error: RETURN_MESSAGES.pickLimit } });
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p1"] }, pickDeps(fakeSocial({ pickConnect: no(409, "taken") }))), { status: 409, body: { error: RETURN_MESSAGES.pickTaken } });
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p1"] }, pickDeps(fakeSocial({ pickConnect: no(410, "used") }))), { status: 410, body: { error: RETURN_MESSAGES.pickGone } });
  assert.deepEqual(await pickSave("pick_tok_123", { state: sealed(), ids: ["p1"] }, pickDeps(fakeSocial({ pickConnect: no(422, "invalid_request") }))), { status: 400, body: { error: RETURN_MESSAGES.pickSome } });
});

// ─────────────── SEO tools (Arrowsterr) ───────────────

function fakeTools(o: { list?: PartnerResult<Connectable[]>; start?: PartnerResult<{ url: string }> } = {}) {
  const bodies: unknown[] = [];
  const client: IntegrationConnect = {
    integrations: async () => o.list ?? ok([{ id: "google_search_console", name: "Google Search Console", kind: "seo" }]),
    start: async (_b, input) => {
      bodies.push(input);
      return o.start ?? ok({ url: "https://accounts.google.test/o" });
    },
  };
  return { client, bodies };
}

test("SEO tools: start seals an Arrowsterr state for the same return page; off when Arrowsterr has no list yet", async () => {
  const tools = fakeTools();
  const d = { gate: gateAs("u1", { [WS]: "owner" }), workspaceId: WS, service: async () => ({ status: "ready" as const, brand_id: "aw-1" }), tools: () => ({ ok: true as const, client: tools.client }), ring: () => RING, appOrigin: "https://chat.test", now: NOW, log: () => {} };
  assert.deepEqual(await startIntegration({ integration: "google_search_console" }, d), { status: 200, body: { mode: "branded", url: "https://accounts.google.test/o" } });
  const back = new URL((tools.bodies[0] as { return_url: string }).return_url);
  assert.equal(back.pathname, RETURN_PATH);
  const s = readConnectState(RING, back.searchParams.get("state"), NOW);
  assert.equal(s?.product, "arrowsterr");
  assert.equal(returnView(s!, { aw_status: "connected", integration: "google_search_console" }).kind, "connected");
  assert.equal((await startIntegration({ integration: "nope" }, d)).status, 400);
  assert.equal((await startIntegration({ integration: "google_search_console" }, { ...d, gate: gateAs("u1", { [WS]: "editor" }) })).status, 403);
  assert.deepEqual(await startIntegration({ integration: "google_search_console" }, { ...d, tools: () => ({ ok: true as const, client: fakeTools({ list: no(404) }).client }) }), { status: 503, body: { error: RETURN_MESSAGES.toolsNotOpen } });
  assert.deepEqual(await listIntegrations({ ...d, tools: () => ({ ok: true as const, client: fakeTools({ list: no(404) }).client }) }), { status: 200, body: { mode: "off", integrations: [] } });
  assert.equal((await listIntegrations(d)).body.mode, "branded");
});

// ─────────────── the screens ───────────────

const src = (f: string) => readFileSync(new URL(`../src/components/${f}`, import.meta.url), "utf8");

test("the chat's connect card and Home's Finish setup open our own chooser of networks", () => {
  const cards = src("Cards.tsx");
  assert.match(cards, /card\.app === "social" \? \([\s\S]{0,200}<NetworkChooser/, "the social card shows the chooser");
  assert.match(cards, /from=\{\{ to: "chat", thread: env\.threadId/, "and says it started from this chat");
  assert.match(cards, /is connected\. Please carry on\./, "and the chat carries on");
  assert.doesNotMatch(cards, /connect-link/);
  const home = src("Home.tsx");
  assert.match(home, /onSocial=\{\(\) => setChooser\(true\)\}/, "Finish setup's social row opens the chooser");
  assert.match(home, /<NetworkChooserSheet[^>]*open=\{chooser\}/);
  assert.doesNotMatch(home, /connect-link|useConnect\b/);
  assert.deepEqual(finishSetup({ canConnect: true, socialAccounts: 0, connected: [], connectable: [], wordpress: false })[0].connect, { kind: "social" });
  const social = src("Social.tsx");
  assert.match(social, /function NetworkChooserSheet[\s\S]{0,400}from=\{\{ to: "home" \}\}/, "Home's sheet says it started from Home");
  assert.match(social, /openIn\(mode, from\)/, "the chooser opens a tab or goes there by the pure rule");
  assert.doesNotMatch(social, /\/api\/social\/connect-link/, "only the start route, which falls back by itself");
  const apps = src("Apps.tsx");
  assert.match(apps, /\{admin \? <ToolsSection/, "Settings, Apps lists SEO tools like Cloudflare for owners and admins");
  assert.match(apps, /start\(t\.id, "branded", \{ to: "settings" \}, TOOLS_PRODUCT\)/);
  assert.equal(TOOLS.cloudflare.logo, "/img/tools/cloudflare.svg");
  assert.ok(readFileSync(new URL("../public/img/tools/cloudflare.svg", import.meta.url), "utf8").length < 2000);
  const app = src("App.tsx");
  assert.match(app, /route\.page === "socialReturn" \? \(\s*<SocialReturn/);
});
