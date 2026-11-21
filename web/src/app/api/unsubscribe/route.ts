import { unsubscribePage } from "@/lib/emailWork";
import { adminClient } from "@/lib/serverAuth";

// The unsubscribe link at the end of every campaign email (src/lib/campaigns.ts footer). GET shows a page with one
// button, so a mail scanner opening the link can't unsubscribe anyone; POST does it. No sign-in: the token is the key.
export const dynamic = "force-dynamic";

const page = (html: string, status = 200) => new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  return page(unsubscribePage(/^[0-9a-f]{32}$/.test(t) ? "ask" : "bad", t), /^[0-9a-f]{32}$/.test(t) ? 200 : 400);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const t = String(form?.get("t") ?? new URL(request.url).searchParams.get("t") ?? "");
  const db = adminClient();
  if (!db || !/^[0-9a-f]{32}$/.test(t)) return page(unsubscribePage("bad"), 400);
  const { data, error } = await db.rpc("unsubscribe_contact", { p_token: t });
  if (error) return page(unsubscribePage("bad"), 500);
  return page(unsubscribePage(data ? "done" : "bad"), data ? 200 : 404);
}
