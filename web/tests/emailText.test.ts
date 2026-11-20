// Turning a received email into the person's message (src/lib/emailText.ts): quoted older emails and signatures
// come off, forwards keep the forwarded email, and HTML-only emails become text.
import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_TEXT_MAX, emailText, htmlToText, trimEmail } from "../src/lib/emailText.ts";

test("Gmail reply: the 'On ... wrote:' line and everything under it come off", () => {
  const t = "Yes, Friday works.\n\nThanks!\n\nOn Mon, Nov 16, 2026 at 9:00 AM Hermes at Morning Telos <acme@team.morningtelos.com> wrote:\n> Can we meet Friday?\n> Hermes";
  assert.equal(trimEmail(t), "Yes, Friday works.\n\nThanks!");
});

test("the 'On ... wrote:' line split over two lines is found too", () => {
  const t = "Sounds good.\n\nOn Mon, Nov 16, 2026 at 9:00 AM Hermes at Morning Telos <acme@team.morningtelos.com>\nwrote:\n\n> Old text";
  assert.equal(trimEmail(t), "Sounds good.");
});

test("Outlook reply: the From/Sent/To block and the underscore line come off", () => {
  const a = "Please book it.\r\n\r\nFrom: Hermes at Morning Telos <acme@team.morningtelos.com>\r\nSent: Monday, November 16, 2026 9:00 AM\r\nTo: Ana <ana@x.com>\r\nSubject: Re: Quote\r\n\r\nOld words";
  assert.equal(trimEmail(a), "Please book it.");
  const b = "Go ahead.\n________________________________\nFrom: Hermes\nSent: Monday\nTo: Ana\n\nOld";
  assert.equal(trimEmail(b), "Go ahead.");
  const c = "Do it.\n\n-----Original Message-----\nFrom: Hermes\nOld";
  assert.equal(trimEmail(c), "Do it.");
});

test("other languages' quote lines come off", () => {
  assert.equal(trimEmail("Oui.\n\nLe lun. 16 nov. 2026 à 09:00, Hermes <a@b.com> a écrit :\n> vieux"), "Oui.");
  assert.equal(trimEmail("Ja.\n\nAm Mo., 16. Nov. 2026 um 09:00 Uhr schrieb Hermes <a@b.com>:\n> alt"), "Ja.");
});

test("signatures come off: the '-- ' line and phone lines", () => {
  assert.equal(trimEmail("Can you post this?\n\n-- \nAna Lopez\nOwner, Ana's Bakery\n555-0100"), "Can you post this?");
  assert.equal(trimEmail("Post it today.\n\nSent from my iPhone"), "Post it today.");
  assert.equal(trimEmail("Post it.\n\nGet Outlook for iOS"), "Post it.");
});

test("loose '> ' quoted lines come off, but a '>' inside a line stays", () => {
  assert.equal(trimEmail("> old line\nNew words: 5 > 3\n> another old line"), "New words: 5 > 3");
});

test("a forward keeps the forwarded email after the note, without the note's signature", () => {
  const t = "Can you answer this customer?\n\n--\nAna\n\n---------- Forwarded message ---------\nFrom: Bo <bo@customer.com>\nDate: Mon, Nov 16, 2026\nSubject: Order\n\nWhere is my order?\n\nOn Sun Bo wrote:\n> earlier";
  const out = trimEmail(t, { forward: true });
  assert.ok(out.startsWith("Can you answer this customer?\n\n---------- Forwarded message ---------"), out);
  assert.match(out, /Where is my order\?/);
  assert.match(out, /On Sun Bo wrote:\nearlier/, "inside a forward, the quote is kept, without the > marks");
  assert.doesNotMatch(out, /\nAna\n/);
  // A forward marker counts even without Fwd: in the subject.
  assert.match(trimEmail("FYI\n\nBegin forwarded message:\n\nFrom: Bo\nHello"), /Begin forwarded message:\n\nFrom: Bo\nHello/);
  // Outlook forwards look like replies, so with a Fwd: subject the From/Sent block starts the forward.
  const outlook = trimEmail("See below.\n\nFrom: Bo <bo@c.com>\nSent: Monday\nTo: Ana\nSubject: Order\n\nWhere is it?", { forward: true });
  assert.match(outlook, /^See below\.\n\nFrom: Bo <bo@c\.com>[\s\S]*Where is it\?$/);
});

test("an email that is only a quote, or empty, gives empty text", () => {
  assert.equal(trimEmail("On Mon Bo wrote:\n> hi"), "");
  assert.equal(trimEmail("   \n\n "), "");
});

test("long emails are cut", () => {
  const out = trimEmail("word ".repeat(5000));
  assert.ok(out.length <= EMAIL_TEXT_MAX);
});

test("htmlToText: line breaks and lists kept, quotes, styles and tags gone, entities read", () => {
  const html = `<html><head><style>p{color:red}</style><title>x</title></head><body><div dir="ltr">Hi team,<br>Please post <b>this</b> &amp; that.<ul><li>One</li><li>Two</li></ul><p>Price: 5&nbsp;&lt; 6 &#8364; &#x263A;</p></div>
<div class="gmail_quote"><div>On Mon Bo wrote:</div><blockquote class="gmail_quote">Old <blockquote>older</blockquote> text</blockquote></div><script>alert(1)</script></body></html>`;
  const out = htmlToText(html);
  assert.equal(out, "Hi team,\nPlease post this & that.\n- One\n- Two\nPrice: 5 < 6 € ☺\n\nOn Mon Bo wrote:");
  assert.equal(trimEmail(out), "Hi team,\nPlease post this & that.\n- One\n- Two\nPrice: 5 < 6 € ☺");
});

test("emailText: the plain text when there is some, else the HTML as text", () => {
  assert.equal(emailText({ text: "Plain", html: "<p>Html</p>" }), "Plain");
  assert.equal(emailText({ text: "  ", html: "<p>Html</p>" }), "Html");
  assert.equal(emailText({ text: null, html: null }), "");
});
