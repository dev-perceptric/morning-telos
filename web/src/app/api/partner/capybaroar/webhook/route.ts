import * as Sentry from "@sentry/nextjs";
import { adminClient } from "@/lib/serverAuth";
import { handleSocialWebhook } from "@/lib/social";

// Capybaroar calls this when a channel of one of our brands is connected or lost (channel.connected, channel.lost),
// signed the Standard Webhooks way. Set it up once with Capybaroar's partner API, using the partner key:
//   PUT https://<capybaroar>/api/partner/webhook  { "url": "https://<this app>/api/partner/capybaroar/webhook" }
// The answer has the secret (whsec_...), once. Put it in CAPYBAROAR_WEBHOOK_SECRET on the server.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "social" } });
}

export async function POST(request: Request) {
  const body = await request.text();
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  try {
    const out = await handleSocialWebhook(
      { headers: request.headers, body },
      {
        secret: process.env.CAPYBAROAR_WEBHOOK_SECRET,
        brandOf: async (ws) => {
          const { data, error } = await db.from("services").select("brand_id").eq("workspace_id", ws).eq("product", "capybaroar").maybeSingle();
          if (error) throw new Error(error.message);
          return (data as { brand_id: string | null } | null)?.brand_id ?? null;
        },
        markSeen: async (id, type) => {
          const { error } = await db.from("webhook_events").insert({ source: "capybaroar", id, type });
          if (error?.code === "23505") return false;
          if (error) throw new Error(error.message);
          return true;
        },
        unmark: async (id) => {
          await db.from("webhook_events").delete().eq("source", "capybaroar").eq("id", id);
        },
        save: async (row) => {
          const { data, error } = await db.rpc("save_social_channel", {
            p_ws: row.workspace_id,
            p_channel: row.channel_id,
            p_network: row.network,
            p_name: row.name,
            p_status: row.status,
            p_at: row.updated_at,
          });
          if (error) throw new Error(error.message);
          return Boolean(data);
        },
        log,
      },
    );
    return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log(`Capybaroar webhook failed: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
