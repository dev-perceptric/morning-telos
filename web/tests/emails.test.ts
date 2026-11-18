// Account email templates: each renders with its link and code, in plain words, with names escaped.
import assert from "node:assert/strict";
import test from "node:test";
import { esc, renderEmail, type Email } from "../src/lib/emailKit.ts";
import { authEmail, securityNoticeEmail, type AuthKind } from "../src/lib/emails.ts";

const url = "https://db.example.test/auth/v1/verify?token=hash123&type=signup&redirect_to=https%3A%2F%2Fchat.morningtelos.com";
const KINDS: AuthKind[] = ["confirm", "magic", "recovery", "invite", "email_change_old", "email_change_new", "reauth"];
const NOTICES = [
  "password_changed_notification",
  "email_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
  "phone_changed_notification",
];

const auth = (k: AuthKind) => authEmail(k, { url, email: "ana@example.com", code: "123456", newEmail: "new@example.com", oldEmail: "ana@example.com", name: "Ana Lopez", inviter: "Sam", workspace: "Acme Plumbing" });
const notice = (k: string) => securityNoticeEmail(k, { email: "ana@example.com", detail: "google", settingsUrl: "https://chat.morningtelos.com/settings", resetUrl: "https://chat.morningtelos.com" })!;
const all: [string, Email][] = [...KINDS.map((k) => [k, auth(k)] as [string, Email]), ...NOTICES.map((k) => [k, notice(k)] as [string, Email])];

test("every email has a subject, a preview line, the Morning Telos look, a plain-text copy and a footer", () => {
  for (const [name, m] of all) {
    assert.ok(m.subject.length > 5 && !/[\r\n]/.test(m.subject), name);
    assert.ok(m.preview.length > 5, name);
    assert.ok(m.html.includes(esc(m.preview)), `${name} preview`);
    assert.match(m.html, /background:#faf9f5/, name);
    assert.match(m.html, /font-family:Georgia/, name);
    assert.match(m.html, />Morning Telos</, name);
    assert.ok(m.text.startsWith("Morning Telos\n"), name);
    assert.match(m.text, /\n--\nSent by Morning Telos to ana@example\.com/, name);
  }
});

test("no email has an em dash or an en dash", () => {
  for (const [name, m] of all) assert.doesNotMatch(m.subject + m.preview + m.html + m.text, /[—–]/, name);
});

test("every auth email with a link has the verify link as its button, in the HTML and the text", () => {
  for (const k of KINDS.filter((x) => x !== "reauth")) {
    const m = auth(k);
    assert.ok(m.html.includes(`href="${esc(url)}"`), `${k} button`);
    assert.ok(m.html.includes(`Or paste this link: ${esc(url)}`), `${k} paste link`);
    assert.ok(m.text.includes(url), `${k} text link`);
  }
  assert.doesNotMatch(auth("reauth").html, /<a href="https:\/\/db\.example\.test/);
});

test("the code shows in the emails that use one, and not in the invite", () => {
  for (const k of ["confirm", "magic", "recovery", "email_change_old", "email_change_new", "reauth"] as AuthKind[]) {
    const m = auth(k);
    assert.ok(m.html.includes(">123456</div>"), `${k} html code`);
    assert.match(m.text, /: 123456/, `${k} text code`);
  }
  assert.doesNotMatch(auth("invite").html + auth("invite").text, /123456/);
  assert.equal(auth("magic").subject, "123456 is your Morning Telos login code");
  assert.equal(auth("reauth").subject, "123456 is your Morning Telos security code");
  const noCode = authEmail("magic", { url, email: "ana@example.com" });
  assert.equal(noCode.subject, "Log in to Morning Telos");
  assert.doesNotMatch(noCode.html, /Or enter this code/);
});

test("the confirm email greets by first name and the invite says who sent it", () => {
  assert.match(auth("confirm").html, /Welcome, Ana</);
  assert.match(authEmail("confirm", { url, email: "a@b.co" }).text, /^Morning Telos\n\nWelcome to Morning Telos\n/);
  const inv = auth("invite");
  assert.equal(inv.subject, "Sam invited you to Morning Telos");
  assert.match(inv.text, /Sam invited ana@example\.com to join the Acme Plumbing team on Morning Telos\./);
  const anon = authEmail("invite", { url, email: "a@b.co" });
  assert.equal(anon.subject, "You're invited to Morning Telos");
  assert.match(anon.text, /a@b\.co was invited to join a team on Morning Telos\./);
});

test("the email change emails name the old and the new address", () => {
  assert.match(auth("email_change_old").text, /from ana@example\.com to new@example\.com/);
  const n = authEmail("email_change_new", { url, email: "new@example.com", oldEmail: "ana@example.com" });
  assert.match(n.text, /Confirm new@example\.com as the new email/);
  assert.match(n.text, /It replaces ana@example\.com\./);
});

test("security notices have reset and settings links, and unknown kinds send nothing", () => {
  for (const k of NOTICES) {
    const m = notice(k);
    assert.ok(m.html.includes('href="https://chat.morningtelos.com"'), k);
    assert.ok(m.html.includes('href="https://chat.morningtelos.com/settings"'), k);
  }
  assert.match(notice("identity_linked_notification").text, /You can now log in to your Morning Telos account with Google\./);
  assert.match(notice("identity_unlinked_notification").text, /You can no longer log in to your Morning Telos account with Google\./);
  assert.doesNotMatch(notice("password_changed_notification").html, /Or paste this link/);
  assert.equal(securityNoticeEmail("something_new", { email: "a@b.co", settingsUrl: "x", resetUrl: "y" }), null);
});

test("names and other user text are escaped, so they can't add HTML", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const m = authEmail("invite", { url, email: "a@b.co", inviter: `Eve ${evil}`, workspace: `<script>alert(1)</script>` });
  const c = authEmail("confirm", { url, email: "a@b.co", name: `<b>Bob</b>` });
  const n = securityNoticeEmail("email_changed_notification", { email: "a@b.co", detail: evil, settingsUrl: "s", resetUrl: "r" })!;
  for (const x of [m, c, n]) {
    assert.doesNotMatch(x.html, /<img src=x|<script>|<b>Bob/);
  }
  assert.match(m.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(c.html, /Welcome, &lt;b&gt;Bob&lt;\/b&gt;/);
});

test("links that aren't http, https or mailto are dropped, and subjects stay on one line", () => {
  const m = renderEmail({ subject: "Hi\r\nBcc: x@y.z", preview: "p", title: "t", blocks: [], button: { label: "Go", url: "javascript:alert(1)" }, footer: { text: "f" } });
  assert.doesNotMatch(m.html, /javascript:/);
  assert.match(m.html, /href="#"/);
  assert.equal(m.subject, "Hi Bcc: x@y.z");
});

// ─────────────── trial and lifecycle emails ───────────────
import { aiAllowanceEmail, trialDay12Email, trialDay7Email, trialEndedEmail, trialLastDayEmail, weeklyDigestEmail } from "../src/lib/emails.ts";

const owner = { email: "ana@example.com", workspace: "Ana's <Bakery>", appUrl: "https://chat.example.test", timezone: "America/Chicago" };
const ends = new Date("2026-11-30T21:30:00Z");
const stats = { chats: 1, approvals: 2, routines: 0 };
const unsub = "https://chat.example.test/api/email/unsubscribe?t=abc";
const life: [string, Email][] = [
  ["day7", trialDay7Email(owner, stats)],
  ["day7 quiet", trialDay7Email(owner, { chats: 0, approvals: 0, routines: 0 })],
  ["day12", trialDay12Email(owner, ends)],
  ["last", trialLastDayEmail(owner, ends, new Date("2026-11-30T15:00:00Z"))],
  ["ended", trialEndedEmail(owner)],
  ["ai trial", aiAllowanceEmail(owner, { percent: 82.4, trial: true, top: false })],
  ["ai paid", aiAllowanceEmail(owner, { percent: 90, trial: false, top: false })],
  ["digest", weeklyDigestEmail(owner, stats, { from: new Date("2026-11-16T06:00:00Z"), to: new Date("2026-11-23T06:00:00Z") }, unsub)],
];

test("lifecycle emails have the look, a footer for the owner, no dashes and the workspace name escaped", () => {
  for (const [name, m] of life) {
    assert.match(m.html, /background:#faf9f5/, name);
    assert.ok(m.text.startsWith("Morning Telos\n"), name);
    assert.match(m.text, /\n--\nSent to ana@example\.com because you own Ana's <Bakery> on Morning Telos\./, name);
    assert.ok(m.html.includes("Ana&#39;s &lt;Bakery&gt;"), name);
    assert.doesNotMatch(m.html, /<Bakery>/, name);
    assert.doesNotMatch(m.subject + m.preview + m.html + m.text, /[—–]/, name);
  }
});

test("trial emails say when the trial ends in the workspace's time zone and link to Billing", () => {
  const d12 = trialDay12Email(owner, ends);
  assert.equal(d12.subject, "Your free trial ends in 2 days");
  assert.match(d12.text, /ends on Monday, November 30 at 3:30 PM\./);
  assert.match(d12.text, /Starter: \$49 a month/);
  assert.match(d12.text, /Pick a plan: https:\/\/chat\.example\.test\/billing/);
  assert.equal(trialLastDayEmail(owner, ends, new Date("2026-11-30T15:00:00Z")).subject, "Your free trial ends today");
  // A trial ending at 7 AM gets its last-day email the morning before.
  const early = trialLastDayEmail(owner, new Date("2026-11-30T13:00:00Z"), new Date("2026-11-29T15:00:00Z"));
  assert.equal(early.subject, "Your free trial ends tomorrow");
  assert.match(early.text, /ends tomorrow at 7:00 AM\./);
  assert.equal(trialEndedEmail(owner).subject, "Your AI team is paused");
});

test("day 7 shows the stats, or a nudge when the team has done nothing yet", () => {
  const [, d7] = life[0];
  assert.match(d7.text, /- 1 chat\n- 2 approvals done\n- 0 routines run/);
  assert.match(d7.text, /Tag a teammate with @/);
  assert.match(life[1][1].text, /no work yet/);
  assert.doesNotMatch(life[1][1].text, /0 chats/);
});

test("the AI allowance email rounds the percent and says what happens next", () => {
  assert.equal(life[5][1].subject, "Your team used 82% of its AI allowance");
  assert.match(life[5][1].text, /free trial/);
  assert.match(life[6][1].text, /Upgrade your plan for more/);
  assert.doesNotMatch(aiAllowanceEmail(owner, { percent: 85, trial: false, top: true }).text, /Upgrade/);
});

test("only the digest has an unsubscribe link, and it covers Monday to Sunday", () => {
  const d = weeklyDigestEmail(owner, stats, { from: new Date("2026-11-16T06:00:00Z"), to: new Date("2026-11-23T06:00:00Z") }, unsub);
  assert.ok(d.html.includes(`href="${esc(unsub)}"`));
  assert.ok(d.text.endsWith(`Unsubscribe: ${unsub}`));
  assert.match(d.text, /from Nov 16 to Nov 22\./);
  for (const [name, m] of life.filter(([n]) => n !== "digest")) assert.doesNotMatch(m.text, /Unsubscribe/, name);
});

test("a list block renders as bullets in HTML and dashes in text", () => {
  const m = renderEmail({ subject: "s", preview: "p", title: "t", blocks: [{ t: "list", items: ["one <b>", "two"] }], footer: { text: "f", links: [{ label: "L", url: "https://x.test/" }] } });
  assert.match(m.html, /&bull;<\/td><td[^>]*>one &lt;b&gt;<\/td>/);
  assert.match(m.text, /- one <b>\n- two/);
  assert.match(m.html, /<a href="https:\/\/x\.test\/"[^>]*>L<\/a>/);
  assert.ok(m.text.endsWith("f\nL: https://x.test/"));
});
