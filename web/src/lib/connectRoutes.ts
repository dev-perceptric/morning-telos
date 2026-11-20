// What the connect routes share: the log line, the reply, and the services row. Server code only.
import * as Sentry from "@sentry/nextjs";
import type { Product } from "./partner";
import type { ServiceRow } from "./partnerConnect";
import { adminClient } from "./serverAuth";
import type { Result } from "./workspaceRoutes";

export function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "social" } });
}

export const reply = (out: Result) => Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });

export const failed = (where: string, e: unknown) => {
  log(`${where} failed: ${e instanceof Error ? e.message : String(e)}`);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
};

/** The workspace's row for a product in services, read with the server's key (services is server only). */
export function serviceOf(workspaceId: unknown, product: Product) {
  return async (): Promise<ServiceRow> => {
    const db = adminClient();
    if (!db) throw new Error("Add SUPABASE_SECRET_KEY to the server's settings.");
    const { data, error } = await db.from("services").select("status, brand_id").eq("workspace_id", workspaceId).eq("product", product).maybeSingle();
    if (error) throw new Error(error.message);
    return data as ServiceRow;
  };
}
