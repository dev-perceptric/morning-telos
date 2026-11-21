// The workspace's brand (supabase/021_brand.sql): main and accent colors, heading and body fonts, the logo and the
// writing tone, learned from the website when it is scanned (src/lib/siteScan.ts), and changed by owners and admins in
// Settings, General, Brand. Chat answers wear it (answerTheme), and the team writes in its tone (src/lib/agentLoop.ts).
// Lifted from Omniscient's brand kit (src/lib/experiences/brand.ts: toHex, pickColors, pickFonts, firstFamily,
// googleFamilies, contrast, readableOn), trimmed to what answers need. Reading a home page is in src/lib/brandLook.ts.
// Pure: no network. Shared by the server and the browser, so nothing here may import server code or cheerio.

/** What a scan found. A part is null when the site doesn't show it. */
export type FoundBrand = { primary: string | null; accent: string | null; headingFont: string | null; bodyFont: string | null; logoUrl: string | null; tone: string | null };
/** A brand_kits row as the app reads it. */
export type BrandRow = {
  primary_color: string | null;
  accent_color: string | null;
  heading_font: string | null;
  body_font: string | null;
  logo_url: string | null;
  tone: string | null;
  source: "website" | "manual";
  use_brand: boolean;
};
export const BRAND_COLUMNS = "primary_color, accent_color, heading_font, body_font, logo_url, tone, source, use_brand";

/** The chat's background (--bg in src/app/mt.css). Colors in answers are checked against it. */
export const CHAT_BG = "#ffffff";
/** The app's own accent for answers, Morning Telos clay (--clay-2), used when there is no brand. */
export const DEFAULT_ACCENT = "#c15f3c";
/** The most a brand color may be darkened to read well. Past that, it stops looking like the brand and the default is used. */
const MAX_DARKEN = 0.4;

const HEX = /^#[0-9a-f]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
/** A font name we can ask Google Fonts for: letters, digits and spaces. */
export const FONT_NAME = /^[A-Za-z0-9 ]{2,60}$/;
export const TONE_MAX = 80;

// ─────────────── colors ───────────────

/** "#abc", "#aabbcc", "rgb(1, 2, 3)" as "#rrggbb", or null. Mostly see-through colors don't count. */
export function toHex(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  let m = t.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${[...m[1]].map((x) => x + x).join("")}`;
  m = t.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return m[2] && parseInt(m[2], 16) < 128 ? null : `#${m[1]}`;
  m = t.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    if (a < 0.5) return null;
    return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
function hsl(hex: string) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
/** How bright a color looks, 0 to 1 (WCAG relative luminance). */
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** How readable one color is on another, 1 to 21. 4.5 is enough for text, 3 for lines and dots. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** Two colors mixed: 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, by: number) {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((c, i) => Math.round((c + (y[i] - c) * by) * 255).toString(16).padStart(2, "0")).join("")}`;
}
/** A real color, not a gray, white or near black. Grays never become the brand color. */
export const colorful = (hex: string) => {
  const { s, l } = hsl(hex);
  return s > 0.25 && l > 0.12 && l < 0.85;
};
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hsl(a).h - hsl(b).h);
  return Math.min(d, 360 - d);
};

/**
 * The color darkened (on a light ground) until it reads on `bg` at `min`, and how far it had to go (0 to 1).
 * null when even the darkest step that still looks like the brand doesn't read.
 */
export function readableOn(c: string, bg: string, min = 4.5): { color: string; darkened: number } | null {
  if (contrast(c, bg) >= min) return { color: c, darkened: 0 };
  const toward = luminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let i = 1; i <= 20; i++) {
    const by = i / 20;
    if (by > MAX_DARKEN) break;
    const next = mix(c, toward, by);
    if (contrast(next, bg) >= min) return { color: next, darkened: by };
  }
  return null;
}

type Rule = { selector: string; body: string };
/** CSS rules as selector and body, with comments and at-rule wrappers flattened. Good enough to count colors. */
export function cssRules(css: string): Rule[] {
  const out: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim().replace(/^@[^{]*$/, ""), body: m[2] });
  return out;
}

const COLOR_IN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
const BUTTONISH = /\b(btn|button|cta|primary|brand|accent)\b|(^|[\s,>])a(?=[\s,:.[{]|$)|\[type=.?submit/i;
const BRAND_VAR = /--[\w-]*(primary|brand|accent|main|highlight|cta)[\w-]*/i;

/**
 * The main and accent colors from a site's CSS and its theme-color: custom properties named like brand colors count
 * most, then theme-color, then colors on buttons and links, then every other use. Grays never count.
 */
export function pickColors(css: string, themeColor?: string | null): { primary: string | null; accent: string | null } {
  const score = new Map<string, number>();
  const add = (hex: string | null, w: number) => hex && score.set(hex, (score.get(hex) ?? 0) + w);
  const vars = new Map<string, string>();
  for (const r of cssRules(css)) {
    for (const decl of r.body.split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const value = decl.slice(at + 1).trim();
      if (prop.startsWith("--")) {
        vars.set(prop, value);
        const hex = toHex(value);
        if (hex && BRAND_VAR.test(prop)) add(hex, 8);
        continue;
      }
      if (!/color|background|border|fill|stroke/.test(prop)) continue;
      const resolved = value.replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => vars.get(v.toLowerCase()) ?? "");
      const w = BUTTONISH.test(r.selector) ? 3 : 1;
      for (const c of resolved.match(COLOR_IN) ?? []) add(toHex(c), w);
    }
  }
  add(themeColor ? toHex(themeColor) : null, 10);
  const bright = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .filter(colorful);
  const primary = bright[0] ?? null;
  const accent = primary ? (bright.find((c) => c !== primary && hueGap(c, primary) > 30) ?? bright.find((c) => c !== primary) ?? null) : null;
  return { primary, accent };
}

// ─────────────── fonts ───────────────

/** Popular Google Fonts, so a font the site hosts itself (Next.js, a theme) still counts when Google has it too. */
export const GOOGLE_FONTS = [
  "Inter", "Inter Tight", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3", "Source Sans Pro",
  "Raleway", "Nunito", "Nunito Sans", "Work Sans", "Rubik", "Manrope", "DM Sans", "DM Serif Display", "DM Serif Text",
  "Plus Jakarta Sans", "Space Grotesk", "Sora", "Outfit", "Urbanist", "Figtree", "Lexend", "Karla", "Mulish",
  "Barlow", "Quicksand", "Josefin Sans", "Archivo", "Cabin", "Hind", "Fira Sans", "IBM Plex Sans", "IBM Plex Serif",
  "PT Sans", "PT Serif", "Noto Sans", "Noto Serif", "Ubuntu", "Oswald", "Bebas Neue", "Anton", "Playfair Display",
  "Merriweather", "Lora", "Libre Baskerville", "Cormorant Garamond", "Cormorant", "EB Garamond", "Crimson Text",
  "Crimson Pro", "Fraunces", "Newsreader", "Bitter", "Arvo", "Zilla Slab", "Roboto Slab", "Roboto Condensed",
  "Josefin Slab", "Abril Fatface", "Cinzel", "Prata", "Marcellus", "Spectral", "Libre Franklin", "Red Hat Display",
  "Red Hat Text", "Overpass", "Heebo", "Assistant", "Kanit", "Prompt", "Titillium Web", "Exo 2", "Asap", "Hanken Grotesk",
  "Schibsted Grotesk", "Bricolage Grotesque", "Instrument Sans", "Instrument Serif", "Onest", "Geologica", "Albert Sans",
  "Be Vietnam Pro", "Epilogue", "Syne", "Space Mono", "Dancing Script", "Pacifico", "Caveat", "Satisfy", "Great Vibes",
  "Amatic SC", "Lobster", "Comfortaa", "Varela Round", "Fredoka", "Baloo 2", "Signika", "Domine", "Alegreya",
  "Alegreya Sans", "Vollkorn", "Gelasio", "Literata", "Source Serif 4", "Source Serif Pro", "Jost", "Questrial",
];
const GOOGLE_BY_LOWER = new Map(GOOGLE_FONTS.map((f) => [f.toLowerCase(), f]));

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[\w-]+|-apple-system|blinkmacsystemfont|segoe ui|helvetica neue|helvetica|arial|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|inherit|initial|unset|var\(.*)$/i;

/** The first real family in a font-family list. Next.js names like "__Inter_a1b2c3" read as "Inter". */
export function firstFamily(list: string): string | null {
  for (const raw of list.split(",")) {
    let name = raw.trim().replace(/^["']|["']$/g, "").trim();
    const next = name.match(/^__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*?)_[a-f0-9]{6}$/);
    if (next) name = next[1].replace(/_/g, " ");
    if (!name || /fallback/i.test(name) || GENERIC.test(name)) continue;
    if (FONT_NAME.test(name)) return name;
  }
  return null;
}

/** Families named in Google Fonts links: "...css2?family=Inter:wght@400;600&family=DM+Serif+Display" or "...css?family=Lato|Open+Sans". */
export function googleFamilies(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const h of hrefs) {
    try {
      const u = new URL(h.replace(/&amp;/g, "&"));
      if (u.hostname !== "fonts.googleapis.com") continue;
      for (const f of u.searchParams.getAll("family"))
        for (const part of f.split("|")) {
          const name = part.split(":")[0].replace(/\+/g, " ").trim();
          if (FONT_NAME.test(name) && !out.includes(name)) out.push(name);
        }
    } catch {
      // Not an address: skipped.
    }
  }
  return out;
}

/** A font name as Google Fonts spells it, when the site loads it from Google or Google has it. Else null. */
export function googleFont(name: string | null, fromLinks: string[]): string | null {
  if (!name) return null;
  const linked = fromLinks.find((f) => f.toLowerCase() === name.toLowerCase());
  return linked ?? GOOGLE_BY_LOWER.get(name.toLowerCase()) ?? null;
}

/**
 * Heading and body fonts from a site's CSS and its Google Fonts links. Only fonts Google Fonts has are kept, because
 * answers only ever load fonts from there: any other font is null, and answers use the app's own.
 */
export function pickFonts(css: string, linked: string[] = []): { heading: string | null; body: string | null } {
  const vars = new Map<string, string>();
  const heads = new Map<string, number>();
  const bodies = new Map<string, number>();
  const count = (m: Map<string, number>, k: string | null, w = 1) => k && m.set(k, (m.get(k) ?? 0) + w);
  const rules = cssRules(css);
  for (const r of rules)
    for (const d of r.body.split(";")) {
      const at = d.indexOf(":");
      if (at > 0 && d.slice(0, at).trim().startsWith("--")) vars.set(d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim());
    }
  for (const r of rules) {
    for (const decl of r.body.split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      if (prop !== "font-family" && prop !== "font") continue;
      const value = decl.slice(at + 1).trim().replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => vars.get(v.toLowerCase()) ?? "");
      const fam = googleFont(firstFamily(prop === "font" ? value.replace(/^.*?\d[\w%.]*(?:\/[\w.%]+)?\s+/, "") : value), linked);
      if (/(^|[\s,])(h1|h2|h3)\b|heading|title|display/i.test(r.selector)) count(heads, fam, 2);
      else if (/(^|[\s,])(html|body|:root|p)([\s,{:.]|$)/i.test(r.selector)) count(bodies, fam, 2);
      else count(bodies, fam);
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const body = top(bodies) ?? linked[0] ?? null;
  const heading = top(heads) ?? linked.find((g) => g !== body) ?? body;
  return { heading, body };
}

// ─────────────── what a home page shows ───────────────

export type SiteLook = { logo: string | null; themeColor: string | null; css: string; stylesheets: string[]; googleFamilies: string[]; text: string };

/** A logo address we keep: https only (an http one is asked for over https), at most 2,000 characters. */
export function logoUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const s = u.toString();
    return s.length <= 2000 ? s : null;
  } catch {
    return null;
  }
}

// ─────────────── tone ───────────────

/** A tone as we keep it: one short line, no long dashes, at most TONE_MAX characters. Empty becomes null. */
export function cleanTone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'\s.]+|["'\s.]+$/g, "")
    .trim()
    .slice(0, TONE_MAX)
    .trim();
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : null;
}

const WORDS: [RegExp, string][] = [
  [/\b(luxury|luxurious|exclusive|bespoke|premium|elegant|refined|finest|artisan)\b/g, "polished"],
  [/\b(love|family|cozy|cosy|friendly|welcome|warm|neighbou?rhood|community|homemade|smile)\b/g, "warm"],
  [/\b(solutions?|enterprise|compliance|professional|certified|expertise|clients|industry|services provided)\b/g, "professional"],
  [/\b(fun|awesome|amazing|epic|yummy|super|cool)\b/g, "playful"],
];

/**
 * A short tone from the site's words when Claude can't read them: which kind of words it uses most, and whether its
 * sentences are short. "warm and simple", "professional and clear". Rule of thumb only; owners can change it.
 */
export function guessTone(text: string): string | null {
  const t = text.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 30) return null;
  const scores = WORDS.map(([re, name]) => ({ name, n: (t.match(re) ?? []).length })).sort((a, b) => b.n - a.n);
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().split(/\s+/).length > 2);
  const avg = sentences.length ? words.length / sentences.length : 20;
  const bangs = (text.match(/!/g) ?? []).length / Math.max(1, sentences.length);
  const you = (t.match(/\byou(r|'re|’re)?\b/g) ?? []).length / words.length;
  const first = scores[0].n >= 2 ? scores[0].name : bangs > 0.2 ? "upbeat" : you > 0.02 ? "friendly" : "clear";
  const second = avg <= 14 ? "simple" : avg >= 24 ? "detailed" : first === "clear" ? "direct" : "clear";
  return `${first} and ${second === first ? "direct" : second}`;
}

/** The brand a scan found, or null when nothing usable was found (no color, no font and no logo). */
export function brandFrom(look: SiteLook, sheets: string[], tone: string | null): FoundBrand | null {
  const css = [look.css, ...sheets].join("\n");
  const colors = pickColors(css, look.themeColor);
  const fonts = pickFonts(css, look.googleFamilies);
  const found: FoundBrand = { primary: colors.primary, accent: colors.accent, headingFont: fonts.heading, bodyFont: fonts.body, logoUrl: look.logo, tone: cleanTone(tone) };
  return found.primary || found.headingFont || found.bodyFont || found.logoUrl ? found : null;
}

// ─────────────── answers in the brand style ───────────────

/** The CSS variables a chat answer takes (src/app/mt.css, .md), and the Google Fonts stylesheet to load, if any. */
export type AnswerTheme = { vars: Record<string, string>; fontHref: string | null; darkened: boolean };
export const DEFAULT_THEME: AnswerTheme = { vars: {}, fontHref: null, darkened: false };

/** The Google Fonts stylesheet for these fonts. Only fonts.googleapis.com, only names that are letters, digits and spaces. */
export function fontsHref(names: (string | null | undefined)[]): string | null {
  const fams = [...new Set(names.filter((n): n is string => typeof n === "string" && FONT_NAME.test(n)))];
  if (!fams.length) return null;
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.trim().replace(/ /g, "+")}:wght@500;600;700`).join("&")}&display=swap`;
}

/**
 * How answers look for this workspace. No brand, or "Use my brand in answers" off: the Morning Telos default.
 * The accent is only used when it reads on the chat background (4.5:1, darkened a little if it must be, else the
 * default). Body text keeps the app's font and ink. The heading font only ever comes from Google Fonts.
 */
export function answerTheme(row: Partial<BrandRow> | null | undefined): AnswerTheme {
  if (!row || row.use_brand === false) return DEFAULT_THEME;
  const vars: Record<string, string> = {};
  let darkened = false;
  // The main color, else the accent color, whichever is a real color that reads (darkened a little at most).
  const ok =
    [row.primary_color, row.accent_color]
      .filter((c): c is string => isHex(c) && colorful(c))
      .map((c) => readableOn(c, CHAT_BG, 4.5))
      .find((x) => x !== null) ?? null;
  if (ok) {
    darkened = ok.darkened > 0;
    vars["--md-accent"] = ok.color;
    // A pale wash of the brand for the table header and quotes. Ink on it stays well above 4.5:1.
    vars["--md-tint"] = mix(ok.color, "#ffffff", 0.9);
    vars["--md-tint-line"] = mix(ok.color, "#ffffff", 0.75);
  }
  const heading = typeof row.heading_font === "string" && FONT_NAME.test(row.heading_font) ? row.heading_font : null;
  if (heading) vars["--md-head"] = `"${heading}", var(--sans)`;
  return { vars, fontHref: fontsHref([heading]), darkened };
}

// ─────────────── what owners and admins send from Settings ───────────────

export type BrandPatch = Partial<Pick<BrandRow, "primary_color" | "accent_color" | "heading_font" | "body_font" | "logo_url" | "tone" | "use_brand">>;

/** One color as typed: "#C6613F", "c6613f" or "#abc". Empty clears it. */
export function cleanColor(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (!t) return { ok: true, value: null };
  const hex = toHex(t.startsWith("#") ? t : `#${t}`);
  return hex ? { ok: true, value: hex } : { ok: false };
}

/** A font name as typed. Empty clears it. Google Fonts spelling when we know it. */
export function cleanFont(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return { ok: true, value: null };
  if (!FONT_NAME.test(t)) return { ok: false };
  return { ok: true, value: GOOGLE_BY_LOWER.get(t.toLowerCase()) ?? t };
}

export const BRAND_ERRORS = {
  color: "Type a color like #1f6feb.",
  font: "Type a font name from Google Fonts, like Lora. Letters, numbers and spaces only.",
  logo: "Type a logo address that starts with https://.",
  tone: `Keep the tone under ${TONE_MAX} letters.`,
  nothing: "There is nothing to save.",
} as const;

/** The fields Settings sent, checked. Only fields that were sent are changed. */
export function cleanBrandInput(b: Record<string, unknown>): { ok: true; value: BrandPatch } | { ok: false; error: string } {
  const out: BrandPatch = {};
  for (const k of ["primary_color", "accent_color"] as const) {
    if (!(k in b)) continue;
    const c = cleanColor(b[k]);
    if (!c.ok) return { ok: false, error: BRAND_ERRORS.color };
    out[k] = c.value;
  }
  for (const k of ["heading_font", "body_font"] as const) {
    if (!(k in b)) continue;
    const f = cleanFont(b[k]);
    if (!f.ok) return { ok: false, error: BRAND_ERRORS.font };
    out[k] = f.value;
  }
  if ("logo_url" in b) {
    const raw = b.logo_url;
    if (raw === null || raw === "" || (typeof raw === "string" && !raw.trim())) out.logo_url = null;
    else {
      const u = typeof raw === "string" && /^https:\/\//i.test(raw.trim()) ? logoUrl(raw) : null;
      if (!u) return { ok: false, error: BRAND_ERRORS.logo };
      out.logo_url = u;
    }
  }
  if ("tone" in b) {
    if (b.tone !== null && typeof b.tone !== "string") return { ok: false, error: BRAND_ERRORS.tone };
    if (typeof b.tone === "string" && b.tone.trim().length > TONE_MAX) return { ok: false, error: BRAND_ERRORS.tone };
    out.tone = cleanTone(b.tone);
  }
  if ("use_brand" in b) {
    if (typeof b.use_brand !== "boolean") return { ok: false, error: BRAND_ERRORS.nothing };
    out.use_brand = b.use_brand;
  }
  if (!Object.keys(out).length) return { ok: false, error: BRAND_ERRORS.nothing };
  return { ok: true, value: out };
}

/** The tone line for the team's prompts, or null when the brand is off or has no tone. */
export function brandTone(row: Pick<BrandRow, "tone" | "use_brand"> | null | undefined): string | null {
  return row && row.use_brand !== false ? cleanTone(row.tone) : null;
}
