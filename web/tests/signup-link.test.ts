// The site's "Start free trial" link (https://chat.morningtelos.com/#signup) and /signup. Pure functions, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, wantsSignup, withoutSignup } from "../src/lib/routes.ts";

test("#signup and /signup ask for the sign-up form", () => {
  assert.equal(wantsSignup("/", "#signup"), true);
  assert.equal(wantsSignup("/", "#SignUp"), true);
  assert.equal(wantsSignup("/", "#/signup"), true);
  assert.equal(wantsSignup("/", "#signup/"), true);
  assert.equal(wantsSignup("/signup", ""), true);
  assert.equal(wantsSignup("/signup/", ""), true);
  assert.equal(wantsSignup("/SIGNUP", ""), true);
  assert.equal(wantsSignup("/settings", "#signup"), true);
});

test("other addresses open the normal sign-in form", () => {
  for (const [path, hash] of [
    ["/", ""],
    ["/", "#login"],
    ["/", "#home"],
    ["/", "#signups"],
    ["/", "#signup-now"],
    ["/signup/extra", ""],
    ["/signups", ""],
    ["/my/signup", ""],
    ["/invite/abcdefgh", ""],
  ]) {
    assert.equal(wantsSignup(path, hash), false, `${path}${hash}`);
  }
});

test("/signup is not a page of its own: signed in, it opens home", () => {
  assert.deepEqual(parseRoute("/signup"), { page: "home" });
  assert.deepEqual(parseRoute("/signup/"), { page: "home" });
});

test("signed in, the sign-up link leaves the address and the rest stays", () => {
  assert.equal(withoutSignup("/", "", "#signup"), "/");
  assert.equal(withoutSignup("/", "?utm_source=site", "#signup"), "/?utm_source=site");
  assert.equal(withoutSignup("/signup", "", ""), "/");
  assert.equal(withoutSignup("/signup/", "?ref=x", "#top"), "/?ref=x#top");
  assert.equal(withoutSignup("/signup", "", "#signup"), "/");
  assert.equal(withoutSignup("/settings", "", "#signup"), "/settings");
});

test("nothing to clean when there is no sign-up link", () => {
  assert.equal(withoutSignup("/", "", ""), null);
  assert.equal(withoutSignup("/chat", "?a=1", "#home"), null);
});
