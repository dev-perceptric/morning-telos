// Hephaestus's Pages tab (src/lib/pagesWork.ts): his site changes read from his approvals.
import assert from "node:assert/strict";
import test from "node:test";
import { bodyIn, pagesOf, pagesSummary, plainText, titleIn, urlIn } from "../src/lib/pagesWork.ts";

const row = (o: Partial<{ id: number; product: string; tool: string; title: string; input: Record<string, unknown> | null; status: string; result: string | null }>) => ({
  id: 1,
  product: "wordpress",
  tool: "wordpress_create_page",
  title: "Add a draft page to WordPress",
  input: { title: "AI SEO audit", content: "<h2>Find out</h2><p>Where your business shows up &amp; what to fix.</p>" },
  status: "pending",
  result: null,
  created_at: "2027-01-05T10:00:00Z",
  finished_at: null,
  ...o,
});

test("plainText turns HTML or Markdown into a short plain preview", () => {
  assert.equal(plainText("<h2>Find out</h2><p>Where you show up &amp; why.</p><script>x()</script>"), "Find out Where you show up & why.");
  assert.equal(plainText("## Title\n\n**Bold** words"), "Title Bold words");
  assert.equal(plainText("one two three four five", 12), "one two...");
  assert.equal(plainText(""), null);
  assert.equal(plainText(42), null);
});

test("titleIn and bodyIn read each builder's own fields", () => {
  assert.equal(titleIn({ title: "Pricing" }), "Pricing");
  assert.equal(titleIn({ fieldData: { name: "Plumber SEO", "post-body": "<p>Hi</p>" } }), "Plumber SEO");
  assert.equal(titleIn({ article: { title: "News", body_html: "x" } }), "News");
  assert.equal(titleIn({}), "");
  assert.equal(bodyIn({ fieldData: { "post-body": "<p>Hi</p>" } }), "<p>Hi</p>");
  assert.equal(bodyIn({ body_html: "<p>Shop</p>" }), "<p>Shop</p>");
});

test("urlIn finds the link the builder gave back, https only", () => {
  assert.equal(urlIn('{"id":5,"link":"https://blog.example.com/ai-seo-audit/"}'), "https://blog.example.com/ai-seo-audit/");
  assert.equal(urlIn('Done.\n\n{"data":{"url":"https://example.webflow.io/post/x"}}'), "https://example.webflow.io/post/x");
  assert.equal(urlIn('{"link":"javascript:alert(1)"}'), null);
  assert.equal(urlIn("not json"), null);
  assert.equal(urlIn(null), null);
});

test("pagesOf: waiting, done and failed pages from Hephaestus's site changes only", () => {
  const pages = pagesOf([
    row({ id: 1 }),
    row({ id: 2, status: "done", result: '{"link":"https://blog.example.com/p"}' }),
    row({ id: 3, product: "webflow", tool: "WEBFLOW_PUBLISH_SITE", title: "Publish your Webflow site", input: {}, status: "done" }),
    row({ id: 4, status: "failed", result: "WordPress said the site is down." }),
    row({ id: 5, tool: "wordpress_upload_image" }),
    row({ id: 6, product: "gmail", tool: "GMAIL_SEND_EMAIL" }),
    row({ id: 7, status: "denied" }),
  ]);
  assert.deepEqual(
    pages.map((p) => [p.approvalId, p.status, p.title, p.site, p.url, p.live, p.why]),
    [
      [1, "wait", "AI SEO audit", "WordPress", null, false, null],
      [2, "done", "AI SEO audit", "WordPress", "https://blog.example.com/p", false, null],
      [3, "done", "Publish your Webflow site", "Webflow", null, true, null],
      [4, "failed", "AI SEO audit", "WordPress", null, false, "WordPress said the site is down."],
      [7, "denied", "AI SEO audit", "WordPress", null, false, null],
    ],
  );
  assert.equal(pages[0].preview, "Find out Where your business shows up & what to fix.");
});

test("pagesSummary: one plain line", () => {
  assert.equal(pagesSummary([]), null);
  const p = pagesOf([row({ id: 1 }), row({ id: 2, status: "done" }), row({ id: 3, status: "done" })]);
  assert.equal(pagesSummary(p), "2 pages on your site, and 1 waits for your OK. Nothing goes live until you approve it.");
});
