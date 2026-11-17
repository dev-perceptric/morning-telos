import { connection } from "next/server";
import { ClientApp } from "@/components/ClientApp";
import { checkConfig } from "@/lib/config";

export default async function Home() {
  // Read settings when the page is requested, so changed settings apply without a rebuild.
  await connection();
  const { missing, problems } = checkConfig(process.env);

  if (missing.length || problems.length) {
    return (
      <main className="flex min-h-screen justify-center px-4 py-16">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <p className="text-[15px] font-semibold">Morning Telos</p>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <h1 className="mb-3 font-serif text-[28px] leading-tight">Finish the server setup</h1>
            {missing.length ? (
              <>
                <p className="mb-2 text-[15px] text-ink-2">Add these to the server settings, then restart:</p>
                <ul className="mb-2 list-disc pl-5">
                  {missing.map((m) => (
                    <li key={m}>
                      <code className="font-mono text-[13px]">{m}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {problems.map((p) => (
              <p key={p} className="text-[14px] text-red">
                {p}
              </p>
            ))}
          </div>
        </div>
      </main>
    );
  }
  const supabase = { url: (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, ""), key: (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim() };
  // Cloudflare Turnstile bot check on sign-up and log-in. Turn on bot protection in Supabase's Auth settings with the same keys.
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;
  return <ClientApp supabase={supabase} turnstileSiteKey={turnstileSiteKey} />;
}
