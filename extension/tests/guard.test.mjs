// The block list (src/guard.js): Chrome's own pages, the Chrome Web Store, banks, payments and password managers.
import assert from "node:assert/strict";
import test from "node:test";
import { BLOCK_LINES, blockReason, isBlockedUrl } from "../src/guard.js";

test("Chrome's own pages and anything that isn't a web page are blocked", () => {
  for (const u of ["chrome://settings", "chrome-extension://abc/page.html", "edge://flags", "about:blank", "file:///etc/passwd", "view-source:https://a.com", "devtools://x", "data:text/html,hi", "javascript:alert(1)", "", "not a url"]) {
    assert.equal(blockReason(u), "browser", u);
  }
});

test("the Chrome Web Store is blocked", () => {
  assert.equal(blockReason("https://chromewebstore.google.com/detail/x"), "store");
  assert.equal(blockReason("https://chrome.google.com/webstore/detail/x"), "store");
  assert.equal(blockReason("https://chrome.google.com/other"), null);
});

test("banks, payments and password managers are blocked, with their subdomains", () => {
  for (const u of ["https://www.chase.com/", "https://secure.wellsfargo.com/x", "https://www.paypal.com", "https://my.1password.com", "https://vault.bitwarden.com/#/", "https://accounts.google.com/signin", "https://passwords.google.com", "https://dashboard.stripe.com/payments", "https://www.mybank.co.uk/", "https://online.firstbankofohio.com"]) {
    assert.equal(blockReason(u), "private", u);
  }
});

test("ordinary sites, Gmail and LinkedIn can be read on a click", () => {
  for (const u of ["https://anasbakery.com/menu", "https://mail.google.com/mail/u/0/#inbox", "https://www.linkedin.com/in/someone", "https://stripe.com/pricing", "https://notchase.com.example.org/"]) {
    assert.equal(isBlockedUrl(u), false, u);
  }
});

test("every reason has one short line, with no dashes", () => {
  for (const [k, line] of Object.entries(BLOCK_LINES)) {
    assert.ok(line.length < 120, k);
    assert.doesNotMatch(line, /[–—]/);
  }
});
