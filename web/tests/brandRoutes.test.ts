// POST /api/brand's logic (src/lib/brandRoutes.ts) with a fake gate and a fake database. Owners and admins only.
import assert from "node:assert/strict";
import test from "node:test";
import type { BrandPatch, BrandRow } from "../src/lib/brand.ts";
import { BRAND_ROUTE_MESSAGES, brandRoute, type BrandRouteDeps } from "../src/lib/brandRoutes.ts";
import { ROLE_RANK, type Role } from "../src/lib/workspace.ts";
import type { Gate } from "../src/lib/workspaceRoutes.ts";

function gateAs(role: Role | null, asked: Role[] = []): Gate {
  return async (min) => {
    asked.push(min);
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) return { ok: false, status: 403, error: `You need ${min} access in this workspace to do that.` };
    return { ok: true, userId: "me", email: "me@example.com" };
  };
}

const ROW: BrandRow = { primary_color: "#1d4ed8", accent_color: null, heading_font: "Lora", body_font: null, logo_url: null, tone: "warm", source: "manual", use_brand: true };

function deps(role: Role | null, o: Partial<BrandRouteDeps> & { saved?: BrandPatch[]; rescans?: number[]; asked?: Role[] } = {}): BrandRouteDeps {
  const saved = o.saved ?? [];
  const rescans = o.rescans ?? [];
  return {
    gate: gateAs(role, o.asked),
    save: async (p) => {
      saved.push(p);
      return { ...ROW, ...p };
    },
    rescan: async () => {
      rescans.push(1);
      return true;
    },
    hasWebsite: async () => true,
    ...o,
  };
}

for (const role of ["viewer", "editor", null] as const) {
  test(`a ${role ?? "non-member"} can't change the brand or read the website again`, async () => {
    const saved: BrandPatch[] = [];
    const rescans: number[] = [];
    const asked: Role[] = [];
    const a = await brandRoute({ workspaceId: "w", primary_color: "#000000" }, deps(role, { saved, rescans, asked }));
    const b = await brandRoute({ workspaceId: "w", action: "rescan" }, deps(role, { saved, rescans }));
    assert.equal(a.status, 403);
    assert.equal(b.status, 403);
    assert.deepEqual(asked, ["admin"]);
    assert.deepEqual(saved, []);
    assert.deepEqual(rescans, []);
  });
}

for (const role of ["admin", "owner"] as const) {
  test(`an ${role} saves checked fields and gets the row back`, async () => {
    const saved: BrandPatch[] = [];
    const r = await brandRoute({ workspaceId: "w", primary_color: "C6613F", heading_font: "playfair display", use_brand: false }, deps(role, { saved }));
    assert.equal(r.status, 200);
    assert.deepEqual(saved, [{ primary_color: "#c6613f", heading_font: "Playfair Display", use_brand: false }]);
    assert.equal((r.body.brand as BrandRow).primary_color, "#c6613f");
  });
}

test("bad values are refused before anything is saved; source can't be set", async () => {
  const saved: BrandPatch[] = [];
  for (const body of [{ primary_color: "blue" }, { logo_url: "javascript:alert(1)" }, { heading_font: "x;y" }, { source: "website" }, {}]) {
    const r = await brandRoute({ workspaceId: "w", ...body }, deps("owner", { saved }));
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(saved, []);
});

test("a save the database refuses says so plainly; other failures don't show the database's words", async () => {
  const rls = await brandRoute({ workspaceId: "w", tone: "warm" }, deps("admin", { save: async () => Promise.reject(new Error('new row violates row-level security policy for table "brand_kits"')) }));
  assert.deepEqual(rls, { status: 403, body: { error: "Only admins and the owner can change the brand." } });
  const down = await brandRoute({ workspaceId: "w", tone: "warm" }, deps("admin", { save: async () => Promise.reject(new Error("connection reset")) }));
  assert.deepEqual(down, { status: 500, body: { error: BRAND_ROUTE_MESSAGES.failed } });
});

test("read my website again: queued, already waiting, no website, or a failure", async () => {
  assert.deepEqual(await brandRoute({ action: "rescan" }, deps("admin")), { status: 200, body: { queued: true, message: BRAND_ROUTE_MESSAGES.queued } });
  assert.deepEqual(await brandRoute({ action: "rescan" }, deps("admin", { rescan: async () => false })), { status: 200, body: { queued: false, message: BRAND_ROUTE_MESSAGES.waiting } });
  const rescans: number[] = [];
  assert.deepEqual(await brandRoute({ action: "rescan" }, deps("owner", { rescans, hasWebsite: async () => false })), { status: 400, body: { error: BRAND_ROUTE_MESSAGES.noSite } });
  assert.deepEqual(rescans, []);
  assert.equal((await brandRoute({ action: "rescan" }, deps("owner", { rescan: async () => Promise.reject(new Error("x")) }))).status, 500);
});
