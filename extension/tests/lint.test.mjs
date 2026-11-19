// The lint rules keep the extension from clicking, submitting or setting HTML on a page (eslint.config.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });
const errors = async (code) => (await eslint.lintText(code, { filePath: "src/example.js" }))[0].messages.map((m) => m.message);

test("code in src may not click, submit or set HTML", async () => {
  assert.deepEqual(await errors("document.querySelector('button').click();\n"), ["The extension never clicks for the person."]);
  assert.deepEqual(await errors("document.forms[0].submit();\n"), ["The extension never submits a form."]);
  assert.deepEqual(await errors("document.forms[0].requestSubmit();\n"), ["The extension never submits a form."]);
  assert.deepEqual(await errors("document.body.innerHTML = 'x';\n"), ["Build elements with textContent, never HTML."]);
  assert.deepEqual(await errors("document.body.textContent = 'x';\n"), []);
});
