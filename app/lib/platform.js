// Morning Telos's own keys (Claude, Arrowsterr, Capybaroar, Claritia, Stripe, R2).
// They live only in the server's environment. They are never stored in the
// database, never typed into the web app, and never sent to a browser.
export const ENV = {
  anthropic: { key: "ANTHROPIC_API_KEY" },
  arrowsterr: { key: "ARROWSTERR_MCP_KEY", url: "ARROWSTERR_MCP_URL", defaultUrl: "https://app.arrowsterr.com/api/mcp" },
  capybaroar: { key: "CAPYBAROAR_MCP_KEY", url: "CAPYBAROAR_MCP_URL" },
  claritia: { key: "CLARITIA_MCP_KEY", url: "CLARITIA_MCP_URL" },
  stripe: { key: "STRIPE_SECRET_KEY", also: ["STRIPE_WEBHOOK_SECRET"] },
  r2: { key: "R2_ACCESS_KEY_ID", key2: "R2_SECRET_ACCESS_KEY", also: ["R2_ENDPOINT"] },
};
const v = (name) => (name ? String(process.env[name] || "").trim() : "");

export function platformConn(tool) {
  const e = ENV[tool];
  if (!e) return null;
  const key = v(e.key), key2 = v(e.key2), url = e.url ? v(e.url) || e.defaultUrl || "" : null;
  const ready = !!key && (!e.url || !!url) && (!e.key2 || !!key2) && (e.also || []).every((n) => n === "STRIPE_WEBHOOK_SECRET" || v(n));
  return { tool, key: key || null, key2: key2 || null, url, status: ready ? "ok" : "off" };
}

// What the Admin page may see: variable names and whether each is set. Never the values.
export function platformInfo(tool) {
  const e = ENV[tool];
  const names = [e.url, e.key, e.key2, ...(e.also || [])].filter(Boolean);
  return { vars: names.map((n) => ({ name: n, set: !!v(n) || (n === e.url && !!e.defaultUrl) })), ready: platformConn(tool).status === "ok" };
}
