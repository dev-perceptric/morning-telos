// What a home page shows of its brand: the logo, theme-color, inline CSS, its stylesheets and Google Fonts links, and
// its words. Omniscient's readSite (src/lib/experiences/brand.ts) with cheerio in place of linkedom. Server only in
// practice (cheerio), so src/lib/brand.ts stays small for the browser. Pure.
import * as cheerio from "cheerio";
import { googleFamilies, logoUrl, type SiteLook } from "./brand.ts";

const abs = (href: string | null | undefined, base: string) => {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** The logo, colors, styles, fonts and words on a home page. Stylesheets are listed for the scan to read, never loaded in the app. */
export function readLook(html: string, base: string): SiteLook {
  const $ = cheerio.load(html.slice(0, 1_000_000));
  type Q = ReturnType<typeof $>;
  const attrs = (el: Q) => `${el.attr("class") ?? ""} ${el.attr("id") ?? ""} ${el.attr("alt") ?? ""} ${el.attr("src") ?? ""} ${el.attr("aria-label") ?? ""}`.toLowerCase();
  const site = ($('meta[property="og:site_name"]').attr("content") ?? "").toLowerCase().trim();

  // The logo: a picture in the header that says it's the logo, then any picture that says so, then og:image,
  // then the biggest icon.
  const imgs = $("img").toArray().map((el) => $(el));
  const inHeader = (el: Q) => el.closest("header, nav, [class*=header], [class*=navbar], [id*=header]").length > 0;
  const isLogo = (el: Q) => /logo|brand/.test(attrs(el)) || el.closest("[class*=logo], [id*=logo], a[class*=brand]").length > 0 || Boolean(site && attrs(el).includes(site));
  const srcOf = (el: Q) => el.attr("src") || el.attr("data-src") || el.attr("srcset")?.trim().split(/\s+/)[0] || null;
  const pick = imgs.find((el) => inHeader(el) && isLogo(el)) ?? imgs.find(isLogo) ?? null;
  let logo = pick ? abs(srcOf(pick), base) : null;
  if (pick && /^data:/i.test(srcOf(pick) ?? "")) logo = null;
  logo ??= abs($('meta[property="og:image"]').attr("content") ?? $('meta[name="og:image"]').attr("content"), base);
  if (!logo) {
    const icons = $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')
      .toArray()
      .map((l) => ({ href: abs($(l).attr("href"), base), size: parseInt(($(l).attr("sizes") ?? "").split("x")[0], 10) || (/apple/.test($(l).attr("rel") ?? "") ? 180 : 32) }))
      .filter((x) => x.href && x.size >= 120)
      .sort((a, b) => b.size - a.size);
    logo = icons[0]?.href ?? null;
  }

  // Inline styles count too: a button's own style="background:#..." is often the clearest brand color.
  const inline = $("[style]")
    .toArray()
    .slice(0, 400)
    .map((el) => `${el.tagName}${$(el).attr("class") ? `.${String($(el).attr("class")).trim().split(/\s+/).join(".")}` : ""}{${$(el).attr("style")}}`)
    .join("\n");
  const css = [$("style").toArray().map((s) => $(s).text()).join("\n"), inline].join("\n").slice(0, 400_000);
  const links = $('link[rel~="stylesheet"][href], link[as="style"][href]')
    .toArray()
    .map((l) => abs($(l).attr("href"), base))
    .filter((x): x is string => Boolean(x));
  const imported = [...css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)].map((m) => abs(m[1], base)).filter((x): x is string => Boolean(x));
  const fontLinks = [...$("link[href]").toArray().map((l) => abs($(l).attr("href"), base) ?? ""), ...imported].filter((h) => h.includes("fonts.googleapis.com"));
  $("script, style, noscript, svg, nav, footer, template").remove();
  return {
    logo: logoUrl(logo),
    themeColor: $('meta[name="theme-color"]').first().attr("content") ?? null,
    css,
    stylesheets: [...new Set(links.filter((l) => !l.includes("fonts.googleapis.com")))].slice(0, 4),
    googleFamilies: googleFamilies(fontLinks),
    text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000),
  };
}

