// The manifest, the build and the store zip (scripts/build.mjs), plus checks on what the extension's code may do.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { ALLOWED, build, checkManifest, devManifest } from "../scripts/build.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const listing = JSON.parse(readFileSync(join(ROOT, "store-listing.json"), "utf8"));

test("the manifest is version 1.0.0 with only the permissions we explain", () => {
  assert.deepEqual(checkManifest(manifest), []);
  assert.equal(manifest.version, "1.0.0");
  assert.equal(listing.version, manifest.version);
  for (const p of manifest.permissions) assert.ok(listing.permissions[p], `store-listing.json explains ${p}`);
  for (const h of manifest.host_permissions) assert.ok(listing.permissions[`host_${new URL(h.replace("/*", "")).hostname}`], `store-listing.json explains ${h}`);
  assert.deepEqual(checkManifest({ ...manifest, permissions: [...manifest.permissions, "tabs"] }), ["permissions: tabs is not allowed"]);
  assert.deepEqual(checkManifest({ ...manifest, host_permissions: ["<all_urls>"] }), ["host_permissions: <all_urls> is not allowed"]);
  assert.ok(listing.summary.length <= 132);
  assert.equal(listing.summary, manifest.description);
});

test("the shortcut is free: not Ctrl+J, which Chrome keeps for Downloads", () => {
  const key = manifest.commands._execute_action.suggested_key;
  assert.equal(key.default, "Alt+Shift+J");
  assert.notEqual(key.default, "Ctrl+J");
});

test("the store build has no localhost; the dev build adds it", () => {
  assert.ok(!JSON.stringify(manifest).includes("localhost"));
  const dev = devManifest(manifest);
  assert.ok(dev.host_permissions.includes("http://localhost:3000/*"));
  assert.ok(dev.content_scripts[0].matches.includes("http://localhost:3000/*"));
});

test("build writes dist/ and a store zip that unpacks to the same files", () => {
  const root = mkdtempSync(join(tmpdir(), "mt-ext-"));
  for (const d of ["src", "icons"]) cpSync(join(ROOT, d), join(root, d), { recursive: true });
  cpSync(join(ROOT, "manifest.json"), join(root, "manifest.json"));
  const out = build({ root });
  assert.ok(existsSync(join(out.dist, "manifest.json")));
  assert.ok(out.zip.endsWith("morning-telos-1.0.0.zip"));
  assert.ok(out.files.includes("src/sidepanel.html") && out.files.includes("icons/128.png") && out.files.includes("manifest.json"));
  // Read the zip back: every file is there, whole.
  const zip = readFileSync(out.zip);
  const names = [];
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50; ) {
    const size = zip.readUInt32LE(at + 18);
    const nameLen = zip.readUInt16LE(at + 26);
    const name = zip.subarray(at + 30, at + 30 + nameLen).toString();
    const body = inflateRawSync(zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size));
    assert.deepEqual(body, readFileSync(join(out.dist, name)), name);
    names.push(name);
    at += 30 + nameLen + size;
  }
  assert.deepEqual(names.sort(), [...out.files].sort());
});

test("the background never reads a page; nothing loads remote code", () => {
  const bg = readFileSync(join(ROOT, "src/background.js"), "utf8");
  assert.doesNotMatch(bg, /executeScript|captureVisibleTab|tabs\.query/, "the background never reads a tab");
  for (const f of readdirSync(join(ROOT, "src"))) {
    const s = readFileSync(join(ROOT, "src", f), "utf8");
    assert.doesNotMatch(s, /\beval\(|new Function\(|<script[^>]+src="https?:/, f);
  }
  assert.deepEqual(ALLOWED.host_permissions, manifest.host_permissions);
});
