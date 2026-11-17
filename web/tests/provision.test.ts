// The provision job (src/lib/provision.ts) and the job runner (src/lib/jobs.ts) with fake partners, a fake services
// table and a test sealing key. Nothing reaches Arrowsterr, Capybaroar or Supabase.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { BACKOFF_MS, backoffMs, runJob, type Handler, type Job } from "../src/lib/jobs.ts";
import { PRODUCTS, type Brand, type Partner, type PartnerFailure, type Product } from "../src/lib/partner.ts";
import { domainOf, errorLine, keyAad, provision, type ServicePatch, type ServiceStatus } from "../src/lib/provision.ts";
import { openWith, sealWith, type Keyring } from "../src/lib/sealing.ts";
import { setupCard } from "../src/lib/setupStatus.ts";

const ring: Keyring = { current: "t1", keys: new Map([["t1", randomBytes(32)]]) };
const WS = { id: "7b1f3c9e-0000-4000-8000-000000000001", name: "Ana's Bakery", website: "https://www.anasbakery.com/menu" };

/** A product's partner API in memory: brands by external_id, every key it ever made, and a switch to make it fail. */
function fakeProduct(product: Product) {
  const brands: Brand[] = [];
  const keys: { brand: string; key: string; revoked: boolean }[] = [];
  const calls: string[] = [];
  let down: PartnerFailure | null = null;
  const partner: Partner = {
    product,
    async createBrand(input) {
      calls.push("createBrand");
      if (down) return down;
      const had = brands.find((b) => b.external_id === input.external_id);
      if (had) return { ok: true, status: 200, data: had };
      const b = { id: `${product}-brand-${brands.length + 1}`, ...input };
      brands.push(b);
      return { ok: true, status: 201, data: b };
    },
    async createKey(brand) {
      calls.push("createKey");
      if (down) return down;
      const key = `${product === "arrowsterr" ? "aw" : "cbr"}_brand_${randomBytes(8).toString("hex")}`;
      keys.push({ brand, key, revoked: false });
      return { ok: true, status: 201, data: { key, prefix: key.slice(0, 14) } };
    },
    async revokeKeys(brand) {
      calls.push("revokeKeys");
      if (down) return down;
      for (const k of keys) if (k.brand === brand) k.revoked = true;
      return { ok: true, status: 204, data: null };
    },
    async removeBrand() {
      return { ok: false, status: 404, code: "not_found", message: "Not used here.", retryable: false };
    },
    async connectLink() {
      return { ok: false, status: 404, code: "not_found", message: "Not used here.", retryable: false };
    },
  };
  return { partner, brands, keys, calls, setDown: (f: PartnerFailure | null) => void (down = f) };
}

const UNAVAILABLE: PartnerFailure = { ok: false, status: 503, code: "unavailable", message: "Down for a bit.", retryable: true };

type Row = { status: ServiceStatus; brand_id?: string | null; sealed_key?: string | null; key_prefix?: string | null; last_error?: string | null };

function world(o: { missing?: Product[] } = {}) {
  const products = { arrowsterr: fakeProduct("arrowsterr"), capybaroar: fakeProduct("capybaroar") };
  const services = new Map<Product, Row>(PRODUCTS.map((p) => [p, { status: "pending" }]));
  let crashOnSave: Product | null = null;
  const saves: { product: Product; patch: ServicePatch }[] = [];
  const deps = {
    workspace: async () => WS,
    services: async () => [...services].map(([product, r]) => ({ product, status: r.status })),
    partner: (p: Product) =>
      o.missing?.includes(p) ? { ok: false as const, error: `${p === "arrowsterr" ? "Arrowsterr" : "Capybaroar"} partner key is not set on the server.` } : { ok: true as const, partner: products[p].partner },
    seal: (plain: string, aad: string) => sealWith(ring, plain, aad),
    save: async (product: Product, patch: ServicePatch) => {
      if (crashOnSave === product) {
        crashOnSave = null;
        throw new Error("connection reset");
      }
      saves.push({ product, patch });
      services.set(product, { ...services.get(product)!, ...patch });
    },
  };
  return { products, services, saves, deps, crashNextSave: (p: Product) => void (crashOnSave = p) };
}

const job = (o: Partial<Job> = {}): Job => ({ id: 1, kind: "provision", workspace_id: WS.id, payload: {}, attempts: 1, max_attempts: 5, ...o });

test("both products end ready, with sealed keys that open only with the right workspace and product", async () => {
  const w = world();
  const { result } = await provision(w.deps);
  assert.deepEqual(result, { status: "done" });
  for (const p of PRODUCTS) {
    const row = w.services.get(p)!;
    const made = w.products[p].keys[0];
    assert.equal(row.status, "ready");
    assert.equal(row.brand_id, `${p}-brand-1`);
    assert.equal(row.last_error, null);
    assert.equal(row.key_prefix, made.key.slice(0, 14));
    assert.notEqual(row.sealed_key, made.key);
    assert.ok(!row.sealed_key!.includes(made.key));
    assert.equal(openWith(ring, row.sealed_key!, `${WS.id}:${p}`), made.key);
    assert.equal(keyAad(WS.id, p), `${WS.id}:${p}`);
    const other = PRODUCTS.find((x) => x !== p)!;
    assert.throws(() => openWith(ring, row.sealed_key!, `${WS.id}:${other}`));
    assert.throws(() => openWith(ring, row.sealed_key!, `another-workspace:${p}`));
  }
  // The brand is made with the workspace's name, its bare domain and its id as external_id.
  assert.deepEqual(w.products.arrowsterr.brands[0], { id: "arrowsterr-brand-1", name: "Ana's Bakery", domain: "anasbakery.com", external_id: WS.id });
});

test("a retry after a crash makes no second brand, and the unsaved key is revoked", async () => {
  const w = world();
  w.crashNextSave("arrowsterr");
  await assert.rejects(provision(w.deps), /connection reset/);
  // Capybaroar finished. Arrowsterr made a brand and a key, but the key was never saved.
  assert.equal(w.services.get("capybaroar")!.status, "ready");
  assert.equal(w.services.get("arrowsterr")!.status, "pending");
  assert.equal(w.products.arrowsterr.keys.length, 1);

  const out = await runJob(job({ attempts: 2 }), { provision: async () => (await provision(w.deps)).result }, { now: () => new Date(), alert: () => assert.fail("no alert") });
  assert.equal(out.outcome, "done");
  assert.equal(w.products.arrowsterr.brands.length, 1);
  assert.equal(w.products.capybaroar.brands.length, 1);
  // The second run didn't touch Capybaroar, which was already ready.
  assert.deepEqual(w.products.capybaroar.calls, ["createBrand", "createKey"]);
  assert.deepEqual(w.products.arrowsterr.calls, ["createBrand", "createKey", "createBrand", "revokeKeys", "createKey"]);
  const live = w.products.arrowsterr.keys.filter((k) => !k.revoked);
  assert.equal(live.length, 1);
  assert.equal(openWith(ring, w.services.get("arrowsterr")!.sealed_key!, `${WS.id}:arrowsterr`), live[0].key);
});

test("one product down leaves the other ready and plans a retry; the next run finishes it", async () => {
  const w = world();
  w.products.capybaroar.setDown(UNAVAILABLE);
  const t0 = new Date("2026-11-17T10:00:00Z");
  const handlers: Record<string, Handler> = { provision: async () => (await provision(w.deps)).result };
  const first = await runJob(job({ attempts: 1 }), handlers, { now: () => t0, alert: () => assert.fail("no alert") });
  assert.equal(first.outcome, "retry");
  assert.equal(first.patch.run_at, "2026-11-17T10:01:00.000Z");
  assert.equal(first.patch.last_error, "Capybaroar had a server problem (503).");
  assert.equal(w.services.get("arrowsterr")!.status, "ready");
  assert.deepEqual(w.services.get("capybaroar"), { status: "failed", last_error: "Capybaroar had a server problem (503)." });

  w.products.capybaroar.setDown(null);
  const second = await runJob(job({ attempts: 2 }), handlers, { now: () => t0, alert: () => assert.fail("no alert") });
  assert.equal(second.outcome, "done");
  assert.equal(w.services.get("capybaroar")!.status, "ready");
  assert.equal(w.services.get("capybaroar")!.last_error, null);
  assert.equal(w.products.arrowsterr.brands.length, 1);
  assert.equal(w.products.arrowsterr.calls.length, 2, "Arrowsterr was not called again");
});

test("a product that stays down gives up after max_attempts, stays failed and alerts once", async () => {
  const w = world();
  w.products.arrowsterr.setDown({ ok: false, status: 0, code: "timeout", message: "No answer in time.", retryable: true });
  const alerts: string[] = [];
  const handlers: Record<string, Handler> = { provision: async () => (await provision(w.deps)).result };
  const now = new Date("2026-11-17T10:00:00Z");
  const waits: number[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const out = await runJob(job({ attempts: attempt }), handlers, { now: () => now, alert: (m) => void alerts.push(m) });
    if (attempt < 5) {
      assert.equal(out.outcome, "retry");
      waits.push(new Date(out.patch.run_at!).getTime() - now.getTime());
    } else {
      assert.equal(out.outcome, "failed");
      assert.equal(out.patch.attempts, 5);
      assert.match(out.patch.last_error!, /^Gave up after 5 tries\. Arrowsterr did not answer in time\.$/);
    }
  }
  assert.deepEqual(waits, [60_000, 300_000, 1_800_000, 7_200_000]);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], new RegExp(`Job 1 \\(provision, workspace ${WS.id}\\) failed: Gave up after 5 tries`));
  assert.equal(w.services.get("arrowsterr")!.status, "failed");
  assert.equal(w.services.get("capybaroar")!.status, "ready");
});

test("a missing partner key marks that product failed with the message, and the job doesn't retry", async () => {
  const w = world({ missing: ["arrowsterr"] });
  const alerts: string[] = [];
  const out = await runJob(job({ attempts: 1 }), { provision: async () => (await provision(w.deps)).result }, { now: () => new Date(), alert: (m) => void alerts.push(m) });
  assert.equal(out.outcome, "failed");
  assert.equal(out.patch.attempts, 5, "used up, so claim_jobs never takes it again");
  assert.equal(out.patch.last_error, "Arrowsterr partner key is not set on the server.");
  assert.deepEqual(w.services.get("arrowsterr"), { status: "failed", last_error: "Arrowsterr partner key is not set on the server." });
  assert.equal(w.services.get("capybaroar")!.status, "ready");
  assert.equal(w.products.arrowsterr.calls.length, 0);
  assert.equal(alerts.length, 1);
});

test("a key that turns us down (401) doesn't retry; a sealing problem doesn't either", async () => {
  const w = world();
  w.products.capybaroar.setDown({ ok: false, status: 401, code: "bad_key", message: "Bad key.", retryable: false });
  assert.deepEqual((await provision(w.deps)).result, { status: "failed", error: "Capybaroar did not accept our partner key." });

  const s = world();
  s.deps.seal = () => {
    throw new Error("SEALING_KEYS is not set. Add kid:base64 with a 32-byte key.");
  };
  const r = await provision(s.deps);
  assert.equal(r.result.status, "failed");
  assert.equal(s.services.get("arrowsterr")!.last_error, "The server can't seal brand keys. Check SEALING_KEYS.");
  assert.equal(s.services.get("arrowsterr")!.brand_id, "arrowsterr-brand-1", "the brand id is kept for the next try");
});

test("ready, removing and removed products are left alone; a deleted workspace is done", async () => {
  const w = world();
  w.services.set("arrowsterr", { status: "ready", brand_id: "kept" });
  w.services.set("capybaroar", { status: "removing" });
  assert.deepEqual((await provision(w.deps)).result, { status: "done" });
  assert.equal(w.saves.length, 0);
  assert.equal(w.products.arrowsterr.calls.length + w.products.capybaroar.calls.length, 0);

  const gone = world();
  gone.deps.workspace = async () => null as never;
  assert.deepEqual((await provision(gone.deps)).result, { status: "done" });
  assert.equal(gone.saves.length, 0);
});

test("backoff: 1 minute, 5 minutes, 30 minutes, 2 hours, then 6 hours", () => {
  assert.deepEqual([...BACKOFF_MS], [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(backoffMs), [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 21_600_000, 21_600_000]);
  assert.equal(backoffMs(0), 60_000);
});

test("runJob: an unknown kind fails clearly; a throw is a hiccup; done clears the error", async () => {
  const alerts: string[] = [];
  const o = { now: () => new Date("2026-11-17T10:00:00Z"), alert: (m: string) => void alerts.push(m) };
  const unknown = await runJob(job({ kind: "send_rockets", attempts: 1 }), {}, o);
  assert.equal(unknown.outcome, "failed");
  assert.equal(unknown.patch.last_error, 'Unknown job kind "send_rockets".');
  assert.equal(alerts.length, 1);
  // Names on Object.prototype are not handlers either.
  assert.equal((await runJob(job({ kind: "toString" }), {}, o)).outcome, "failed");

  const threw = await runJob(job({ attempts: 2 }), { provision: async () => { throw new Error("socket hang up"); } }, o);
  assert.deepEqual(threw, { outcome: "retry", error: "socket hang up", patch: { run_at: "2026-11-17T10:05:00.000Z", locked_until: null, last_error: "socket hang up" } });

  const done = await runJob(job(), { provision: async () => ({ status: "done" }) }, o);
  assert.deepEqual(done, { outcome: "done", patch: { done_at: "2026-11-17T10:00:00.000Z", locked_until: null, last_error: null } });

  // An alert that throws doesn't stop the row from being saved.
  const broken = await runJob(job({ kind: "nope" }), {}, { now: o.now, alert: () => { throw new Error("Sentry is down"); } });
  assert.equal(broken.outcome, "failed");
});

test("errorLine is one short plain line per kind of failure", () => {
  const f = (status: number, code = `c${status}`, message = "m"): PartnerFailure => ({ ok: false, status, code, message, retryable: false });
  assert.equal(errorLine("arrowsterr", f(0, "timeout")), "Arrowsterr did not answer in time.");
  assert.equal(errorLine("arrowsterr", f(0, "network")), "Could not reach Arrowsterr.");
  assert.equal(errorLine("capybaroar", f(429)), "Capybaroar asked us to slow down.");
  assert.equal(errorLine("capybaroar", f(500)), "Capybaroar had a server problem (500).");
  assert.equal(errorLine("arrowsterr", f(403)), "Arrowsterr says this brand belongs to another partner.");
  assert.equal(errorLine("arrowsterr", f(422, "invalid", "Name is too long.")), "Arrowsterr turned down the request (422): Name is too long.");
  assert.ok(errorLine("arrowsterr", f(422, "x", "y".repeat(2000))).length <= 300);
});

test("domainOf keeps only the bare domain", () => {
  assert.equal(domainOf("https://www.AnasBakery.com/menu?x=1"), "anasbakery.com");
  assert.equal(domainOf("anasbakery.com"), "anasbakery.com");
  assert.equal(domainOf("shop.example.co.uk:8080/a"), "shop.example.co.uk");
  assert.equal(domainOf(""), null);
  assert.equal(domainOf(null), null);
  assert.equal(domainOf("not a site"), null);
});

test("the Home card: working while pending, a calm problem line when failed, nothing when ready", () => {
  assert.equal(setupCard([]), null);
  assert.equal(setupCard([{ status: "ready" }, { status: "ready" }]), null);
  assert.equal(setupCard([{ status: "ready" }, { status: "pending" }])?.title, "Setting up SEO and social");
  const problem = setupCard([{ status: "failed" }, { status: "pending" }]);
  assert.equal(problem?.title, "We're fixing a setup problem");
  assert.equal(problem?.tone, "problem");
  for (const c of [setupCard([{ status: "pending" }])!, problem!, setupCard([{ status: "waiting" }, { status: "ready" }])!]) {
    for (const s of [c.title, c.text]) {
      assert.doesNotMatch(s, /[–—]/);
      assert.doesNotMatch(s, /error|partner|key|503|Arrowsterr|Capybaroar/i, "no raw errors or product names");
      for (const sentence of s.split(/[.!?]\s*/).filter(Boolean)) assert.ok(sentence.split(/\s+/).length <= 14, `short sentences: ${sentence}`);
    }
  }
});

// ─────────────── the website gate and partner 409s ───────────────

test("no website: Arrowsterr waits with no call and no error, Capybaroar is made with no domain, the job is done", async () => {
  for (const website of [null, "", "not a site"]) {
    const w = world();
    w.deps.workspace = async () => ({ ...WS, website });
    const { result, products } = await provision(w.deps);
    assert.deepEqual(result, { status: "done" }, String(website));
    assert.deepEqual(products.map((p) => [p.product, p.status]), [["arrowsterr", "waiting"], ["capybaroar", "ready"]]);
    assert.deepEqual(w.services.get("arrowsterr"), { status: "waiting", last_error: null });
    assert.deepEqual(w.products.arrowsterr.calls, []);
    assert.equal(w.products.capybaroar.brands[0].domain, null);
    // The Home card asks for the website, with a way to Settings.
    const card = setupCard([...w.services.values()]);
    assert.deepEqual(card, { tone: "action", title: "Add your website to turn on SEO", text: "Add your website in Settings to turn on SEO.", action: { label: "Open Settings", path: "/settings" } });
  }
});

test("once the website is added, the next provision makes the Arrowsterr brand and leaves Capybaroar alone", async () => {
  const w = world();
  let website: string | null = null;
  w.deps.workspace = async () => ({ ...WS, website });
  await provision(w.deps);
  website = "anasbakery.com";
  // 009_website_gate.sql sets the waiting service pending and queues provision.
  w.services.set("arrowsterr", { status: "pending" });
  assert.deepEqual((await provision(w.deps)).result, { status: "done" });
  assert.equal(w.services.get("arrowsterr")!.status, "ready");
  assert.equal(w.products.arrowsterr.brands[0].domain, "anasbakery.com");
  assert.deepEqual(w.products.capybaroar.calls, ["createBrand", "createKey"], "Capybaroar only once");
  assert.equal(setupCard([...w.services.values()]), null);
});

test("Arrowsterr 409 domain_taken fails with a plain line and isn't retried; the alert says why", async () => {
  const w = world();
  w.products.arrowsterr.setDown({ ok: false, status: 409, code: "domain_taken", message: "Another brand in this workspace already tracks anasbakery.com.", retryable: false });
  const alerts: string[] = [];
  const out = await runJob(job({ attempts: 1 }), { provision: async () => (await provision(w.deps)).result }, { now: () => new Date(), alert: (m) => void alerts.push(m) });
  assert.equal(out.outcome, "failed");
  assert.equal(out.patch.attempts, 5, "not retried");
  const line = "Another customer already tracks this website in SEO. We'll sort it out.";
  assert.deepEqual(w.services.get("arrowsterr"), { status: "failed", last_error: line });
  assert.equal(w.services.get("capybaroar")!.status, "ready");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /already tracks this website/);
  // The customer sees only the calm problem card.
  assert.equal(setupCard([...w.services.values()])?.title, "We're fixing a setup problem");
});

test("Capybaroar 409 conflict retries; 409 plan_limit fails for staff; Arrowsterr 403 and 404 fail too", async () => {
  const conflict = world();
  conflict.products.capybaroar.setDown({ ok: false, status: 409, code: "conflict", message: "A brand with this external_id is being made. Try again.", retryable: true });
  assert.equal((await provision(conflict.deps)).result.status, "retry");

  const full = world();
  full.products.capybaroar.setDown({ ok: false, status: 409, code: "plan_limit", message: "Your plan allows 50 brands.", retryable: false });
  const r = await provision(full.deps);
  assert.deepEqual(r.result, { status: "failed", error: "Our Capybaroar partner plan is full. Raise its limit, then run provision again." });

  for (const [status, code, line] of [
    [403, "not_your_brand", "Arrowsterr says this brand belongs to another partner."],
    [404, "not_found", "Arrowsterr could not find the brand."],
  ] as const) {
    const w = world();
    w.products.arrowsterr.setDown({ ok: false, status, code, message: "x", retryable: false });
    assert.deepEqual((await provision(w.deps)).result, { status: "failed", error: line });
  }
});
