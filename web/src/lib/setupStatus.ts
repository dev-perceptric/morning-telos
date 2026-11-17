// What the Home screen says about a workspace's setup in Arrowsterr and Capybaroar, from service_status()
// (supabase/005_services.sql). Pure, so tests check the words. Never shows a raw error.

export type SetupCard = { tone: "working" | "problem"; title: string; text: string };

/** A card while setup is running or has a problem, or null when there is nothing to say (both ready). */
export function setupCard(rows: readonly { status: string }[]): SetupCard | null {
  if (rows.some((r) => r.status === "failed")) {
    return { tone: "problem", title: "We're fixing a setup problem", text: "Part of your SEO and social setup didn't finish. Our team has been told and is on it. You don't need to do anything." };
  }
  if (rows.some((r) => r.status === "pending")) {
    return { tone: "working", title: "Setting up SEO and social", text: "This takes a minute or two. You can keep going while we finish." };
  }
  return null;
}
