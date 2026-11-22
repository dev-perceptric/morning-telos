// Gmail (src/gmail.js): finding the reply box, reading the open email, putting a draft into the box (never sending),
// and who drafts it.
import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "../src/config.js";
import { hasReplyBox, insertReply, pickReplyAgent, readEmail } from "../src/gmail.js";
import { FakeEl, fakeDoc } from "./fakeDom.mjs";

const BOX = ['div[aria-label="Message Body"][contenteditable="true"]'];
const loc = { href: "https://mail.google.com/mail/u/0/#inbox/abc" };

test("hasReplyBox is true only while a compose or reply box is open", () => {
  assert.equal(hasReplyBox(fakeDoc({ body: new FakeEl({ kids: [new FakeEl({ matches: BOX })] }) })), true);
  assert.equal(hasReplyBox(fakeDoc({ body: new FakeEl({ text: "Inbox" }) })), false);
});

test("insertReply types the draft into the box line by line, and only fires an input event", () => {
  const box = new FakeEl({ matches: BOX });
  const doc = fakeDoc({ body: new FakeEl({ kids: [box] }) });
  const out = insertReply("Hi Sam,\r\n\r\nThanks for asking.\nAna", doc);
  assert.deepEqual(out, { ok: true });
  assert.equal(box.focused, true);
  assert.deepEqual(doc.typed, ["Hi Sam,", "<insertLineBreak>", "<insertLineBreak>", "Thanks for asking.", "<insertLineBreak>", "Ana"]);
  assert.deepEqual(box.events, ["input"]);
});

test("insertReply uses the box the person is in when several are open", () => {
  const first = new FakeEl({ matches: BOX });
  const second = new FakeEl({ matches: BOX });
  const doc = fakeDoc({ body: new FakeEl({ kids: [first, second] }) });
  doc.activeElement = first;
  insertReply("Yes", doc);
  assert.equal(first.focused, true);
  assert.equal(second.focused, false);
});

test("insertReply adds the lines as text when Gmail turns typing off", () => {
  const box = new FakeEl({ matches: BOX });
  const doc = fakeDoc({ body: new FakeEl({ kids: [box] }), typing: false });
  assert.deepEqual(insertReply("One\nTwo", doc), { ok: true });
  assert.deepEqual(box.children.map((c) => c.textContent), ["One", "Two"]);
});

test("insertReply with no box open says so and changes nothing", () => {
  const doc = fakeDoc({ body: new FakeEl({ text: "Inbox" }) });
  assert.deepEqual(insertReply("Hi", doc), { ok: false, error: "Open a reply box in Gmail first." });
  assert.deepEqual(doc.typed, []);
});

test("insertReply never clicks or submits anything", () => {
  assert.doesNotMatch(insertReply.toString(), /\.click\(|submit|send/i);
});

test("readEmail reads the open thread: subject, who wrote each message, and the words", () => {
  const msg = (name, email, text) =>
    new FakeEl({ matches: ["div.adn"], kids: [new FakeEl({ matches: [".gD"], attrs: { name, email }, text: name }), new FakeEl({ matches: [".a3s"], text })] });
  const main = new FakeEl({ matches: ['div[role="main"]'], kids: [new FakeEl({ matches: ["h2.hP"], text: "Price for a cake" }), msg("Sam", "sam@x.com", "How much for a cake?"), msg("Ana", "ana@bakery.com", "Let me check.")] });
  const out = readEmail(LIMITS, fakeDoc({ body: new FakeEl({ kids: [main] }) }), loc);
  assert.equal(out.title, "Price for a cake");
  assert.equal(out.url, loc.href);
  assert.equal(out.text, "From: Sam <sam@x.com>\nHow much for a cake?\n\n---\n\nFrom: Ana <ana@bakery.com>\nLet me check.");
});

test("readEmail keeps the newest part of a long thread, and says when there is no earlier message", () => {
  const m = (t) => new FakeEl({ matches: ["div.adn"], kids: [new FakeEl({ matches: [".a3s"], text: t })] });
  const main = new FakeEl({ matches: ['div[role="main"]'], kids: [m("old ".repeat(100)), m("newest words")] });
  const out = readEmail({ text: 50, title: 300 }, fakeDoc({ body: new FakeEl({ kids: [main] }) }), loc);
  assert.equal(out.text.length, 50);
  assert.ok(out.text.endsWith("newest words"));
  const empty = readEmail(LIMITS, fakeDoc({ body: new FakeEl({ text: "" }) }), loc);
  assert.match(empty.text, /A new email\. There is no earlier message\./);
  assert.equal(empty.title, "Email in Gmail");
});

test("pickReplyAgent: the tagged teammate, else Midas for sales mail and Irene for the rest", () => {
  assert.equal(pickReplyAgent({ title: "Quote for 3 cakes", text: "" }), "Midas");
  assert.equal(pickReplyAgent({ title: "Hello", text: "What's your pricing?" }), "Midas");
  assert.equal(pickReplyAgent({ title: "My order is late", text: "Where is it" }), "Irene");
  assert.equal(pickReplyAgent({ title: "Help", text: "The door code doesn't work" }), "Irene");
  assert.equal(pickReplyAgent({ title: "Quote", text: "" }, "make it short @cyrus"), "Cyrus");
});

test("the Gmail functions run in the tab on their own", () => {
  for (const fn of [hasReplyBox, readEmail, insertReply]) assert.equal(typeof new Function(`return (${fn.toString()})`)(), "function");
});
