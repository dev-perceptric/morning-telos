import assert from "node:assert/strict";
import test from "node:test";
import { cleanEmail, ipFrom, isLocked, LIMITS } from "../src/lib/lockout.ts";
import { strength } from "../src/lib/passwordCheck.ts";
import { cleanTimezone, cleanWebsite, signupMeta } from "../src/lib/signup.ts";

test("lockout: under every limit is fine", () => {
  assert.equal(isLocked({ pair: LIMITS.pair - 1, ip: LIMITS.ip - 1, emailHour: LIMITS.emailHour - 1 }), false);
});

test("lockout: 5 wrong passwords for one email from one address locks it", () => {
  assert.equal(isLocked({ pair: 5, ip: 5, emailHour: 5 }), true);
});

test("lockout: 20 wrong tries from one address locks it, whatever the email", () => {
  assert.equal(isLocked({ pair: 0, ip: 20, emailHour: 0 }), true);
});

test("lockout: 30 wrong tries for one email in an hour locks it, from anywhere", () => {
  assert.equal(isLocked({ pair: 0, ip: 0, emailHour: 30 }), true);
});

test("ip: the proxy's real-ip wins, then the last forwarded address", () => {
  assert.equal(ipFrom("1.2.3.4", "9.9.9.9"), "1.2.3.4");
  // A client can send its own X-Forwarded-For; the proxy appends the real one last.
  assert.equal(ipFrom(null, "6.6.6.6, 5.5.5.5"), "5.5.5.5");
  assert.equal(ipFrom(null, null), "");
});

test("emails are trimmed and lowercased, and junk is rejected", () => {
  assert.equal(cleanEmail("  Ana@Example.COM "), "ana@example.com");
  assert.equal(cleanEmail("not an email"), "");
  assert.equal(cleanEmail(undefined), "");
});

test("websites are cleaned to a bare host", () => {
  assert.equal(cleanWebsite("https://www.Shop.com/"), "www.shop.com");
  assert.equal(cleanWebsite("shop.com/about"), "shop.com/about");
  assert.equal(cleanWebsite("not a site"), "");
  assert.equal(cleanWebsite(""), "");
});

test("bad time zones fall back to the default", () => {
  assert.equal(cleanTimezone("Asia/Ho_Chi_Minh"), "Asia/Ho_Chi_Minh");
  assert.equal(cleanTimezone("Mars/Base"), "America/Chicago");
  assert.equal(cleanTimezone(undefined), "America/Chicago");
});

test("sign-up metadata is trimmed and capped", () => {
  const m = signupMeta({ name: "  Ana  ", business: "x".repeat(500), website: "HTTPS://anas.com/", timezone: "Nope/Nope" });
  assert.equal(m.name, "Ana");
  assert.equal(m.business.length, 120);
  assert.equal(m.website, "anas.com");
  assert.equal(m.timezone, "America/Chicago");
});

test("password strength: weak, common and strong", () => {
  assert.equal(strength("short").score, 1);
  assert.equal(strength("morningtelos123").score, 1);
  assert.equal(strength("Blue-Kettle-Rain-42").score, 4);
});
