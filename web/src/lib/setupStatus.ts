// What the Home screen says about a workspace's setup in Arrowsterr and Capybaroar, from service_status()
// (supabase/005_services.sql). Pure, so tests check the words. Never shows a raw error.

export type SetupCard = { tone: "working" | "problem" | "action"; title: string; text: string; action?: { label: string; path: string } };

/**
 * A card while setup is running, has a problem or needs the customer, or null when there is nothing to say (all ready).
 * A problem comes first, then what the customer can do (add the website), then "working".
 */
export function setupCard(rows: readonly { status: string }[]): SetupCard | null {
  if (rows.some((r) => r.status === "failed")) {
    return { tone: "problem", title: "We're fixing a setup problem", text: "Part of your SEO and social setup didn't finish. Our team has been told and is on it. You don't need to do anything." };
  }
  if (rows.some((r) => r.status === "waiting")) {
    return { tone: "action", title: "Add your website to turn on SEO", text: "Add your website in Settings to turn on SEO.", action: { label: "Open Settings", path: "/settings" } };
  }
  if (rows.some((r) => r.status === "pending")) {
    return { tone: "working", title: "Setting up SEO and social", text: "This takes a minute or two. You can keep going while we finish." };
  }
  return null;
}
