// Social accounts as the screens show them. Pure and free of server imports, so Home, Settings and tests share it.

export type ChannelStatus = "connected" | "lost";
export type SocialChannel = { channel_id: string; network: string; name: string; status: ChannelStatus; updated_at: string };

const NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  linkedin_page: "LinkedIn Page",
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
