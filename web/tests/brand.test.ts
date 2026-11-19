// The brand: reading it from fixture pages (never a real site), the contrast checks, how answers look, and what
// Settings may save. src/lib/brand.ts and src/lib/brandLook.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  answerTheme,
  brandFrom,
  brandTone,
  CHAT_BG,
  cleanBrandInput,
  cleanColor,
  cleanFont,
  cleanTone,
  colorful,
  contrast,
  DEFAULT_THEME,
  firstFamily,
  fontsHref,
  googleFamilies,
  googleFont,
  guessTone,
  logoUrl,
  pickColors,
  pickFonts,
  readableOn,
  toHex,
  type BrandRow,
} from "../src/lib/brand.ts";
import { readLook } from "../src/lib/brandLook.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/brand/${name}`, import.meta.url), "utf8");
const BAKERY = fixture("bakery.html");
const SITE_CSS = fixture("site.css");

const row = (o: Partial<BrandRow> = {}): BrandRow => ({ primary_color: null, accent_color: null, heading_font: null, body_font: null, logo_url: null, tone: null, source: "website", use_brand: true, ...o });

// ─────────────── reading a page ───────────────

test("readLook: the bakery's logo, theme-color, stylesheets, Google Fonts and words", () => {
  const look = readLook(BAKERY, "https://anasbakery.example/");
  assert.equal(look.logo, "https://anasbakery.example/img/ana-logo.png");
  assert.equal(look.themeColor, "#b5462b");
  assert.deepEqual(look.stylesheets, ["https://anasbakery.example/assets/site.css", "https://cdn.example/theme.css"]);
  assert.deepEqual(look.googleFamilies, ["Playfair Display", "Work Sans"]);
  assert.match(look.css, /--brand-primary: #b5462b/);
  // A button's own style counts as CSS too.
  assert.match(look.css, /a\.btn\.btn-primary\{background:#b5462b/);
  assert.match(look.text, /family bakery/);
  assert.doesNotMatch(look.text, /About Menu/, "the menu isn't the site's words");
});

test("brandFrom: colors, fonts, logo and tone from the bakery fixture and its stylesheet", () => {
  const look = readLook(BAKERY, "https://anasbakery.example/");
  const b = brandFrom(look, [SITE_CSS], null);
  assert.deepEqual(b, { primary: "#b5462b", accent: "#2f7d6d", headingFont: "Playfair Display", bodyFont: "Work Sans", logoUrl: "https://anasbakery.example/img/ana-logo.png", tone: null });
  assert.equal(brandFrom(look, [SITE_CSS], "  Warm and simple. ")?.tone, "warm and simple");
});

test("readLook and brandFrom: a Next.js site's self-hosted Google fonts, a color in a CSS variable, and its big icon as the logo", () => {
  const look = readLook(fixture("nextjs.html"), "https://lumen.example/work");
  assert.equal(look.logo, "https://lumen.example/apple-icon.png");
  const b = brandFrom(look, [], null);
  assert.equal(b?.primary, "#2563eb");
  assert.equal(b?.headingFont, "Fraunces");
  assert.equal(b?.bodyFont, "Inter");
});

test("brandFrom: a gray site with a font Google doesn't have gives no brand at all", () => {
  const look = readLook(fixture("plain.html"), "https://gray.example/");
  assert.equal(look.logo, null);
  assert.equal(brandFrom(look, [], null), null);
});

test("readLook: og:image when no picture says logo; data: logos and javascript: addresses are dropped", () => {
  assert.equal(readLook('<meta property="og:image" content="/card.png"><img src="/hero.jpg">', "https://a.example/").logo, "https://a.example/card.png");
  assert.equal(readLook('<header><img class="logo" src="data:image/png;base64,AAAA"></header>', "https://a.example/").logo, null);
  assert.equal(readLook('<img class="logo" src="javascript:alert(1)">', "https://a.example/").logo, null);
  // An http logo is asked for over https.
  assert.equal(readLook('<img class="logo" src="http://a.example/l.png">', "https://a.example/").logo, "https://a.example/l.png");
});

test("readLook: a Google Fonts @import inside a style tag counts", () => {
  const look = readLook("<style>@import url('https://fonts.googleapis.com/css?family=Lato:400,700|Open+Sans');</style>", "https://a.example/");
  assert.deepEqual(look.googleFamilies, ["Lato", "Open Sans"]);
});

// ─────────────── colors ───────────────

test("toHex reads hex and rgb, and drops see-through colors", () => {
  assert.equal(toHex("#ABC"), "#aabbcc");
  assert.equal(toHex("#b5462bff"), "#b5462b");
  assert.equal(toHex("#b5462b33"), null);
  assert.equal(toHex("rgb(37, 99, 235)"), "#2563eb");
  assert.equal(toHex("rgba(37 99 235 / 40%)"), null);
  assert.equal(toHex("red"), null);
});

test("pickColors: brand variables and buttons beat other colors; grays never win; theme-color counts", () => {
  assert.deepEqual(pickColors(":root{--brand-main:#0f766e} .x{color:#dc2626}"), { primary: "#0f766e", accent: "#dc2626" });
  assert.deepEqual(pickColors("body{color:#333;background:#fafafa} .b{border-color:#ddd}"), { primary: null, accent: null });
  assert.equal(pickColors(".x{color:#dc2626}", "#7c3aed").primary, "#7c3aed");
  // The most used color in the CSS wins when nothing names a brand.
  assert.equal(pickColors(".a{color:#16a34a}.b{color:#16a34a}.c{background:#ea580c}").primary, "#16a34a");
  assert.ok(!colorful("#777777") && !colorful("#ffffff") && !colorful("#0a0a0a") && colorful("#b5462b"));
});

test("contrast and readableOn: WCAG ratios; a light color is darkened just enough, a hopeless one falls back", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.deepEqual(readableOn("#1d4ed8", CHAT_BG), { color: "#1d4ed8", darkened: 0 });
  const teal = readableOn("#14b8a6", CHAT_BG)!;
  assert.ok(teal.darkened > 0 && teal.darkened <= 0.4);
  assert.ok(contrast(teal.color, CHAT_BG) >= 4.5);
  assert.equal(readableOn("#fffbe0", CHAT_BG), null);
});

// ─────────────── fonts ───────────────

test("firstFamily, googleFamilies and googleFont", () => {
  assert.equal(firstFamily('"Work Sans", Arial, sans-serif'), "Work Sans");
  assert.equal(firstFamily("'__Inter_a1b2c3', '__Inter_Fallback_a1b2c3'"), "Inter");
  assert.equal(firstFamily("system-ui, -apple-system, sans-serif"), null);
  assert.deepEqual(googleFamilies(["https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400", "https://evil.example/css?family=Bad"]), ["DM Serif Display", "Inter"]);
  assert.equal(googleFont("lora", []), "Lora");
  assert.equal(googleFont("Brand Sans", ["Brand Sans"]), "Brand Sans");
  assert.equal(googleFont("Proxima Nova", []), null);
});

test("pickFonts: heading from h1-h3 rules, body from body; fonts Google doesn't have are left out", () => {
  assert.deepEqual(pickFonts('body{font-family:"Lato"} h1{font-family:"Lora", serif}'), { heading: "Lora", body: "Lato" });
  assert.deepEqual(pickFonts('body{font-family:"Proxima Nova"} h1{font-family:"Gotham"}'), { heading: null, body: null });
  assert.deepEqual(pickFonts("", ["Oswald", "Lato"]), { heading: "Lato", body: "Oswald" });
});

test("fontsHref: only fonts.googleapis.com, only safe names", () => {
  assert.equal(fontsHref(["Playfair Display"]), "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap");
  assert.equal(fontsHref(['x"); @import url(evil.css'] as string[]), null);
  assert.equal(fontsHref([null, ""]), null);
});

// ─────────────── tone ───────────────

test("guessTone: a rule-based tone from the site's words; too few words gives none", () => {
  assert.equal(guessTone(readLook(BAKERY, "https://anasbakery.example/").text), "warm and simple");
  const formal =
    "Our enterprise solutions help clients meet compliance needs across the industry with certified expertise, delivered by professional teams that understand the regulatory landscape in great depth and with considerable care. ".repeat(3);
  assert.equal(guessTone(formal), "professional and detailed");
  assert.equal(guessTone("Hello there."), null);
});

test("cleanTone: one short line, lower case first letter, no long dashes", () => {
  assert.equal(cleanTone("Warm — and simple.\n"), "warm, and simple");
  assert.equal(cleanTone("   "), null);
  assert.equal(cleanTone(5), null);
  assert.equal(cleanTone("x".repeat(200))?.length, 80);
});

// ─────────────── answers in the brand style ───────────────

test("answerTheme: no brand, or the switch off, is the Morning Telos default", () => {
  assert.deepEqual(answerTheme(null), DEFAULT_THEME);
  assert.deepEqual(answerTheme(row({ primary_color: "#1d4ed8", use_brand: false })), DEFAULT_THEME);
  assert.deepEqual(answerTheme(row()), DEFAULT_THEME);
});

test("answerTheme: a readable brand color is used as is, with a pale tint for table headers", () => {
  const t = answerTheme(row({ primary_color: "#1d4ed8", heading_font: "Lora" }));
  assert.equal(t.vars["--md-accent"], "#1d4ed8");
  assert.equal(t.darkened, false);
  assert.ok(contrast("#141413", t.vars["--md-tint"]) >= 4.5, "ink reads on the header tint");
  assert.equal(t.vars["--md-head"], '"Lora", var(--sans)');
  assert.equal(t.fontHref, fontsHref(["Lora"]));
});

test("answerTheme: a light brand color is darkened to 4.5:1; a hopeless one falls back to the default accent", () => {
  const t = answerTheme(row({ primary_color: "#14b8a6" }));
  assert.equal(t.darkened, true);
  assert.ok(contrast(t.vars["--md-accent"], CHAT_BG) >= 4.5);
  // Bright yellow would turn olive: the default is used instead, or the accent color when it reads.
  assert.equal(answerTheme(row({ primary_color: "#ffd202" })).vars["--md-accent"], undefined);
  assert.equal(answerTheme(row({ primary_color: "#fde68a", accent_color: "#1d4ed8" })).vars["--md-accent"], "#1d4ed8");
  // A gray main color isn't a brand color: the accent color is used instead.
  assert.equal(answerTheme(row({ primary_color: "#555555", accent_color: "#1d4ed8" })).vars["--md-accent"], "#1d4ed8");
});

test("answerTheme: a font name that isn't safe is never loaded or used; body text is never changed", () => {
  const t = answerTheme(row({ heading_font: "Lora; } body { color: red" }));
  assert.equal(t.fontHref, null);
  assert.equal(t.vars["--md-head"], undefined);
  assert.ok(Object.keys(answerTheme(row({ primary_color: "#1d4ed8", body_font: "Lato", heading_font: "Lora" })).vars).every((k) => !/body|ink|text/.test(k)));
});

test("brandTone: the tone only when the brand is on", () => {
  assert.equal(brandTone({ tone: "Warm and simple", use_brand: true }), "warm and simple");
  assert.equal(brandTone({ tone: "warm", use_brand: false }), null);
  assert.equal(brandTone(null), null);
});

// ─────────────── what Settings may save ───────────────

test("cleanColor, cleanFont and logoUrl", () => {
  assert.deepEqual(cleanColor("C6613F"), { ok: true, value: "#c6613f" });
  assert.deepEqual(cleanColor(""), { ok: true, value: null });
  assert.deepEqual(cleanColor("blue"), { ok: false });
  assert.deepEqual(cleanFont(" playfair  display "), { ok: true, value: "Playfair Display" });
  assert.deepEqual(cleanFont("Comic<script>"), { ok: false });
  assert.equal(logoUrl("https://a.example/l.png"), "https://a.example/l.png");
  assert.equal(logoUrl("ftp://a.example/l.png"), null);
  assert.equal(logoUrl("https://user:pw@a.example/l.png"), null);
});

test("cleanBrandInput: only fields that were sent, each checked", () => {
  assert.deepEqual(cleanBrandInput({ primary_color: "#ABC", tone: " Warm. ", use_brand: false }), { ok: true, value: { primary_color: "#aabbcc", tone: "warm", use_brand: false } });
  assert.deepEqual(cleanBrandInput({ logo_url: "" , heading_font: "" }), { ok: true, value: { logo_url: null, heading_font: null } });
  assert.equal(cleanBrandInput({ primary_color: "nope" }).ok, false);
  assert.equal(cleanBrandInput({ heading_font: "a/b" }).ok, false);
  assert.equal(cleanBrandInput({ logo_url: "http://a.example/l.png" }).ok, false);
  assert.equal(cleanBrandInput({ tone: "x".repeat(81) }).ok, false);
  assert.equal(cleanBrandInput({ use_brand: "yes" }).ok, false);
  assert.equal(cleanBrandInput({ source: "website" }).ok, false, "source is never set from Settings");
  assert.equal(cleanBrandInput({}).ok, false);
});
