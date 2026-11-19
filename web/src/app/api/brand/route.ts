import { BRAND_COLUMNS, type BrandPatch, type BrandRow } from "@/lib/brand";
import { brandRoute } from "@/lib/brandRoutes";
import { roleGate } from "@/lib/serverAuth";

// Settings, General, Brand (owners and admins). Body: { workspaceId, action: "rescan" } to read the website again, or
// { workspaceId, ...fields } to change primary_color, accent_color, heading_font, body_font, logo_url, tone or
// use_brand. Saved as the caller, so row level security checks the role a second time (supabase/021_brand.sql).
// Members read the brand straight from Supabase.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { gate, client } = roleGate(request, b.workspaceId);
  const ws = b.workspaceId as string;
  const r = await brandRoute(b, {
    gate,
    hasWebsite: async () => {
      const { data } = await client().from("workspaces").select("website").eq("id", ws).maybeSingle();
      return Boolean((data as { website: string | null } | null)?.website?.trim());
    },
    rescan: async () => {
      const { data, error } = await client().rpc("rescan_brand", { ws });
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    save: async (patch: BrandPatch) => {
      // Update first: an upsert would also try to change workspace_id, which nobody may.
      const up = await client().from("brand_kits").update(patch).eq("workspace_id", ws).select(BRAND_COLUMNS);
      if (up.error) throw new Error(up.error.message);
      if (up.data?.length) return up.data[0] as unknown as BrandRow;
      const add = await client().from("brand_kits").insert({ workspace_id: ws, ...patch }).select(BRAND_COLUMNS).single();
      if (add.error) throw new Error(add.error.message);
      return add.data as unknown as BrandRow;
    },
  });
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
