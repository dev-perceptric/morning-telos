// Social accounts as the screens show them. Pure and free of server imports, so Home, Settings and tests share it.

export type ChannelStatus = "connected" | "lost";
export type SocialChannel = { channel_id: string; network: string; name: string; status: ChannelStatus; updated_at: string };

const NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  linkedin_page: "LinkedIn Page",
  "linkedin-page": "LinkedIn Page",
  x: "X",
  twitter: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  google_business: "Google Business Profile",
  gbp: "Google Business Profile",
};

/** The network's name as people know it, like "LinkedIn" for "linkedin". */
export function networkName(network: string): string {
  const k = network.trim().toLowerCase();
  if (NAMES[k]) return NAMES[k];
  const words = k.split(/[_-]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Social account";
}

/** Lost ones first (they need a click), then by network and name. */
export function sortChannels<T extends Pick<SocialChannel, "network" | "name" | "status">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.status === b.status ? 0 : a.status === "lost" ? -1 : 1) || networkName(a.network).localeCompare(networkName(b.network)) || a.name.localeCompare(b.name));
}

// The logos are small SVGs in public/img/networks: the paths from Simple Icons (CC0), each network's own mark in its own
// color, used only to name that network. LinkedIn's is drawn like Capybaroar's NetworkLogo (Simple Icons has none).
/** The networks we have a logo for, in the order the connect grid shows them when the list has no order of its own. */
export const NETWORK_LOGOS = ["instagram", "facebook", "linkedin", "linkedin-page", "x", "tiktok", "youtube", "threads", "pinterest"] as const;
const ALIAS: Record<string, string> = { linkedin_page: "linkedin-page", twitter: "x" };

/** The network's logo in public/img/networks, or null when we have none (the screen shows its first letter). */
export function networkLogo(network: string): string | null {
  const k = network.trim().toLowerCase();
  const id = ALIAS[k] ?? k;
  return (NETWORK_LOGOS as readonly string[]).includes(id) ? `/img/networks/${id}.svg` : null;
}

/** True when a channel is on this network ("linkedin_page" and "linkedin-page" are the same one). */
export const sameNetwork = (a: string, b: string) => {
  const n = (s: string) => ALIAS[s.trim().toLowerCase()] ?? s.trim().toLowerCase();
  return n(a) === n(b);
};
