// The chat stream, replies, @ tagging and the quick action messages.
import assert from "node:assert/strict";
import test from "node:test";
import { chatBody, inlineParts, plainReply, readLines } from "../src/chat.js";
import { domainOf, draftMessage, QUICK, quickMessage } from "../src/quick.js";
import { AGENTS, insertMention, mentionMatches, mentionQuery, parseMentions } from "../src/team.js";

test("readLines splits whole NDJSON lines and keeps the rest", () => {
  const { events, rest } = readLines('{"type":"thread","id":"t"}\nbroken\n{"type":"done"}\n{"type":"mess');
  assert.deepEqual(events, [{ type: "thread", id: "t" }, { type: "done" }]);
  assert.equal(rest, '{"type":"mess');
});

test("replies show **bold** as bold and everything else as text", () => {
  assert.deepEqual(inlineParts("Hi **there** <b>x</b>"), [{ text: "Hi ", bold: false }, { text: "there", bold: true }, { text: " <b>x</b>", bold: false }]);
  assert.equal(plainReply("\n**Hi Sam,**\r\nThanks.\n"), "Hi Sam,\nThanks.");
});

test("chatBody sends the page and screenshot only when there is a page", () => {
  assert.deepEqual(chatBody({ workspaceId: "w", text: "hi", threadId: null, screenshot: "data:x" }), { workspaceId: "w", text: "hi", threadId: null });
  const page = { kind: "page", url: "https://a.com", title: "A", text: "words", selection: "", cut: true, extra: 1 };
  assert.deepEqual(chatBody({ workspaceId: "w", text: "hi", threadId: "t", page, screenshot: "data:image/jpeg;base64,AA" }), {
    workspaceId: "w",
    text: "hi",
    threadId: "t",
    page: { kind: "page", url: "https://a.com", title: "A", text: "words", selection: "" },
    screenshot: "data:image/jpeg;base64,AA",
  });
});

test("@ tagging works like the app", () => {
  assert.deepEqual(parseMentions("@hermes and @Artemis, @nobody"), ["sales", "seo"]);
  assert.equal(mentionQuery("ask @art"), "art");
  assert.equal(mentionQuery("mail@x"), null);
  assert.deepEqual(mentionMatches("he"), ["sales", "support", "web"]);
  assert.deepEqual(mentionMatches("sales"), ["sales"]);
  assert.equal(mentionMatches("").length, AGENTS.length);
  assert.deepEqual(insertMention("hi @her", 7, "sales"), { text: "hi @Hermes ", cursor: 11 });
});

test("quick actions tag the right teammate and name the page's domain", () => {
  const page = { url: "https://www.anasbakery.com/menu" };
  assert.equal(domainOf(page.url), "anasbakery.com");
  assert.equal(domainOf("nope"), "");
  assert.match(quickMessage("check", page), /^@Artemis .*domain_overview on anasbakery\.com/);
  assert.match(quickMessage("lead", page), /^@Hermes .*CRM.*wait.*OK.*which app to connect/s);
  assert.match(quickMessage("summary", page), /^@Athena /);
  assert.throws(() => quickMessage("other", page));
  assert.deepEqual(QUICK.map((q) => parseMentions(quickMessage(q.id, page))[0]), ["seo", "sales", "chief"]);
  assert.match(draftMessage("Hestia"), /^@Hestia Draft a reply/);
  for (const q of QUICK) assert.doesNotMatch(quickMessage(q.id, page), /[–—]/);
});
