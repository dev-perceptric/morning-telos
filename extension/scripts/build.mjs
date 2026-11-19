// Builds the extension into dist/ and a zip for the Chrome Web Store: morning-telos-<version>.zip.
//   npm run build            the store build: only the permissions in ALLOWED below.
//   npm run build -- --dev   also allows the app on localhost:3000 (and its Supabase on localhost:54321), for testing
//                            against `npm run dev` in web/. Never upload a dev build.
// It checks the manifest first: the version, only the permissions we explain in store-listing.json, and that every
// file the manifest names is there.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeZip } from "./zip.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The only permissions the extension may ask for. Each one is explained in store-listing.json. */
export const ALLOWED = {
  permissions: ["sidePanel", "storage", "contextMenus", "activeTab", "scripting", "alarms"],
  host_permissions: ["https://chat.morningtelos.com/*", "https://db.morningtelos.com/*", "https://mail.google.com/*"],
};
const DEV_HOSTS = ["http://localhost:3000/*", "http://localhost:54321/*"];

/** Problems with a manifest, as short lines. Empty when it is fine. */
export function checkManifest(m, root = ROOT) {
  const out = [];
  if (m.manifest_version !== 3) out.push("manifest_version must be 3");
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? "")) out.push("version must look like 1.0.0");
  for (const key of ["permissions", "host_permissions"]) for (const p of m[key] ?? []) if (!ALLOWED[key].includes(p)) out.push(`${key}: ${p} is not allowed`);
  if (m.optional_permissions?.length || m.optional_host_permissions?.length) out.push("no optional permissions");
  if ((m.description ?? "").length > 132) out.push("description must be 132 characters or fewer");
  const files = [m.background?.service_worker, m.side_panel?.default_path, ...Object.values(m.icons ?? {}), ...Object.values(m.action?.default_icon ?? {}), ...(m.content_scripts ?? []).flatMap((c) => c.js ?? [])];
  for (const f of files) if (!f || !existsSync(join(root, f))) out.push(`missing file: ${f}`);
  return out;
}

/** The manifest for a dev build: the app and Supabase on localhost too. */
export function devManifest(m) {
  return {
    ...m,
    name: `${m.name} (dev)`,
    host_permissions: [...m.host_permissions, ...DEV_HOSTS],
    content_scripts: m.content_scripts.map((c) => ({ ...c, matches: [...c.matches, "http://localhost:3000/*"] })),
  };
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function build({ dev = false, root = ROOT } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const problems = checkManifest(manifest, root);
  if (problems.length) throw new Error(`manifest.json:\n- ${problems.join("\n- ")}`);
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, "src"), join(dist, "src"), { recursive: true });
  mkdirSync(join(dist, "icons"));
  for (const f of readdirSync(join(root, "icons"))) if (f.endsWith(".png")) cpSync(join(root, "icons", f), join(dist, "icons", f));
  writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(dev ? devManifest(manifest) : manifest, null, 2)}\n`);
  const files = Object.fromEntries(walk(dist).map((p) => [relative(dist, p).split("\\").join("/"), readFileSync(p)]));
  const zip = join(root, `morning-telos-${manifest.version}${dev ? "-dev" : ""}.zip`);
  writeFileSync(zip, makeZip(files));
  return { dist, zip, files: Object.keys(files) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build({ dev: process.argv.includes("--dev") });
  console.log(`Built ${out.files.length} files into ${relative(process.cwd(), out.dist) || "."}/ and ${relative(process.cwd(), out.zip)}`);
}
