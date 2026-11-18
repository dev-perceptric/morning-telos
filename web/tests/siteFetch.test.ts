// Reading web pages safely (src/lib/siteFetch.ts). Nothing here reaches the internet: DNS answers are fakes, and the
// only server is one this test starts on 127.0.0.1, which the real rules block.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { allowedUrl, checkedLookup, fetchPage, PAGE_MAX_BYTES, privateIp, safeAgent, safeFetch, type Dns, type PageFetch } from "../src/lib/siteFetch.ts";

test("privateIp blocks this machine, private networks, link-local, metadata and reserved ranges", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255",
    "169.254.169.254", "169.254.0.1", "0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1",
    "not-an-ip", "",
  ];
  for (const ip of blocked) assert.equal(privateIp(ip), true, `${ip} should be blocked`);
  const open = ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "192.167.1.1", "169.253.1.1", "100.63.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "fec0::1"];
  for (const ip of open) assert.equal(privateIp(ip), false, `${ip} should be allowed`);
});

test("allowedUrl takes http(s) on normal ports, never logins, local names or blocked IPs", () => {
  assert.equal(allowedUrl("https://ana.example/about#team")?.toString(), "https://ana.example/about");
  assert.ok(allowedUrl("http://ana.example:80/"));
  assert.ok(allowedUrl("https://ana.example:443/"));
  for (const bad of ["ftp://ana.example/", "file:///etc/passwd", "https://user:pw@ana.example/", "https://ana.example:8080/", "http://localhost/", "http://app.localhost/", "http://printer.local/", "http://metadata.google.internal/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "nonsense"]) {
    assert.equal(allowedUrl(bad), null, bad);
  }
});

const fakeDns = (answers: Record<string, string[]>): Dns => (host, cb) => {
  const list = answers[host];
  if (!list) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
  cb(null, list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
};

function lookupOnce(lookup: ReturnType<typeof checkedLookup>, host: string, all = true) {
  return new Promise<{ err: (Error & { code?: string }) | null; address: unknown }>((resolve) => lookup(host, { all }, (err, address) => resolve({ err, address })));
}

test("checkedLookup refuses a name when any address it resolves to is private (DNS rebinding)", async () => {
  const lookup = checkedLookup(
    fakeDns({
      "ana.example": ["93.184.216.34"],
      "rebind.example": ["127.0.0.1"],
      "mixed.example": ["93.184.216.34", "10.0.0.5"],
      "metadata.example": ["169.254.169.254"],
      "v6.example": ["::ffff:127.0.0.1"],
    }),
  );
  const ok = await lookupOnce(lookup, "ana.example");
  assert.equal(ok.err, null);
  assert.deepEqual(ok.address, [{ address: "93.184.216.34", family: 4 }]);
  const single = await lookupOnce(lookup, "ana.example", false);
  assert.equal(single.address, "93.184.216.34");
  for (const host of ["rebind.example", "mixed.example", "metadata.example", "v6.example", "127.0.0.1", "[::1]"]) {
    const r = await lookupOnce(lookup, host);
    assert.equal(r.err?.code, "EPRIVATE", host);
  }
  assert.equal((await lookupOnce(lookup, "missing.example")).err?.code, "ENOTFOUND");
});

// ─────────────── a real HTTP server on 127.0.0.1, reached through the real undici agent ───────────────

let server: Server;
let port = 0;
let hits: string[] = [];
before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    const url = req.url ?? "/";
    if (url === "/") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>Home</title><p>Hello from the test site.</p>");
    if (url === "/moved") return res.writeHead(301, { location: "/" }).end();
    if (url === "/to-metadata") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
    if (url === "/to-file") return res.writeHead(302, { location: "file:///etc/passwd" }).end();
    if (url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
    if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "a".repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 2 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    if (url === "/slow") return setTimeout(() => res.writeHead(200, { "content-type": "text/html" }).end("late"), 2_000);
    if (url === "/image") return res.writeHead(200, { "content-type": "image/png" }).end("PNG");
    if (url === "/gone") return res.writeHead(404, { "content-type": "text/html" }).end("Not here");
    if (url === "/busy") return res.writeHead(503, { "content-type": "text/html" }).end("Busy");
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((r) => server.close(() => r())));

// The ports allowed in production are 80 and 443, so these tests reach the local server through a fetch that keeps
// the real undici agent and lookup but sends the request to the test port.
function toTestPort(agent: ReturnType<typeof safeAgent>): PageFetch {
  const real = safeFetch(agent);
  return (url, init) => {
    const u = new URL(url);
    u.port = String(port);
    return real(u.toString(), init);
  };
}

test("a name that resolves to 127.0.0.1 is refused at connect time, and the server never sees the request", async () => {
  hits = [];
  const get = toTestPort(safeAgent(fakeDns({ "rebind.example": ["127.0.0.1"] })));
  const page = await fetchPage("http://rebind.example/", { fetch: get });
  assert.equal(page.ok, false);
  assert.equal(!page.ok && page.error, "That address points to a private network.");
  assert.equal(!page.ok && page.retryable, false);
  assert.deepEqual(hits, []);
});

test("through the same agent, with the block lifted for the test server only: redirects, caps and errors", async () => {
  hits = [];
  const only = (ip: string) => ip !== "127.0.0.1" && privateIp(ip);
  const get = toTestPort(safeAgent(fakeDns({ "site.example": ["127.0.0.1"] }), only));

  const home = await fetchPage("http://site.example/moved", { fetch: get });
  assert.ok(home.ok);
  assert.equal(home.ok && home.url, "http://site.example/");
  assert.match(home.ok ? home.html : "", /Hello from the test site/);

  // A redirect to the metadata address or a file is checked like the first address, and never followed.
  for (const path of ["/to-metadata", "/to-file"]) {
    const p = await fetchPage(`http://site.example${path}`, { fetch: get });
    assert.equal(p.ok, false, path);
    assert.equal(!p.ok && p.error, "That address can't be read.");
  }
  assert.ok(!hits.some((h) => h.includes("meta-data")));

  const loop = await fetchPage("http://site.example/loop", { fetch: get });
  assert.equal(!loop.ok && loop.error, "The website redirected too many times.");

  // A 2 MB page is cut at 300 KB.
  const big = await fetchPage("http://site.example/big", { fetch: get });
  assert.ok(big.ok);
  assert.equal(big.ok && big.html.length, PAGE_MAX_BYTES);
  assert.equal(big.ok && big.cut, true);

  const slow = await fetchPage("http://site.example/slow", { fetch: get, timeoutMs: 200 });
  assert.equal(!slow.ok && slow.error, "The website took too long to answer.");
  assert.equal(!slow.ok && slow.retryable, true);

  const image = await fetchPage("http://site.example/image", { fetch: get });
  assert.equal(!image.ok && image.error, "That page isn't a web page.");
  const gone = await fetchPage("http://site.example/gone", { fetch: get });
  assert.deepEqual(gone.ok ? null : [gone.status, gone.retryable], [404, false]);
  const busy = await fetchPage("http://site.example/busy", { fetch: get });
  assert.deepEqual(busy.ok ? null : [busy.status, busy.retryable], [503, true]);
});

test("fetchPage never throws and refuses blocked addresses before fetching", async () => {
  let called = 0;
  const never: PageFetch = async () => {
    called++;
    throw new Error("should not be called");
  };
  for (const url of ["http://127.0.0.1/", "http://[::1]/", "http://10.0.0.1/", "http://169.254.169.254/", "gopher://ana.example/"]) {
    const p = await fetchPage(url, { fetch: never });
    assert.equal(p.ok, false, url);
  }
  assert.equal(called, 0);
  const dropped = await fetchPage("https://ana.example/", { fetch: async () => Promise.reject(Object.assign(new Error("reset"), { code: "ECONNRESET" })) });
  assert.deepEqual(dropped.ok ? null : [dropped.error, dropped.retryable], ["The website couldn't be reached.", true]);
  const missing = await fetchPage("https://ana.example/", { fetch: async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })) });
  assert.deepEqual(missing.ok ? null : [missing.error, missing.retryable], ["That website's address doesn't exist.", false]);
});
