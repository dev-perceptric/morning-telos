import { DEFAULT_FROM } from "@/lib/email";
import { handleEmailHook } from "@/lib/emailHook";
import { appUrl } from "@/lib/emailKit";
import { supabaseUrl } from "@/lib/serverAuth";

// Supabase's Send Email hook: Supabase calls this for every account email, and Morning Telos designs it and sends it
// through Resend. Turn it on in Supabase: Authentication, Auth Hooks, Send Email, HTTPS, with this address and a
// generated secret. Put the same secret (v1,whsec_...) in SEND_EMAIL_HOOK_SECRET on the server.
export async function POST(request: Request) {
  const key = process.env.RESEND_API_KEY?.trim();
  const out = await handleEmailHook(
    { headers: request.headers, body: await request.text() },
    {
      secret: process.env.SEND_EMAIL_HOOK_SECRET,
      supabaseUrl: supabaseUrl(),
      appUrl: appUrl(),
      resend: key ? { key, from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM, fetch } : null,
    },
  );
  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}
