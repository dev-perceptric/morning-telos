import * as Sentry from "@sentry/nextjs";
import { partnerFor } from "@/lib/partner";
import type { ServiceStatus } from "@/lib/provision";
import { adminClient, roleGate } from "@/lib/serverAuth";
import { connectLink } from "@/lib/social";

// A one-time Capybaroar page where the customer signs in to Instagram, Facebook, LinkedIn and the rest for their
// workspace's brand (editors and up). The screen opens the address that comes back. Also used to reconnect a lost one.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "social" } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = body.workspaceId;
  const { gate } = roleGate(request, ws);
  try {
    const out = await connectLink({
      gate,
      service: async () => {
        const db = adminClient();
        if (!db) throw new Error("Add SUPABASE_SECRET_KEY to the server's settings.");
        const { data, error } = await db.from("services").select("status, brand_id").eq("workspace_id", ws).eq("product", "capybaroar").maybeSingle();
        if (error) throw new Error(error.message);
        return data as { status: ServiceStatus; brand_id: string | null } | null;
      },
      partner: () => partnerFor("capybaroar", process.env, fetch),
      log,
    });
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log(`Connect link failed: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
