import * as Sentry from "@sentry/nextjs";
import { adminClient } from "@/lib/serverAuth";
import { teamEmailDomain } from "@/lib/teamEmail";
import { handleInbound } from "@/lib/teamEmailInbound";
import { inboundDeps } from "@/lib/teamEmailServer";

// The email door's webhook: Resend calls this for every email sent to the receiving domain (TEAM_EMAIL_DOMAIN, like
// team.morningtelos.com). Set it up in Resend: Webhooks, Add Webhook, this address, the email.received event. Put its
// signing secret (whsec_...) in RESEND_INBOUND_SECRET. While TEAM_EMAIL_DOMAIN is empty this answers 404 and does
// nothing. src/lib/teamEmailInbound.ts has the rules; the worker's team_email job does the rest.
export const dynamic = "force-dynamic";

function log(message: string) {
  console.error(message);
  Sentry.captureMessage(message, { level: "warning", tags: { area: "team_email" } });
}

const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const domain = teamEmailDomain(process.env);
  if (!domain) return reply({ error: "Not found." }, 404);
  const db = adminClient();
  if (!db) return reply({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, 500);
  try {
    const out = await handleInbound({ headers: request.headers, body: await request.text() }, inboundDeps(db, { domain, secret: process.env.RESEND_INBOUND_SECRET, log }));
    return reply(out.body, out.status);
  } catch (e) {
    // Resend tries again later, and queue_team_email() makes sure it's only queued once.
    log(`Team email webhook failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply({ error: "Try again." }, 500);
  }
}
