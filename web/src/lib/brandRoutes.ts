// What the Brand settings route does (POST /api/brand, src/app/api/brand/route.ts). Owners and admins only: the
// gate checks the role first, then the values are checked, then saved as the caller so row level security checks
// the role and the workspace a second time (supabase/021_brand.sql). Tests pass fakes.
import { cleanBrandInput, type BrandPatch, type BrandRow } from "./brand.ts";
import { NEEDS } from "./workspace.ts";
import type { Gate, Result } from "./workspaceRoutes.ts";

export type BrandRouteDeps = {
  gate: Gate;
  /** Saves the changed fields as the caller, making the row when there is none. Returns the row as saved. */
  save: (patch: BrandPatch) => Promise<BrandRow>;
  /** Hands the brand back to the website and queues a scan (rescan_brand). False when one is already waiting. */
  rescan: () => Promise<boolean>;
  /** The workspace has a website to read. */
  hasWebsite: () => Promise<boolean>;
};

const fail = (error: string, status = 400): Result => ({ status, body: { error } });

export const BRAND_ROUTE_MESSAGES = {
  noSite: "Add your website above first.",
  queued: "We're reading your website. Your brand updates in a minute or two.",
  waiting: "We're already reading your website. Check back in a minute.",
  failed: "We couldn't save that. Try again.",
} as const;

/** { action: "rescan" } reads the website again; anything else saves the fields sent. */
export async function brandRoute(input: Record<string, unknown>, d: BrandRouteDeps): Promise<Result> {
  const who = await d.gate(NEEDS.editSettings);
  if (!who.ok) return fail(who.error, who.status);
  if (input.action === "rescan") {
    if (!(await d.hasWebsite())) return fail(BRAND_ROUTE_MESSAGES.noSite);
    let queued: boolean;
    try {
      queued = await d.rescan();
    } catch {
      return fail(BRAND_ROUTE_MESSAGES.failed, 500);
    }
    return { status: 200, body: { queued, message: queued ? BRAND_ROUTE_MESSAGES.queued : BRAND_ROUTE_MESSAGES.waiting } };
  }
  const fields = Object.fromEntries(Object.entries(input).filter(([k]) => k !== "workspaceId" && k !== "action"));
  const v = cleanBrandInput(fields);
  if (!v.ok) return fail(v.error);
  try {
    return { status: 200, body: { brand: await d.save(v.value) } };
  } catch (e) {
    const denied = /row-level security|permission denied/.test(e instanceof Error ? e.message : "");
    return denied ? fail("Only admins and the owner can change the brand.", 403) : fail(BRAND_ROUTE_MESSAGES.failed, 500);
  }
}
