// Closing brands on cancel and delete (src/lib/closeout.ts) with a fake partner per product, fake services and a fake
// jobs table. The provision job and the job runner are the real ones. Nothing reaches Arrowsterr, Capybaroar or Supabase.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  BRAND_JOB_ATTEMPTS,
  closeServices,
  planAction,
  REMOVE_AFTER_DAYS,
  removeBrandJob,
  reopenServices,
  revokeKeysJob,
  type BrandJobDeps,
  type NewJob,
  type ServiceRow,
} from "../src/lib/closeout.ts";
import { runJob, type Job } from "../src/lib/jobs.ts";
import { PRODUCTS, type Brand, type Partner, type PartnerFailure, type Product } from "../src/lib/partner.ts";
import { provision, type ServiceStatus } from "../src/lib/provision.ts";
import { sealWith, type Keyring } from "../src/lib/sealing.ts";

const WS = "7b1f3c9e-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-11-17T10:00:00.000Z");
const ring: Keyring = { current: "t1", keys: new Map([["t1", randomBytes(32)]]) };
const UNAVAILABLE: PartnerFailure = { ok: false, status: 503, code: "unavailable", message: "Down for a bit.", retryable: true };
const NOT_FOUND: PartnerFailure = { ok: false, status: 404, code: "not_found", message: "No such brand.", retryable: false };
const FORBIDDEN: PartnerFailure = { ok: false, status: 403, code: "forbidden", message: "Not your brand.", retryable: false };

/** One product's partner API in memory: brands, keys, and a switch per call to make it fail. */
function fakeProduct(product: Product) {
  const brands: Brand[] = [];
  const keys: { brand: string; key: string; revoked: boolean }[] = [];
  const calls: string[] = [];
  const down: Partial<Record<"createBrand" | "createKey" | "revokeKeys" | "removeBrand", PartnerFailure>> = {};
  const has = (id: string) => brands.some((b) => b.id === id);
  const partner: Partner = {
    product,
    async createBrand(input) {
      calls.push("createBrand");
      if (down.createBrand) return down.createBrand;
      const had = brands.find((b) => b.external_id === input.external_id);
      if (had) return { ok: true, status: 200, data: had };
      const b = { id: `${product}-b${brands.length + 1}`, ...input };
      brands.push(b);
      return { ok: true, status: 201, data: b };
    },
    async createKey(brand) {
      calls.push("createKey");
      if (down.createKey) return down.createKey;
      if (!has(brand)) return NOT_FOUND;
      const key = `${product}_brand_${randomBytes(6).toString("hex")}`;
      keys.push({ brand, key, revoked: false });
      return { ok: true, status: 201, data: { key, prefix: key.slice(0, 12) } };
    },
    async revokeKeys(brand) {
      calls.push(`revokeKeys ${brand}`);
      if (down.revokeKeys) return down.revokeKeys;
      if (!has(brand)) return NOT_FOUND;
      for (const k of keys) if (k.brand === brand) k.revoked = true;
      return { ok: true, status: 204, data: null };
    },
    async removeBrand(brand) {
      calls.push(`removeBrand ${brand}`);
      if (down.removeBrand) return down.removeBrand;
      if (!has(brand)) return NOT_FOUND;
      brands.splice(brands.findIndex((b) => b.id === brand), 1);
      for (const k of keys) if (k.brand === brand) k.revoked = true;
      return { ok: true, status: 204, data: null };
    },
    async connectLink() {
      return NOT_FOUND;
    },
  };
  const live = () => keys.filter((k) => !k.revoked);
  return { partner, brands, keys, calls, down, live };
}

type Svc = { status: ServiceStatus; brand_id: string | null; sealed_key: string | null; key_prefix: string | null; last_error: string | null };
type JobRow = NewJob & { id: number; attempts: number; max_attempts: number; done_at: string | null; last_error: string | null };

/** A workspace with both brands ready, made by the real provision job. */
async function world() {
  const products = { arrowsterr: fakeProduct("arrowsterr"), capybaroar: fakeProduct("capybaroar") };
  const services = new Map<Product, Svc>(PRODUCTS.map((p) => [p, { status: "pending", brand_id: null, sealed_key: null, key_prefix: null, last_error: null }]));
  const jobs: JobRow[] = [];
  const logs: string[] = [];
  let clock = NOW;
  let deleted = false;
  const partner = (p: Product) => ({ ok: true as const, partner: products[p].partner });
  const rows = async (): Promise<ServiceRow[]> => (deleted ? [] : [...services].map(([product, s]) => ({ product, status: s.status, brand_id: s.brand_id })));
  const queue = async (list: NewJob[]) => {
    for (const j of list) jobs.push({ ...j, id: jobs.length + 1, attempts: 0, max_attempts: j.max_attempts ?? 5, done_at: null, last_error: null });
  };
  const runProvision = () =>
    provision({
      workspace: async () => (deleted ? null : { id: WS, name: "Ana's Bakery", website: "anasbakery.com" }),
      services: async () => (await rows()).map(({ product, status }) => ({ product, status })),
      partner,
      seal: (plain, aad) => sealWith(ring, plain, aad),
      save: async (product, patch) => void services.set(product, { ...services.get(product)!, ...patch }),
    });
  await runProvision();
  const close = () =>
    closeServices(WS, {
      services: rows,
      partner,
      mark: async (product, patch) => void services.set(product, { ...services.get(product)!, ...patch }),
      queue,
      now: () => clock,
      log: (m) => void logs.push(m),
    });
  const reopen = () =>
    reopenServices(WS, {
      services: rows,
      cancelJobs: async (kinds, reason) => {
        const hit = jobs.filter((j) => j.workspace_id === WS && kinds.includes(j.kind) && !j.done_at);
        for (const j of hit) Object.assign(j, { done_at: clock.toISOString(), last_error: reason });
        return hit.length;
      },
      reset: async (product) => void services.set(product, { ...services.get(product)!, status: "pending", last_error: null }),
      queue,
      now: () => clock,
    });
  const brandDeps: BrandJobDeps = {
    partner,
    service: async (ws, product) => (deleted || ws !== WS ? null : { product, status: services.get(product)!.status, brand_id: services.get(product)!.brand_id }),
    markRemoved: async (ws, product, brandId) => {
      const s = services.get(product)!;
      if (!deleted && ws === WS && s.brand_id === brandId && s.status === "removing") services.set(product, { ...s, status: "removed", sealed_key: null, key_prefix: null });
    },
  };
  const handlers = { revoke_keys: (j: Job) => revokeKeysJob(j, brandDeps), remove_brand: (j: Job) => removeBrandJob(j, brandDeps), provision: async () => (await runProvision()).result };
  /** Runs every job that is due, the way the worker does (claim counts the attempt, then runJob). */
  const tick = async () => {
    const due = jobs.filter((j) => !j.done_at && j.run_at <= clock.toISOString() && j.attempts < j.max_attempts);
    const out: string[] = [];
    for (const j of due) {
      j.attempts++;
      const r = await runJob({ id: j.id, kind: j.kind, workspace_id: deleted ? null : j.workspace_id, payload: j.payload, attempts: j.attempts, max_attempts: j.max_attempts }, handlers, { now: () => clock, alert: (m) => void logs.push(m) });
      Object.assign(j, r.patch);
      out.push(`${j.kind} ${r.outcome}`);
    }
    return out;
  };
  return {
    products,
    services,
    jobs,
    logs,
    close,
    reopen,
    tick,
    brandDeps,
    pending: () => jobs.filter((j) => !j.done_at && j.attempts < j.max_attempts).map((j) => `${j.kind} ${String(j.payload.product ?? "")}`.trim()),
    advance: (ms: number) => void (clock = new Date(clock.getTime() + ms)),
    deleteWorkspace: () => void (deleted = true),
  };
}

const DAYS = (n: number) => n * 86_400_000;

test("close: every brand key is revoked at once, services go removing, and removal is queued for 30 days later", async () => {
  const w = await world();
  for (const p of PRODUCTS) assert.equal(w.services.get(p)!.status, "ready");
  assert.equal(w.products.arrowsterr.live().length, 1);

  const out = await w.close();
  const removeAt = new Date(NOW.getTime() + DAYS(REMOVE_AFTER_DAYS)).toISOString();
  assert.deepEqual(out, [
    { product: "arrowsterr", revoked: true, removeAt },
    { product: "capybaroar", revoked: true, removeAt },
  ]);
  for (const p of PRODUCTS) {
    assert.equal(w.products[p].live().length, 0, `${p} keys revoked`);
    assert.equal(w.products[p].brands.length, 1, `${p} brand kept for now`);
    const s = w.services.get(p)!;
    assert.deepEqual([s.status, s.sealed_key, s.key_prefix], ["removing", null, null]);
  }
  assert.deepEqual(w.jobs.map((j) => [j.kind, j.payload, j.run_at, j.max_attempts]), [
    ["remove_brand", { product: "arrowsterr", brand_id: "arrowsterr-b1", workspace_id: WS }, removeAt, BRAND_JOB_ATTEMPTS],
    ["remove_brand", { product: "capybaroar", brand_id: "capybaroar-b1", workspace_id: WS }, removeAt, BRAND_JOB_ATTEMPTS],
  ]);
  // Closing twice (a resent webhook) changes nothing.
  assert.deepEqual(await w.close(), []);
  assert.equal(w.jobs.length, 2);
});

test("delete: the brands are removed 30 days later even though the workspace is gone", async () => {
  const w = await world();
  await w.close();
  w.deleteWorkspace();
  w.advance(DAYS(29));
  assert.deepEqual(await w.tick(), [], "nothing is due before 30 days");
  w.advance(DAYS(1));
  assert.deepEqual(await w.tick(), ["remove_brand done", "remove_brand done"]);
  for (const p of PRODUCTS) assert.equal(w.products[p].brands.length, 0, `${p} brand removed`);
  assert.deepEqual(w.pending(), []);
});

test("cancel: after 30 days the brands are removed and the services say removed", async () => {
  const w = await world();
  await w.close();
  w.advance(DAYS(30));
  assert.deepEqual(await w.tick(), ["remove_brand done", "remove_brand done"]);
  for (const p of PRODUCTS) {
    assert.equal(w.products[p].brands.length, 0);
    assert.equal(w.services.get(p)!.status, "removed");
  }
});

test("a partner outage never blocks the close: the revoke is queued, retried, and done when it's back", async () => {
  const w = await world();
  w.products.capybaroar.down.revokeKeys = UNAVAILABLE;
  const out = await w.close();
  assert.deepEqual(out.map((o) => [o.product, o.revoked]), [["arrowsterr", true], ["capybaroar", false]]);
  assert.equal(w.services.get("capybaroar")!.status, "removing", "marked removing either way");
  assert.deepEqual(w.pending(), ["remove_brand arrowsterr", "revoke_keys capybaroar", "remove_brand capybaroar"]);
  assert.match(w.logs[0], /Capybaroar had a server problem \(503\)\. Queued to try again\./);
  assert.equal(w.products.capybaroar.live().length, 1, "the key still works until the retry");

  // The worker runs it right away: still down, so it waits a minute and tries again.
  assert.deepEqual(await w.tick(), ["revoke_keys retry"]);
  const retry = w.jobs.find((j) => j.kind === "revoke_keys")!;
  assert.equal(retry.run_at, new Date(NOW.getTime() + 60_000).toISOString());
  assert.match(String(retry.last_error), /503/);
  delete w.products.capybaroar.down.revokeKeys;
  w.advance(60_000);
  assert.deepEqual(await w.tick(), ["revoke_keys done"]);
  assert.equal(w.products.capybaroar.live().length, 0);
});

test("a missing partner key at close time queues the revoke too", async () => {
  const w = await world();
  const out = await closeServices(WS, {
    services: async () => [{ product: "arrowsterr", status: "ready", brand_id: "aw-1" }],
    partner: () => ({ ok: false, error: "Arrowsterr partner key is not set on the server." }),
    mark: async () => {},
    queue: async (jobs) => void w.jobs.push(...jobs.map((j, i) => ({ ...j, id: 100 + i, attempts: 0, max_attempts: 5, done_at: null, last_error: null }))),
    now: () => NOW,
    log: () => {},
  });
  assert.deepEqual(out.map((o) => o.revoked), [false]);
  assert.deepEqual(w.jobs.filter((j) => j.id >= 100).map((j) => j.kind), ["revoke_keys", "remove_brand"]);
});

test("close: a service that never got a brand is marked removed with no partner call", async () => {
  const marks: [Product, string][] = [];
  const queued: NewJob[] = [];
  let called = false;
  const out = await closeServices(WS, {
    services: async () => [
      { product: "arrowsterr", status: "pending", brand_id: null },
      { product: "capybaroar", status: "failed", brand_id: null },
    ],
    partner: () => {
      called = true;
      return { ok: false, error: "x" };
    },
    mark: async (p, patch) => void marks.push([p, patch.status]),
    queue: async (j) => void queued.push(...j),
    now: () => NOW,
    log: () => {},
  });
  assert.equal(called, false);
  assert.deepEqual(queued, []);
  assert.deepEqual(marks, [["arrowsterr", "removed"], ["capybaroar", "removed"]]);
  assert.deepEqual(out.map((o) => o.removeAt), [null, null]);
});

test("come back within 30 days: removal is canceled, the same brands stay, and fresh keys are made", async () => {
  const w = await world();
  w.products.arrowsterr.down.revokeKeys = UNAVAILABLE;
  await w.close();
  delete w.products.arrowsterr.down.revokeKeys;
  w.advance(DAYS(10));

  const r = await w.reopen();
  assert.deepEqual(r, { reopened: ["arrowsterr", "capybaroar"], canceled: 3 });
  assert.deepEqual(w.pending(), ["provision"], "revoke_keys and both remove_brand jobs are canceled");
  for (const j of w.jobs.filter((x) => x.kind !== "provision")) assert.equal(j.last_error, "Canceled: the subscription came back.");
  for (const p of PRODUCTS) assert.equal(w.services.get(p)!.status, "pending");

  assert.deepEqual(await w.tick(), ["provision done"]);
  for (const p of PRODUCTS) {
    const s = w.services.get(p)!;
    assert.equal(s.status, "ready");
    assert.equal(s.brand_id, `${p}-b1`, "the same brand as before");
    assert.ok(s.sealed_key);
    assert.equal(w.products[p].brands.length, 1);
    assert.equal(w.products[p].live().length, 1, "one fresh key; the old one is revoked");
    assert.ok(w.products[p].keys.length >= 2);
  }
  // 30 days later nothing is removed.
  w.advance(DAYS(30));
  assert.deepEqual(await w.tick(), []);
  for (const p of PRODUCTS) assert.equal(w.products[p].brands.length, 1);
  // Reopening again does nothing.
  assert.deepEqual(await w.reopen(), { reopened: [], canceled: 0 });
});

test("brand jobs leave a brand alone that the workspace uses again", async () => {
  const w = await world();
  const job = (kind: string): Job => ({ id: 9, kind, workspace_id: WS, payload: { product: "arrowsterr", brand_id: "arrowsterr-b1", workspace_id: WS }, attempts: 1, max_attempts: 12 });
  assert.deepEqual(await revokeKeysJob(job("revoke_keys"), w.brandDeps), { status: "done" });
  assert.deepEqual(await removeBrandJob(job("remove_brand"), w.brandDeps), { status: "done" });
  assert.deepEqual(w.products.arrowsterr.calls.filter((c) => /revoke|remove/.test(c)), [], "no partner call");
  assert.equal(w.products.arrowsterr.live().length, 1);
});

test("remove_brand: 404 counts as done, a hiccup retries, and a refusal fails for staff to see", async () => {
  const w = await world();
  await w.close();
  w.deleteWorkspace();
  const job = (product: Product, brand: string): Job => ({ id: 1, kind: "remove_brand", workspace_id: null, payload: { product, brand_id: brand, workspace_id: WS }, attempts: 1, max_attempts: 12 });

  assert.deepEqual(await removeBrandJob(job("arrowsterr", "arrowsterr-gone"), w.brandDeps), { status: "done" }, "404: already gone");
  w.products.capybaroar.down.removeBrand = UNAVAILABLE;
  assert.deepEqual(await removeBrandJob(job("capybaroar", "capybaroar-b1"), w.brandDeps), { status: "retry", error: "Capybaroar had a server problem (503)." });
  w.products.capybaroar.down.removeBrand = FORBIDDEN;
  assert.deepEqual(await removeBrandJob(job("capybaroar", "capybaroar-b1"), w.brandDeps), { status: "failed", error: "Capybaroar says this brand belongs to another partner." });
  assert.deepEqual(await removeBrandJob({ ...job("arrowsterr", "x"), payload: { product: "zapier" } }, w.brandDeps), {
    status: "failed",
    error: "A remove_brand job needs product, brand_id and workspace_id in its payload.",
  });
  const noKey = await removeBrandJob(job("arrowsterr", "arrowsterr-b1"), { ...w.brandDeps, partner: () => ({ ok: false, error: "Arrowsterr partner key is not set on the server." }) });
  assert.deepEqual(noKey, { status: "failed", error: "Arrowsterr partner key is not set on the server." });
});

test("revoke_keys: 404 (the brand is already gone) counts as done", async () => {
  const w = await world();
  await w.close();
  w.deleteWorkspace();
  const r = await revokeKeysJob({ id: 1, kind: "revoke_keys", workspace_id: null, payload: { product: "arrowsterr", brand_id: "nope", workspace_id: WS }, attempts: 1, max_attempts: 12 }, w.brandDeps);
  assert.deepEqual(r, { status: "done" });
});

test("planAction: close only when the subscription ended, reopen while any plan is in force", () => {
  const now = NOW.getTime();
  const past = new Date(now - DAYS(1)).toISOString();
  const future = new Date(now + DAYS(5)).toISOString();
  const cases: [Record<string, string>, string][] = [
    [{ plan: "pro", status: "canceled", trial_ends_at: past }, "close"],
    [{ plan: "starter", status: "unpaid", trial_ends_at: past }, "close"],
    [{ plan: "starter", status: "incomplete_expired", trial_ends_at: past }, "close"],
    [{ plan: "pro", status: "canceled", trial_ends_at: future }, "reopen"], // canceled during the trial: the trial still runs
    [{ plan: "pro", status: "active", trial_ends_at: past }, "reopen"],
    [{ plan: "pro", status: "past_due", trial_ends_at: past }, "reopen"], // Stripe is still retrying the card
    [{ plan: "pro", status: "incomplete", trial_ends_at: past }, "none"], // the first payment is still going through
    [{ plan: "trial", status: "trialing", trial_ends_at: past }, "none"],
  ];
  for (const [ws, want] of cases) assert.equal(planAction(ws, now), want, JSON.stringify(ws));
});
