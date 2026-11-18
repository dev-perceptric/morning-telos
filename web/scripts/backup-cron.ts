// The backup service's loop (deploy/web-compose.yml, service backup). Every night at 03:17 UTC it runs
// scripts/backup.ts. On Sundays, after the backup, it runs "restore.ts check": the newest backup is there, recent,
// matches its manifest and has rows in our key tables. That check needs no private key, which never lives on the
// server. The full restore test (decrypt and load) runs in GitHub Actions (.github/workflows/restore-test.yml).
//
// Each run is its own Node process, so a failed night never stops the loop. backup.ts calls BACKUP_PING_URL itself;
// a failed Sunday check calls BACKUP_PING_URL/fail, so the same heartbeat monitor reports it.
//
//   node scripts/backup-cron.ts
import { spawn } from "node:child_process";
import { isCheckDay, nextBackupAt } from "../src/lib/backup.ts";
import { log } from "./shell.ts";

const say = (msg: string) => log("backup-cron", msg);

/** Sleeps in short steps and reads the clock again each time, so a paused or changed clock can't skip a night. */
async function sleepUntil(at: Date) {
  while (Date.now() < at.getTime()) {
    await new Promise((r) => setTimeout(r, Math.min(at.getTime() - Date.now(), 300_000)));
  }
}

/** Runs one of the scripts next to this one in a new Node process. True when it exited 0. */
function runScript(file: string, args: string[] = []): Promise<boolean> {
  const script = new URL(file, import.meta.url).pathname;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], { stdio: "inherit" });
    p.on("error", (e) => {
      say(`could not start ${file}: ${e.message}`);
      resolve(false);
    });
    p.on("close", (code) => resolve(code === 0));
  });
}

async function pingFail() {
  const url = (process.env.BACKUP_PING_URL ?? "").trim();
  if (!url) return;
  try {
    await fetch(url.replace(/\/+$/, "") + "/fail", { signal: AbortSignal.timeout(10_000) });
  } catch {
    say("could not reach BACKUP_PING_URL");
  }
}

// docker stop sends SIGTERM. Stop at once instead of waiting to be killed.
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => process.exit(0));

async function main() {
  for (;;) {
    const at = nextBackupAt(new Date());
    say(`next backup at ${at.toISOString()}${isCheckDay(at) ? ", then the weekly check" : ""}`);
    await sleepUntil(at);
    if (!(await runScript("backup.ts"))) say("the backup failed (see above)");
    if (isCheckDay(at) && !(await runScript("restore.ts", ["check", "latest"]))) {
      say("the weekly check failed (see above)");
      await pingFail();
    }
  }
}

main().catch((e: Error) => {
  console.error(`backup-cron: FAILED: ${e.message}`);
  process.exit(1);
});
