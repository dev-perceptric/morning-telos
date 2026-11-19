import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

// The extension's rules. Beyond the usual checks, the code that runs in the extension may never click, submit or
// send a form on a page, and never sets HTML from text (a page or a reply could hide code in it).
const NEVER = [
  { selector: "CallExpression[callee.property.name='click']", message: "The extension never clicks for the person." },
  { selector: "CallExpression[callee.property.name='submit']", message: "The extension never submits a form." },
  { selector: "CallExpression[callee.property.name='requestSubmit']", message: "The extension never submits a form." },
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: "Build elements with textContent, never HTML." },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Build elements with textContent, never HTML." },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: "Build elements with textContent, never HTML." },
];

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.webextensions } },
    rules: { "no-restricted-syntax": ["error", ...NEVER], "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["src/content-app.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
  },
]);
