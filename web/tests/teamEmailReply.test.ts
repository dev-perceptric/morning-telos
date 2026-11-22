// The answer email (src/lib/teamEmailReply.ts, src/lib/emailMarkdown.ts): who it is from, the threading headers,
// the Markdown drawn as simple HTML (tables too), the approvals with their links, and the link back to the chat.
import assert from "node:assert/strict";
import test from "node:test";
import { markdownHtml, markdownText } from "../src/lib/emailMarkdown.ts";
import { MAX_REFERENCES, replyFrom, replyFromName, replyHeaders, teamReplyEmail } from "../src/lib/teamEmailReply.ts";

test("from: '<Teammate> at Morning Telos' at the workspace's own address", () => {
  assert.equal(replyFromName("sales"), "Midas at Morning Telos");
  assert.equal(replyFrom("chief", "acme", "team.morningtelos.com"), "Alexander at Morning Telos <acme@team.morningtelos.com>");
});

test("reply headers: In-Reply-To is the email answered, References the conversation ending with it", () => {
  assert.deepEqual(replyHeaders("<in2@gmail>", []), { "In-Reply-To": "<in2@gmail>", References: "<in2@gmail>" });
  assert.deepEqual(replyHeaders("<in2@gmail>", ["<in1@gmail>", "<out1@team>", "<in2@gmail>"]), { "In-Reply-To": "<in2@gmail>", References: "<in1@gmail> <out1@team> <in2@gmail>" });
  // Bad ids (header injection) are left out.
  assert.equal(replyHeaders("<in@x>", ["<a@x>\r\nBcc: evil@x.com", "nope"]).References, "<in@x>");
  // A long conversation keeps the first id and the newest.
  const ids = Array.from({ length: 40 }, (_, i) => `<m${i}@x>`);
  const refs = replyHeaders("<last@x>", ids).References.split(" ");
  assert.equal(refs.length, MAX_REFERENCES);
  assert.equal(refs[0], "<m0@x>");
  assert.equal(refs.at(-1), "<last@x>");
});

test("markdown to email HTML: headings, bold, lists, tables with numbers on the right, escaped, safe links only", () => {
  const html = markdownHtml("### This week\n\nVisits are **up**.\n\n| Page | Visits |\n| --- | --- |\n| Home | 1,204 |\n| <b>Menu</b> | 88 |\n\n- One\n- [Site](https://x.com) and [bad](javascript:alert(1))");
  assert.match(html, /<p style="[^"]*font-weight:600[^"]*">This week<\/p>/);
  assert.match(html, /<strong[^>]*>up<\/strong>/);
  assert.match(html, /<table role="presentation"[^>]*>/);
  assert.match(html, /<th align="left"[^>]*>Page<\/th>/);
  assert.match(html, /<td align="right"[^>]*>1,204<\/td>/);
  assert.match(html, /&lt;b&gt;Menu&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Menu/);
  assert.match(html, /<a href="https:\/\/x.com\/"[^>]*>Site<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /<ul[^>]*><li[^>]*>One<\/li>/);
  assert.equal(markdownText("### Hi\n\n**Bold** words\n\n\n\nEnd"), "Hi\n\nBold words\n\nEnd");
});

test("the answer email: subject Re:, the answer, each approval with Approve and Open, and Open in Morning Telos", () => {
  const m = teamReplyEmail({
    agent: "social",
    text: "I drafted **3 posts** for next week.",
    subject: "Fwd: posts for next week",
    approvals: [
      { id: 7, title: "Schedule 3 posts", approveUrl: "https://chat.test/api/email/approve?a=7&t=tok", openUrl: "https://chat.test/approvals/7" },
      { id: 8, title: "Post <now>", approveUrl: null, openUrl: "https://chat.test/approvals/8" },
    ],
    threadUrl: "https://chat.test/chat/t1",
    address: "acme@team.morningtelos.com",
  });
  assert.equal(m.subject, "Re: posts for next week");
  assert.match(m.html, /Leo answered/);
  assert.match(m.html, /<strong[^>]*>3 posts<\/strong>/);
  assert.match(m.html, /These 2 need your OK:/);
  assert.match(m.html, /Schedule 3 posts[\s\S]*href="https:\/\/chat.test\/api\/email\/approve\?a=7&amp;t=tok"[^>]*>Approve<\/a>[\s\S]*href="https:\/\/chat.test\/approvals\/7"[^>]*>Open<\/a>/);
  assert.match(m.html, /Post &lt;now&gt;/);
  assert.equal((m.html.match(/>Approve<\/a>/g) ?? []).length, 1, "no Approve link for the one the sender can't approve");
  assert.match(m.html, /Open it in Morning Telos to approve\./);
  assert.match(m.html, /href="https:\/\/chat.test\/chat\/t1"[^>]*>Open in Morning Telos<\/a>/);
  assert.match(m.text, /Approve: https:\/\/chat.test\/api\/email\/approve\?a=7&t=tok/);
  assert.match(m.text, /Open in Morning Telos: https:\/\/chat.test\/chat\/t1/);
  assert.match(m.text, /I drafted 3 posts for next week\./);
  assert.doesNotMatch(m.html + m.text, /[–—]/);

  const one = teamReplyEmail({ agent: "chief", text: "", subject: "", approvals: [], threadUrl: "https://chat.test/chat/t2", address: "a@b.com" });
  assert.equal(one.subject, "Re: Your email");
  assert.match(one.html, /Done\./);
  assert.doesNotMatch(one.html, /need your OK/);
});
