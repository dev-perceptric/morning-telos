// Pages the extension never reads or attaches. The same list as the server (web/src/lib/pageContext.ts BLOCKED_HOSTS,
// checked by web/tests/extension-sync.test.ts), which checks again. A page with a password box is refused too
// (src/page.js looks while it reads).

export const BLOCKED_HOSTS = [
  // Password managers and sign-in pages.
  "1password.com",
  "lastpass.com",
  "bitwarden.com",
  "dashlane.com",
  "keepersecurity.com",
  "nordpass.com",
  "passwords.google.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  // Banks, cards, payments and money apps.
  "chase.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "usbank.com",
  "pnc.com",
  "td.com",
  "hsbc.com",
  "barclays.co.uk",
  "americanexpress.com",
  "discover.com",
  "paypal.com",
  "venmo.com",
  "wise.com",
  "revolut.com",
  "chime.com",
  "ally.com",
  "sofi.com",
  "schwab.com",
  "fidelity.com",
  "vanguard.com",
  "robinhood.com",
  "coinbase.com",
  "dashboard.stripe.com",
  // The Chrome Web Store.
  "chromewebstore.google.com",
];

/** The one short line the side panel shows for each reason. */
export const BLOCK_LINES = {
  browser: "Morning Telos can't read Chrome's own pages.",
  store: "Morning Telos can't read the Chrome Web Store.",
  private: "Morning Telos doesn't read bank, payment or password pages, to keep your accounts safe.",
  password: "This page has a password box, so Morning Telos won't read it.",
};

/** Why the extension must not read this address ("browser", "store" or "private"), or null when it may. */
export function blockReason(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    return "browser";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "browser";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "chromewebstore.google.com" || (host === "chrome.google.com" && u.pathname.startsWith("/webstore"))) return "store";
  if (BLOCKED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return "private";
  if (host.split(".").some((label) => label.includes("bank"))) return "private";
  return null;
}

export const isBlockedUrl = (raw) => blockReason(raw) !== null;
