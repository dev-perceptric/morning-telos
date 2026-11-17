// Runs pg_dump, psql and pg_restore for the backup scripts. Children get only PATH, HOME, the locale and the
// libpq settings passed in, so nothing else from this process's environment reaches them.
import { spawn } from "node:child_process";

export type RunResult = { code: number; stdout: Buffer; stderr: string };

export function run(cmd: string, args: string[], pg: Record<string, string> = {}): Promise<RunResult> {
  const env: Record<string, string> = { PGCONNECT_TIMEOUT: "30", ...pg };
  for (const k of ["PATH", "HOME", "LANG", "LC_ALL", "TZ"]) if (process.env[k]) env[k] = process.env[k]!;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: env as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new Error(`${cmd} is not installed`) : e));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
  });
}

/** Runs a command and fails with the start of its error output when it exits non-zero. */
export async function mustRun(cmd: string, args: string[], pg: Record<string, string> = {}): Promise<Buffer> {
  const r = await run(cmd, args, pg);
  if (r.code !== 0) throw new Error(`${cmd} failed (exit ${r.code}): ${r.stderr.trim().slice(0, 400)}`);
  return r.stdout;
}

export const log = (tag: string, msg: string) => console.error(`${new Date().toISOString()} ${tag}: ${msg}`);
