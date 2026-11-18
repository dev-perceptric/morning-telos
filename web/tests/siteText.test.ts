// Turning a web page into text, and picking which of its pages to read next (src/lib/siteText.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText, pickLinks, sameSite } from "../src/lib/siteText.ts";

const PAGE = `<!doctype html><html><head><title> Ana's  Bakery | Fresh bread </title>
<meta name="description" content="Sourdough and cakes in Austin.">
<style>.x{color:red}</style><script>var secret = "do not keep";</script></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<header><h1>Fresh bread baked every morning in Austin</h1></header>
<main>
  <p>We bake sourdough, rye and seeded loaves by hand.</p>
  <p>We bake sourdough, rye and seeded loaves by hand.</p>
  <div>Loaf $8</div>
  <div>Menu</div>
  <ul><li>Custom cakes for weddings and birthdays</li></ul>
  <form><input name="email"><button>Sign up for our news</button></form>
  <noscript>Turn on JavaScript to see this page</noscript>
</main>
<footer><address>123 Main St, Austin, TX 78701</address><p>Open Tuesday to Sunday, 7 to 3</p></footer>
</body></html>`;

test("htmlToText keeps the page's writing, prices and footer, and drops scripts, menus, forms and repeats", () => {
  const t = htmlToText(PAGE);
  assert.equal(t.title, "Ana's Bakery | Fresh bread");
  assert.equal(t.description, "Sourdough and cakes in Austin.");
  const lines = t.text.split("\n");
  assert.ok(lines.includes("We bake sourdough, rye and seeded loaves by hand."));
  assert.equal(lines.filter((l) => l.startsWith("We bake")).length, 1, "a repeated line is kept once");
  assert.ok(lines.includes("Loaf $8"), "a short line with a price stays");
  assert.ok(lines.includes("Custom cakes for weddings and birthdays"));
  assert.ok(lines.includes("123 Main St, Austin, TX 78701"), "the footer address stays");
  assert.ok(lines.includes("Open Tuesday to Sunday, 7 to 3"));
  assert.ok(!lines.includes("Menu"), "one-word labels go");
  for (const gone of ["secret", "color:red", "Sign up for our news", "JavaScript", "Home"]) assert.ok(!t.text.includes(gone), `${gone} should be gone`);
});

test("htmlToText reads the body when there is no main element, and caps the length", () => {
  const html = `<body><div>Plumbing repairs for homes across Denver and Boulder.</div><p>${"Fast friendly service every day. ".repeat(500)}</p></body>`;
  const t = htmlToText(html, 300);
  assert.ok(t.text.startsWith("Plumbing repairs for homes across Denver and Boulder."));
  assert.ok(t.text.length <= 300);
  assert.deepEqual(htmlToText(""), { title: "", description: "", text: "" });
});

const HOME = `<body>
<a href="#top">Top</a>
<a href="mailto:hi@ana.example">Email</a><a href="tel:+15125550100">Call us today</a>
<a href="javascript:void(0)">Open menu</a>
<a href="https://facebook.com/anas">Facebook page about us</a>
<a href="https://ana.example/">Home</a>
<a href="/menu.pdf">Download the menu</a>
<a href="/blog/new-rye">Our new rye</a>
<a href="/contact-us">Contact</a>
<a href="/contact-us#map">Find us on the map</a>
<a href="https://www.ana.example/our-story">Our story</a>
<a href="/team">Meet the team</a>
<a href="/services/cakes">Cakes</a>
<a href="/catering">Catering services</a>
<a href="/prices">Prices</a>
<a href="/faq">Questions</a>
<a href="ftp://ana.example/files">Files</a>
<a href="http://shop.ana.example/menu">Shop menu</a>
</body>`;

test("pickLinks takes same-site about, services, pricing, contact and FAQ pages, one of each first, at most 5", () => {
  const links = pickLinks(HOME, "https://ana.example/");
  assert.deepEqual(links, [
    "https://www.ana.example/our-story",
    "https://ana.example/services/cakes",
    "https://ana.example/prices",
    "https://ana.example/contact-us",
    "https://ana.example/faq",
  ]);
  // With room for more, the second page of a group comes after every group's first.
  const more = pickLinks(HOME, "https://ana.example/", 8);
  assert.deepEqual(more.slice(5), ["https://ana.example/team", "https://ana.example/catering"]);
  // Never: another site, a subdomain, a file, a mail or phone link, the home page, a blog post with no keyword.
  for (const l of more) {
    assert.ok(new URL(l).hostname.replace(/^www\./, "") === "ana.example", l);
    assert.doesNotMatch(l, /facebook|\.pdf|mailto|tel:|#|\/blog\//);
  }
  assert.equal(new Set(more).size, more.length, "no page twice");
});

test("pickLinks handles bad input and relative links from an inner page", () => {
  assert.deepEqual(pickLinks(HOME, "not a url"), []);
  assert.deepEqual(pickLinks("<a href='%E0%A4%A'>About</a>", "https://x.example/"), ["https://x.example/%E0%A4%A"]);
  assert.deepEqual(pickLinks('<a href="pricing">Our prices</a>', "https://x.example/shop/"), ["https://x.example/shop/pricing"]);
  assert.equal(sameSite("www.A.example", "a.example"), true);
  assert.equal(sameSite("shop.a.example", "a.example"), false);
});
