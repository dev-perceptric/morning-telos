// The words of a web page, and which of its links to read next. Pure, so tests can cover them.
// htmlToText is Arrowsterr's pageText (src/lib/pageText.ts, cheerio), changed for business facts: the footer stays
// (addresses, phone numbers and hours live there), and short lines stay when they hold a number or a price.
import * as cheerio from "cheerio";

/** Most characters kept from one page. */
export const PAGE_TEXT_CHARS = 8000;
/** Most pages read after the home page. */
export const MAX_LINKS = 5;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A page's title, meta description and main writing, without menus, scripts and forms. At most `max` characters. */
export function htmlToText(html: string, max = PAGE_TEXT_CHARS): { title: string; description: string; text: string } {
  const $ = cheerio.load(html.slice(0, 1_000_000));
  const title = clean($("title").first().text()).slice(0, 160);
  const description = clean($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").slice(0, 300);
  $("script, style, noscript, svg, iframe, template, nav, form, button, select, [role=navigation], [aria-hidden=true], [hidden]").remove();
  const root = $("main").first().length ? $("main").first().add($("footer")) : $("body");
  // Block elements end a line, so sentences from different paragraphs don't run together.
  root.find("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, br, div, section, article, address, dt, dd, tr").each((_, el) => {
    $(el).append("\n");
  });
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of root.text().split("\n")) {
    const line = clean(raw);
    // Menus and labels are one or two words. Keep short lines only when they hold a number ("$45 an hour", "Open 9 to 5").
    const words = line.split(" ").filter(Boolean).length;
    if (!line || (words < 3 && !/\d/.test(line))) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return { title, description, text: lines.join("\n").slice(0, max) };
}

/** The pages worth reading after the home page, in order. Each group gives at most one page before the others get a second. */
const GROUPS: { name: string; words: RegExp }[] = [
  { name: "about", words: /\b(about|about[-_ ]?us|our[-_ ]?story|who[-_ ]?we[-_ ]?are|team|company)\b/ },
  { name: "services", words: /\b(services?|what[-_ ]?we[-_ ]?do|products?|menu|offerings?|solutions?|treatments?|shop)\b/ },
  { name: "pricing", words: /\b(pricing|prices?|rates?|plans?|packages?|costs?|fees?)\b/ },
  { name: "contact", words: /\b(contact|contact[-_ ]?us|locations?|find[-_ ]?us|visit|hours|directions)\b/ },
  { name: "faq", words: /\b(faqs?|questions|help)\b/ },
];
const NOT_PAGES = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|mp4|mp3|mov|docx?|xlsx?|pptx?|css|js|xml|json|rss)$/i;

/** Two hosts are the same site when they match without a leading "www.". */
export const sameSite = (a: string, b: string) => a.toLowerCase().replace(/^www\./, "") === b.toLowerCase().replace(/^www\./, "");

/**
 * Up to `max` links from the home page to its own about, services, pricing, contact and FAQ pages, best first.
 * Only http(s) links on the same site, never the home page itself, files, or the same page twice.
 */
export function pickLinks(html: string, homeUrl: string, max = MAX_LINKS): string[] {
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return [];
  }
  const $ = cheerio.load(html.slice(0, 1_000_000));
  const homeKey = `${home.hostname.replace(/^www\./, "")}${home.pathname.replace(/\/+$/, "")}`;
  const found: { url: string; group: number; order: number }[] = [];
  const seen = new Set<string>([homeKey]);
  $("a[href]").each((i, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data|sms):/i.test(href)) return;
    let u: URL;
    try {
      u = new URL(href, home);
    } catch {
      return;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !sameSite(u.hostname, home.hostname) || NOT_PAGES.test(u.pathname)) return;
    u.hash = "";
    const key = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
    if (seen.has(key)) return;
    const said = `${decode(u.pathname).replace(/[/_-]+/g, " ")} ${clean($(el).text())}`.toLowerCase();
    const group = GROUPS.findIndex((g) => g.words.test(said));
    if (group < 0) return;
    seen.add(key);
    found.push({ url: u.toString(), group, order: i });
  });
  // Round by round: the first link of each group, then the second of each, and so on.
  const byGroup = GROUPS.map((_, g) => found.filter((f) => f.group === g));
  const out: string[] = [];
  for (let round = 0; out.length < max && byGroup.some((list) => list.length > round); round++) {
    for (const list of byGroup) if (list[round] && out.length < max) out.push(list[round].url);
  }
  return out;
}
