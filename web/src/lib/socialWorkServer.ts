// The database and product calls behind Aphrodite's Posts tab (src/lib/socialWork.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import type { Channel } from "./socialWork.ts";
import { productRead, productWrite } from "./productTools.ts";
import { productDeps } from "./teamTools.ts";

export function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "social-work" } });
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export function socialData(db: SupabaseClient, ws: string) {
  const products = productDeps(db, log);
  return {
    serviceStatus: async () => (must(await db.from("services").select("status").eq("workspace_id", ws).eq("product", "capybaroar").maybeSingle()) as { status: string } | null)?.status ?? null,
    brandId: async () => (must(await db.from("services").select("brand_id").eq("workspace_id", ws).eq("product", "capybaroar").maybeSingle()) as { brand_id: string | null } | null)?.brand_id ?? null,
    read: (tool: string, input: Record<string, unknown>) => productRead(ws, "capybaroar", tool, input, products),
    write: (tool: string, input: Record<string, unknown>) => productWrite(ws, "capybaroar", tool, input, products),
    approvals: async () =>
      must(await db.from("approvals").select("id, tool, input, status").eq("workspace_id", ws).eq("agent", "social").eq("product", "capybaroar").eq("status", "pending").order("id").limit(100)) as {
        id: number;
        tool: string;
        input: Record<string, unknown> | null;
        status: string;
      }[],
    channels: async () =>
      (must(await db.from("social_channels").select("channel_id, network, name, status").eq("workspace_id", ws).order("network")) as { channel_id: string; network: string; name: string; status: Channel["status"] }[]).map(
        (c) => ({ id: c.channel_id, network: c.network, name: c.name, status: c.status }),
      ),
    channel: async (id: string) => {
      const c = must(await db.from("social_channels").select("channel_id, network, name, status").eq("workspace_id", ws).eq("channel_id", id).maybeSingle()) as { channel_id: string; network: string; name: string; status: Channel["status"] } | null;
      return c ? { id: c.channel_id, network: c.network, name: c.name, status: c.status } : null;
    },
    forget: async (id: string) => {
      must(await db.from("social_channels").delete().eq("workspace_id", ws).eq("channel_id", id));
    },
    activity: async (text: string) => {
      must(await db.from("activity").insert({ workspace_id: ws, agent: "social", text }));
    },
  };
}
