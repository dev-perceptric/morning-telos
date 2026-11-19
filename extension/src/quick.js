// The quick actions for the open page. Each one only starts a chat with the page attached and the right teammate
// tagged. The teammate does the work in the app, where every change waits for the owner's OK.

/** The site's domain from a page address, without "www.". */
export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const QUICK = [
  { id: "check", label: "Check this site", agent: "Artemis" },
  { id: "lead", label: "Save as a lead", agent: "Hermes" },
  { id: "summary", label: "Summarize this page", agent: "Athena" },
];

/** The message a quick action sends for this page. */
export function quickMessage(id, page) {
  const domain = domainOf(page?.url);
  if (id === "check")
    return `@Artemis Check this site: ${domain}. Use domain_overview on ${domain} to see its Google traffic and best keywords. Then tell me in a few short points what stands out and what to do next.`;
  if (id === "lead")
    return "@Hermes Save this as a lead. From the attached page, pull the business name, its contact details and any person shown. Then save it to my CRM with your CRM tools, so it waits for my OK. If no CRM is connected, list the lead here and tell me which app to connect.";
  if (id === "summary") return "@Athena Summarize this page in a few short points.";
  throw new Error(`Unknown quick action: ${id}`);
}

/** The message "Draft a reply" sends in Gmail, for the teammate pickReplyAgent chose. */
export const draftMessage = (agent) =>
  `@${agent} Draft a reply to this email. Write only the reply, ready to paste into the reply box: no subject line and no notes before or after it.`;

/** What "Rewrite this" sends with the selected text. */
export const REWRITE = "Rewrite the selected text so it reads clearly and sounds like us. Keep the meaning. Give me only the new text.";
