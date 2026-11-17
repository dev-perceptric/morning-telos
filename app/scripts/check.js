// Syntax-checks every .js file in the app, and checks public/app.js for common mistakes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f); else if (f.endsWith(".js")) files.push(f);
  }
})(root);

let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { bad++; console.error(`✗ ${path.relative(root, f)}\n${e.stderr}`); }
}
// Secrets must never be committed.
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  if (/sk-ant-[a-zA-Z0-9_-]{20,}|sk_live_[a-zA-Z0-9]{20,}|re_[a-zA-Z0-9]{20,}_/.test(s)) { bad++; console.error(`✗ ${path.relative(root, f)} looks like it contains an API key`); }
}
if (bad) { console.error(`\n${bad} problem(s)`); process.exit(1); }
console.log(`✓ ${files.length} files OK`);
