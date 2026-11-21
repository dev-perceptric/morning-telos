// Errors as people may read them. Copied from Omniscient (src/lib/plainError.ts).
// Our own short sentences pass. Anything only a developer reads (a database message, a code, a missing table, a
// stack trace) becomes one plain line, and the original goes to the console once for whoever runs the app.
// ErrorText (src/components/ui.tsx), callApi and getApi (src/components/nav.ts) and the server's routeError all go
// through this, so no screen shows a raw error.

const TECHNICAL = [
  /violates|check constraint|foreign key|duplicate key|null value in|invalid input syntax|syntax error|permission denied for|row-level security|schema cache|could not find the (table|function|column)/i,
  /relation "|column "|function [a-z_]+\(|PGRST\d|JWT|\bSQL\b|supabase|migrations?\/|\.sql\b|Run supabase|SUPABASE_|STRIPE_|_KEY\b/i,
  /ECONN|EAI_AGAIN|ETIMEDOUT|fetch failed|failed to fetch|NetworkError|TypeError|ReferenceError|SyntaxError|Unexpected token|is not a function|cannot read propert|undefined/i,
  /\bstatus(?: code)? \d{3}\b|\bHTTP \d{3}\b|\berror code\b|\b[a-z]+_[a-z]+_[a-z_]+\b|\{\s*"|"\s*:|<\/?[a-z]+>/i,
];

/** True when a message is for a developer rather than the person using the app. */
export const isTechnical = (m: string) => {
  // Emails, links and {{variables}} people typed never count against a line.
  const t = m.replace(/\S+@\S+|https?:\/\/\S+|\{\{[^}]*\}\}/g, "");
  return m.length > 300 || TECHNICAL.some((re) => re.test(t));
};

/** The text of an error, whatever shape it came in. */
export const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : typeof e === "string" ? e : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "").trim();

export const FALLBACK = "Something went wrong. Try again.";
const logged = new Set<string>();

/** An error as one short line people can read: theirs when it's plain, else `fallback`. */
export function plainError(e: unknown, fallback = FALLBACK): string {
  const m = errorText(e);
  if (!m) return fallback;
  if (isTechnical(m)) {
    if (!logged.has(m)) {
      logged.add(m);
      console.warn(m);
    }
    return fallback;
  }
  return m;
}
