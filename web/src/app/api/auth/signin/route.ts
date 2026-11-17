import { clientIp } from "@/lib/authGuard";
import { adminClient, supabaseUrl } from "@/lib/serverAuth";
import { signIn } from "@/lib/signin";

// Password sign-in through the server, so wrong tries can be counted and locked out.
// Too many wrong passwords for one email from one address, from one address in total, or for one email in an hour
// pause sign-in for a while. The answer never says whether the email has an account.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = adminClient();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const out = await signIn(body, {
    url: supabaseUrl(),
    key: process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "",
    ip: clientIp(request),
    fetch,
    wrongTries: async (email, ip) => {
      if (!db) return null;
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const hour = new Date(Date.now() - 60 * 60_000).toISOString();
      const base = () => db.from("auth_attempts").select("id", { count: "exact", head: true }).eq("ok", false);
      const [pair, byIp, emailHour] = await Promise.all([
        count(base().eq("email", email).eq("ip", ip).gt("created_at", since)),
        ip ? count(base().eq("ip", ip).gt("created_at", since)) : Promise.resolve(0),
        count(base().eq("email", email).gt("created_at", hour)),
      ]);
      return { pair, ip: byIp, emailHour };
    },
    record: async (email, ip, ok) => {
      if (!db) return;
      await db.from("auth_attempts").insert({ email, ip, ok });
      if (ok) await db.from("auth_attempts").delete().eq("email", email).eq("ip", ip).eq("ok", false);
      if (Math.random() < 0.05) await db.from("auth_attempts").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
    },
  });
  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}
