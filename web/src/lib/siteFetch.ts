// Reading a customer's website from our server, safely. The server must never reach its own network or a cloud
// metadata service, whatever address the website or its redirects point to.
// Copied from Arrowsterr's safeFetch.ts and netCheck.ts: every connection, each redirect included, is checked on the
// IP address the name resolves to at connect time, so a DNS answer that changes (rebinding) can't slip past.
// The pieces take their DNS lookup and fetch as arguments, so tests never reach a real website.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/** Each page: at most 10 seconds and 300 KB. */
export const PAGE_TIMEOUT_MS = 10_000;
export const PAGE_MAX_BYTES = 300 * 1024;
const MAX_REDIRECTS = 5;
export const UA = "Mozilla/5.0 (compatible; MorningTelosBot/1.0; +https://morningtelos.com/)";

/**
 * True for addresses we never connect to: this machine (127/8, ::1), private networks (10/8, 172.16/12, 192.168/16,
 * fc00::/7), link-local and cloud metadata (169.254/16, fe80::/10), carrier NAT (100.64/10), benchmark (198.18/15),
 * "this network" (0/8, ::) and multicast or reserved (224/4 and up, ff00::/8). IPv4 inside IPv6 is checked as IPv4.
 * Anything that isn't an IP address counts as blocked.
 */
export function privateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(v) !== 6) return true;
  if (v === "::" || v === "::1") return true;
  // ::ffff:127.0.0.1 and ::ffff:7f00:1 (IPv4-mapped), and the old ::127.0.0.1 form.
  const dotted = v.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateIp(dotted[1]);
  const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return privateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // fc00::/7 (fc and fd), fe80::/10 (fe8 to feb), ff00::/8.
  return /^(fc|fd|fe[89ab]|ff)/.test(v);
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** A DNS lookup in node's shape, always asked for every address. */
export type Dns = (host: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemDns: Dns = (host, cb) => dnsLookup(host, { all: true }, (err, addresses) => cb(err, addresses ?? []));

/**
 * A connect-time lookup that refuses a name when ANY of its addresses is blocked, so a name that answers with a
 * public and a private address can't be raced to the private one. `blocked` is only changed by tests.
 */
export function checkedLookup(dns: Dns = systemDns, blocked: (ip: string) => boolean = privateIp) {
  return (host: string, options: { all?: boolean } | undefined, cb: LookupCb) => {
    const literal = host.replace(/^\[|\]$/g, "");
    const answer = (err: NodeJS.ErrnoException | null, list: LookupAddress[]) => {
      if (err) return cb(err, "", 4);
      const bad = list.find((a) => blocked(a.address));
      if (!list.length || bad) return cb(Object.assign(new Error("That address points to a private network."), { code: "EPRIVATE" }), "", 4);
      if (options?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    };
    if (isIP(literal)) return answer(null, [{ address: literal, family: isIP(literal) }]);
    dns(host, answer);
  };
}

/** An undici agent whose every connection goes through checkedLookup. */
export function safeAgent(dns?: Dns, blocked?: (ip: string) => boolean) {
  return new Agent({ connect: { timeout: PAGE_TIMEOUT_MS, lookup: checkedLookup(dns, blocked) as never } });
}

/** The part of fetch this file uses, so tests can hand in their own. Redirects are always followed by hand. */
export type PageFetch = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;

/** fetch through a safe agent. The default for fetchPage. */
export function safeFetch(agent: Agent = defaultAgent()): PageFetch {
  return (url, init) => undiciFetch(url, { ...init, dispatcher: agent }) as unknown as ReturnType<PageFetch>;
}
let agent: Agent | null = null;
const defaultAgent = () => (agent ??= safeAgent());

export type Page =
  | { ok: true; url: string; status: number; html: string; cut: boolean }
  /** retryable: a hiccup worth trying again later (timeout, 5xx, 429, connection dropped). */
  | { ok: false; url: string; status: number; error: string; retryable: boolean };

/** Only plain web addresses on the normal ports, and never an IP address we block. */
export function allowedUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host) && privateIp(host)) return null;
  u.hash = "";
  return u;
}

/** Read the body up to max bytes. Returns the text and whether it was cut short. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ text: string; cut: boolean }> {
  if (!body) return { text: "", cut: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const room = max - size;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      size = max;
      cut = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), cut };
}

function failure(url: string, e: unknown): Page {
  const err = e as { code?: string; cause?: { code?: string }; name?: string };
  const code = err?.cause?.code ?? err?.code;
  if (code === "EPRIVATE") return { ok: false, url, status: 0, error: "That address points to a private network.", retryable: false };
  if (code === "ENOTFOUND") return { ok: false, url, status: 0, error: "That website's address doesn't exist.", retryable: false };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return { ok: false, url, status: 0, error: "The website took too long to answer.", retryable: true };
  return { ok: false, url, status: 0, error: "The website couldn't be reached.", retryable: true };
}

/**
 * GET one web page: redirects followed by hand (each one checked again), 10 seconds, 300 KB. Only HTML or plain
 * text pages are read. Never throws.
 */
export async function fetchPage(url: string, o: { fetch?: PageFetch; timeoutMs?: number; maxBytes?: number } = {}): Promise<Page> {
  const get = o.fetch ?? safeFetch();
  const signal = AbortSignal.timeout(o.timeoutMs ?? PAGE_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = allowedUrl(current);
    if (!u) return { ok: false, url: current, status: 0, error: "That address can't be read.", retryable: false };
    current = u.toString();
    try {
      const res = await get(current, { redirect: "manual", signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }
      if (res.status >= 400) {
        await res.body?.cancel().catch(() => {});
        const retryable = res.status === 429 || res.status >= 500;
        return { ok: false, url: current, status: res.status, error: `The website answered with an error (${res.status}).`, retryable };
      }
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (type && !/html|xml|text\/plain/.test(type)) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, url: current, status: res.status, error: "That page isn't a web page.", retryable: false };
      }
      const { text, cut } = await readCapped(res.body, o.maxBytes ?? PAGE_MAX_BYTES);
      return { ok: true, url: current, status: res.status, html: text, cut };
    } catch (e) {
      return failure(current, e);
    }
  }
  return { ok: false, url: current, status: 0, error: "The website redirected too many times.", retryable: false };
}
