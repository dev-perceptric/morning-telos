import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const envExample = read("../.env.example");
const compose = read("../../deploy/web-compose.yml");
const workflow = read("../../.github/workflows/build-images.yml");
const restoreWorkflow = read("../../.github/workflows/restore-test.yml");
const backupDockerfile = read("../Dockerfile.backup");

/** One service's block in web-compose.yml: its name line and everything indented under it. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `no ${name} service in deploy/web-compose.yml`);
  const lines = compose.slice(start + 1).split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() !== "" && !l.startsWith("    "));
  return lines.slice(0, end < 0 ? undefined : end).join("\n");
}
const envKeys = (block: string) => [...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*): /gm)].map((m) => m[1]);

const exampleKeys = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

test(".env.example lists each key once", () => {
  const seen = new Set<string>();
  for (const k of exampleKeys) {
    assert.ok(!seen.has(k), `${k} is listed twice in .env.example`);
    seen.add(k);
  }
});

test(".env.example lists keys with empty values only", () => {
  assert.ok(exampleKeys.length > 0);
  for (const line of envExample.split("\n")) {
    if (/^[A-Z][A-Z0-9_]*=/.test(line)) assert.match(line, /^[A-Z][A-Z0-9_]*=$/, `${line} must have an empty value`);
  }
});

// Keys for the nightly backup job (web/scripts/backup.ts), which runs in its own backup service.
// The web app must never hold the database superuser URL, so these stay out of the web-new service on purpose.
const BACKUP_ONLY = new Set(["BACKUP_DATABASE_URL", "BACKUP_PUBLIC_KEY", "BACKUP_PING_URL", "BACKUP_PREFIX"]);
const R2_KEYS = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
// The storage keys can read and delete backups, and the web app never uses them, so only the backup service gets them.
const BACKUP_SERVICE_ONLY = new Set([...BACKUP_ONLY, ...R2_KEYS]);
// Only deploy-web.sh uses it, to run scripts/migrate.mjs. The running app never gets the database password.
const DEPLOY_ONLY = new Set(["MIGRATE_DATABASE_URL"]);

test("web-compose.yml passes every key in .env.example from the server environment", () => {
  const web = service("web-new");
  for (const key of exampleKeys) {
    if (BACKUP_SERVICE_ONLY.has(key) || DEPLOY_ONLY.has(key)) continue;
    assert.ok(web.includes(`${key}: \${${key}:-}`), `the web-new service is missing ${key}: \${${key}:-}`);
  }
});

test("web-compose.yml has no key values written in it", () => {
  const values = [...compose.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*(.+)$/gm)];
  const allowed = new Set(["NODE_ENV", "PORT"]);
  for (const [, key, value] of values) {
    if (allowed.has(key)) continue;
    assert.equal(value.trim(), `\${${key}:-}`, `${key} must come from the server environment`);
  }
});

test("build workflow reads browser keys from repo variables, not literal values", () => {
  assert.doesNotMatch(workflow, /phc_[A-Za-z0-9]+/);
  assert.doesNotMatch(workflow, /https:\/\/[a-z0-9]+@[a-z0-9.]*sentry\.io/);
  for (const line of workflow.split("\n").filter((l) => /NEXT_PUBLIC_\w+=/.test(l))) {
    assert.match(line, /NEXT_PUBLIC_(\w+)=\$\{\{ vars\.NEXT_PUBLIC_\1 \}\}\s*$/, `${line.trim()} must use a repo variable`);
  }
});

test("web-compose.yml never gives the web app or the cron the backup job's keys", () => {
  for (const name of ["web-new", "cron"]) {
    for (const key of BACKUP_SERVICE_ONLY) assert.ok(!service(name).includes(key), `${key} must not be in the ${name} service`);
  }
});

test("every backup-only key is in .env.example", () => {
  for (const key of BACKUP_ONLY) assert.ok(exampleKeys.includes(key), `${key} is missing from .env.example`);
});

test("the backup service gets the backup and R2 keys and nothing else", () => {
  const backup = service("backup");
  assert.deepEqual(envKeys(backup).sort(), [...BACKUP_ONLY, ...R2_KEYS].sort());
  assert.match(backup, /image: ghcr\.io\/dev-perceptric\/morningtelos-backup:latest/);
  assert.match(backup, /restart: unless-stopped/);
  assert.match(backup, /init: true/);
  assert.doesNotMatch(backup, /ports:|labels:|traefik/);
});

test("the backup service reaches Postgres on the Supabase project's network", () => {
  assert.match(service("backup"), /networks: \[sb-morningtelos\]/);
  assert.match(compose, /\nnetworks:\n  sb-morningtelos:\n    external: true\n/);
  assert.doesNotMatch(service("web-new"), /networks:/);
});

test("the build workflow builds the backup image from web/Dockerfile.backup", () => {
  assert.match(workflow, /- image: morningtelos-backup\n\s+context: web\n\s+file: web\/Dockerfile\.backup/);
});

test("the backup image has pg_dump 17 first on the PATH and Node 22, and runs the nightly loop", () => {
  assert.match(backupDockerfile, /^FROM node:22-bookworm-slim$/m);
  assert.match(backupDockerfile, /install -y --no-install-recommends postgresql-client-17/);
  assert.match(backupDockerfile, /ENV PATH=\/usr\/lib\/postgresql\/17\/bin:\$PATH/);
  assert.match(backupDockerfile, /^USER node$/m);
  assert.match(backupDockerfile, /CMD \["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts\/backup-cron\.ts"\]/);
});

test("the backup image copies every file the backup scripts import, and no packages are needed", () => {
  const copied = new Set<string>();
  for (const m of backupDockerfile.matchAll(/^COPY (.+) \.\/(\S*)$/gm)) {
    const [srcs, dest] = [m[1].split(/\s+/), m[2]];
    for (const f of srcs) copied.add(dest ? `${dest}${f.slice(f.lastIndexOf("/") + 1)}` : f);
  }
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(copied.has(file), `web/Dockerfile.backup does not copy ${file}`);
    const text = read(`../${file}`);
    for (const [, spec] of text.matchAll(/^import [^;]*? from "([^"]+)";/gm)) {
      if (spec.startsWith(".")) walk(new URL(spec, `file:///${file}`).pathname.slice(1));
      else assert.match(spec, /^node:/, `${file} imports ${spec}, which the backup image doesn't install`);
    }
    for (const [, spec] of text.matchAll(/runScript\("([^"]+)"/g)) walk(new URL(spec, `file:///${file}`).pathname.slice(1));
  };
  walk("scripts/backup-cron.ts");
  for (const f of ["scripts/backup.ts", "scripts/restore.ts", "src/lib/backup.ts"]) assert.ok(seen.has(f), `${f} is not reached`);
});

test("the restore test runs weekly and by hand, and skips with a notice until its secrets are set", () => {
  assert.match(restoreWorkflow, /schedule:\n\s+# .*\n\s+- cron: "43 5 \* \* 0"/);
  assert.match(restoreWorkflow, /workflow_dispatch:/);
  assert.match(restoreWorkflow, /::notice title=Restore test skipped::/);
  assert.match(restoreWorkflow, /if: needs\.secrets\.outputs\.ready == 'true'/);
  assert.match(restoreWorkflow, /image: postgres:17\n/);
  assert.match(restoreWorkflow, /postgresql-client-17/);
  assert.match(restoreWorkflow, /scripts\/restore\.ts check latest/);
  assert.match(restoreWorkflow, /scripts\/restore\.ts load latest/);
  assert.match(restoreWorkflow, /BACKUP_PREFIX: \$\{\{ vars\.BACKUP_PREFIX \}\}/);
  for (const key of [...R2_KEYS, "BACKUP_PRIVATE_KEY"]) assert.match(restoreWorkflow, new RegExp(`${key}: \\$\\{\\{ secrets\\.${key} \\}\\}`));
  // The private key reaches only the step that decrypts.
  assert.equal(restoreWorkflow.match(/BACKUP_PRIVATE_KEY: \$\{\{ secrets\.BACKUP_PRIVATE_KEY \}\}/g)?.length, 2);
  assert.match(restoreWorkflow, /if: always\(\)\n\s+run: rm -rf "\$RESTORE_DIR"/);
});

test("web-compose.yml runs the job worker every minute with CRON_SECRET, over the private network", () => {
  const cron = compose.slice(compose.indexOf("\n  cron:"));
  assert.ok(compose.includes("\n  cron:"), "no cron service");
  assert.match(cron, /CRON_SECRET: \$\{CRON_SECRET:-\}/);
  assert.match(cron, /Authorization: Bearer \$\$CRON_SECRET/);
  assert.match(cron, /http:\/\/web-new:3000\/api\/worker/);
  assert.match(cron, /sleep 60/);
});

test("web-compose.yml sends the app's database calls straight to this VPS", () => {
  assert.match(compose, /extra_hosts:\n\s+- "db\.morningtelos\.com:host-gateway"/);
});


test("the app answers at chat.morningtelos.com only, ahead of the old app's router", () => {
  const web = service("web-new");
  assert.match(web, /routers\.morningtelos-web\.rule=Host\(`chat\.morningtelos\.com`\)\n/);
  assert.match(web, /routers\.morningtelos-web\.priority=\d{3,}/);
  assert.doesNotMatch(compose, /new\.morningtelos\.com/);
});

test("the app never gets the deploy's database address", () => {
  assert.equal(compose.includes("MIGRATE_DATABASE_URL"), false);
});

test("deploy-web.sh updates the database with the new image before it restarts the app", () => {
  const sh = readFileSync(new URL("../../deploy/deploy-web.sh", import.meta.url), "utf8");
  const migrate = sh.indexOf("node scripts/migrate.mjs");
  assert.ok(migrate > sh.indexOf("pull"), "migrate after pull");
  assert.ok(migrate < sh.indexOf(" up -d"), "migrate before up -d");
  const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /COPY --from=build \/app\/supabase \.\/supabase/);
  assert.match(docker, /COPY --from=build \/app\/scripts\/migrate\.mjs/);
});

test("the deploy finds the database itself and never prints its password", () => {
  const sh = readFileSync(new URL("../../deploy/deploy-web.sh", import.meta.url), "utf8");
  assert.match(sh, /supabase\/postgres:\*/);
  assert.match(sh, /MIGRATE_DB_NETWORK:-sb-morningtelos/);
  assert.match(sh, /docker run --rm --network "\$\{DB#\*@\}"/);
  assert.match(sh, /sed -n 's\/\^POSTGRES_PASSWORD=\/\/p'/);
  assert.equal(/echo[^\n]*PGPASSWORD|set -x/.test(sh), false);
});

test("the deploy script updates itself from the new image", () => {
  const sh = readFileSync(new URL("../../deploy/deploy-web.sh", import.meta.url), "utf8");
  const pull = sh.indexOf('"${COMPOSE[@]}" pull');
  const swap = sh.indexOf('exec bash "$NEW"');
  const migrate = sh.indexOf("node scripts/migrate.mjs");
  assert.ok(pull > 0 && swap > pull && migrate > swap, "it swaps in the newest copy after pull and before the database update");
  assert.match(sh, /--entrypoint cat "\$IMAGE" deploy-web\.sh/);
  assert.match(sh, /DEPLOY_DIR:-/);
  assert.match(sh, /trap 'rm -f "\$DEPLOY_TMP"' EXIT/);
});

test("the app image carries the newest deploy script", () => {
  const wf = readFileSync(new URL("../../.github/workflows/build-images.yml", import.meta.url), "utf8");
  assert.match(wf, /cp deploy\/deploy-web\.sh web\/deploy-web\.sh/);
  const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /COPY --from=build \/app\/deploy-web\.sh \.\/deploy-web\.sh/);
});

test("every deploy refreshes the website at the commit being deployed", () => {
  const sh = readFileSync(new URL("../../deploy/deploy-web.sh", import.meta.url), "utf8");
  const wf = readFileSync(new URL("../../.github/workflows/build-images.yml", import.meta.url), "utf8");
  const site = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  // The workflow runs on website changes and hands the server this commit.
  assert.match(wf, /- "site\/\*\*"/);
  assert.match(wf, /deploy-web\.sh "\$GITHUB_SHA"/);
  // The deploy can run with no app build, when only the website changed.
  assert.match(wf, /needs\.build\.result == 'skipped'/);
  // It fails unless morningtelos.com serves this commit's pages.
  assert.match(wf, /Check the website serves this commit/);
  // The server script reads the commit and recreates only the website container.
  assert.match(sh, /SSH_ORIGINAL_COMMAND/);
  assert.match(sh, /up -d --no-deps --force-recreate web/);
  assert.ok(sh.indexOf("refresh_site ||") > sh.indexOf('"${COMPOSE[@]}" up -d'), "the website refreshes after the app");
  // The website downloads the commit a deploy asks for, and main on a plain restart.
  assert.match(site, /tar\.gz\/\$\{SITE_REF:-refs\/heads\/main\}/);
  // The self-update keeps the commit passed by hand.
  assert.match(sh, /exec bash "\$NEW" "\$@"/);
});

test("scripts/deploy.sh no longer talks to the destroyed Hostinger server", () => {
  const sh = readFileSync(new URL("../../scripts/deploy.sh", import.meta.url), "utf8");
  assert.equal(/hostinger/i.test(sh), false);
  assert.match(sh, /gh workflow run build-images\.yml/);
});
