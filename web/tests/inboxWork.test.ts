// Irene's Inbox tab (src/lib/inboxWork.ts): her replies read from her approvals.
import assert from "node:assert/strict";
import test from "node:test";
import { faqOf, inboxSummary, repliesOf } from "../src/lib/inboxWork.ts";

const NOW = Date.parse("2027-01-08T12:00:00Z");
const row = (o: Partial<{ id: number; product: string; tool: string; title: string; input: Record<string, unknown> | null; status: string; result: string | null; created_at: string }>) => ({
  id: 1,
  product: "gmail",
  tool: "GMAIL_REPLY_TO_THREAD",
  title: "Reply to an email",
  input: { recipient_email: "jenna@park.com", subject: "Re: Where is my report?", message_body: "Hi Jenna, it goes out on the 1st." },
  status: "pending",
  result: null,
  created_at: "2027-01-07T10:00:00Z",
  finished_at: null,
  ...o,
});

test("repliesOf: Irene's replies with who, subject and words, from her support apps only", () => {
  const r = repliesOf([
    row({ id: 1 }),
    row({ id: 2, status: "done", product: "outlook", tool: "OUTLOOK_SEND_EMAIL", input: { to: ["luis@shop.com"], subject: "Second location", body: "Yes, we can track it." } }),
    row({ id: 3, status: "failed", result: "Connect Gmail again in Settings, Apps." }),
    row({ id: 4, product: "slack", input: { text: "hi" } }),
    row({ id: 5, input: { label: "Done" } }),
    row({ id: 6, status: "denied" }),
  ]);
  assert.deepEqual(
    r.map((x) => [x.approvalId, x.status, x.to, x.subject, x.app, x.why]),
    [
      [1, "wait", "jenna@park.com", "Re: Where is my report?", "Gmail", null],
      [2, "sent", "luis@shop.com", "Second location", "Outlook", null],
      [3, "failed", "jenna@park.com", "Re: Where is my report?", "Gmail", "Connect Gmail again in Settings, Apps."],
      [6, "denied", "jenna@park.com", "Re: Where is my report?", "Gmail", null],
    ],
  );
  assert.equal(r[0].body, "Hi Jenna, it goes out on the 1st.");
});

test("inboxSummary: this week's answers and what waits", () => {
  const r = repliesOf([row({ id: 1 }), row({ id: 2, status: "done", created_at: "2027-01-06T10:00:00Z" }), row({ id: 3, status: "done", created_at: "2026-12-01T10:00:00Z" })]);
  assert.equal(inboxSummary(r, NOW), "I answered 1 customer this week, and 1 reply waits for your OK.");
  assert.equal(inboxSummary([], NOW), null);
});

test("faqOf turns a reply into a question and answer for Knowledge", () => {
  assert.deepEqual(faqOf({ subject: "Re: Where is my report?", body: "It goes out on the 1st." }), { title: "FAQ: Where is my report?", body: "Question: Where is my report?\n\nAnswer:\nIt goes out on the 1st." });
  assert.equal(faqOf({ subject: "", body: "x" }).title, "FAQ: Customer question");
});
