// A fake self-hosted WordPress site for the tests: the REST index with Application Passwords, users/me, pages,
// posts, categories and media, behind Basic auth, plus a public image host. Every request is recorded. Any other
// address fails the test, so nothing reaches a real site.
import type { SafeFetch } from "../src/lib/siteFetch.ts";

export const SITE = "https://ana.example";
export const API = `${SITE}/wp-json/`;
export const LOGIN = "ana";
export const PASSWORD = "abcd EFGH 1234 ijkl MNOP 5678";
export const IMAGE = "https://img.example/roof.jpg";

export type Call = { method: string; url: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown };
type Post = { id: number; type: "page" | "post"; title: string; content: string; excerpt: string; slug: string; status: string; parent?: number; categories?: number[] };

export function fakeWordpress(o: { appPasswords?: boolean; password?: string; wpUrl?: string } = {}) {
  const calls: Call[] = [];
  let password = o.password ?? PASSWORD;
  let nextId = 100;
  const items: Post[] = [
    { id: 7, type: "page", title: "Home", content: "<!-- wp:paragraph --><p>Fresh bread.</p><!-- /wp:paragraph -->", excerpt: "", slug: "home", status: "publish", parent: 0 },
    { id: 8, type: "post", title: "Spring menu", content: "<p>New loaves.</p>", excerpt: "", slug: "spring-menu", status: "draft", categories: [3] },
  ];
  /** Answer the next request to a path with this status (to test retries and errors). */
  const failNext: { path: RegExp; status: number; body?: unknown; headers?: Record<string, string> }[] = [];
  const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
  const link = (p: Post) => (p.status === "publish" ? `${SITE}/${p.slug}/` : `${SITE}/?${p.type === "page" ? "page_id" : "p"}=${p.id}`);
  const view = (p: Post) => ({ id: p.id, title: { raw: p.title, rendered: p.title }, content: { raw: p.content }, excerpt: { raw: p.excerpt }, slug: p.slug, status: p.status, link: link(p), modified: "2026-11-18T10:00:00", ...(p.type === "page" ? { parent: p.parent ?? 0 } : { categories: p.categories ?? [] }) });

  const fetch: SafeFetch = async (raw, init) => {
    const url = new URL(raw);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = init.body;
    if (typeof init.body === "string" && headers["content-type"] === "application/json") body = JSON.parse(init.body);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url: url.toString(), path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body });
    if (url.toString() === IMAGE) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    if (url.origin === "https://img.example") return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.origin !== SITE) throw new Error(`Test tried to reach ${url.origin}`);
    const f = failNext.findIndex((x) => x.path.test(url.pathname));
    if (f >= 0) {
      const [x] = failNext.splice(f, 1);
      return json(x.body ?? { code: "fake", message: `fake ${x.status}` }, x.status, x.headers);
    }
    const p = url.pathname;
    if (p === "/wp-json/" && !headers.authorization) {
      return json({
        name: "Ana's Bakery",
        url: o.wpUrl ?? SITE,
        home: SITE,
        namespaces: ["oembed/1.0", "wp/v2", "yoast/v1"],
        ...(o.appPasswords === false ? { authentication: [] } : { authentication: { "application-passwords": { endpoints: { authorization: `${SITE}/wp-admin/authorize-application.php` } } } }),
      });
    }
    // Everything else needs the login.
    const want = `Basic ${Buffer.from(`${LOGIN}:${password}`).toString("base64")}`;
    if (headers.authorization !== want) return json({ code: "incorrect_password", message: "The provided password is an invalid application password." }, 401);
    if (p === "/wp-json/") return json({ name: "Ana's Bakery", description: "Bread", url: SITE, home: SITE, timezone_string: "Asia/Ho_Chi_Minh", namespaces: ["wp/v2", "yoast/v1"] });
    if (p === "/wp-json/wp/v2/users/me") return json({ id: 1, name: "Ana", slug: "ana" });
    if (p === "/wp-json/wp/v2/categories") return json([{ id: 3, name: "News", slug: "news", parent: 0, count: 1 }]);
    if (p === "/wp-json/wp/v2/media" && method === "POST") return json({ id: 55, source_url: `${SITE}/wp-content/uploads/roof.jpg`, alt_text: "" }, 201);
    const media = p.match(/^\/wp-json\/wp\/v2\/media\/(\d+)$/);
    if (media && method === "POST") return json({ id: Number(media[1]), source_url: `${SITE}/wp-content/uploads/roof.jpg`, ...(body as object) });
    const m = p.match(/^\/wp-json\/wp\/v2\/(pages|posts)(?:\/(\d+))?$/);
    if (m) {
      const type = m[1] === "pages" ? "page" : "post";
      if (!m[2] && method === "GET") return json(items.filter((x) => x.type === type).map(view));
      if (!m[2] && method === "POST") {
        const b = body as Record<string, unknown>;
        const made: Post = { id: ++nextId, type, title: String(b.title ?? ""), content: String(b.content ?? ""), excerpt: String(b.excerpt ?? ""), slug: String(b.slug ?? `draft-${nextId}`), status: String(b.status ?? "draft") };
        items.push(made);
        return json(view(made), 201);
      }
      const it = items.find((x) => x.type === type && x.id === Number(m[2]));
      if (!it) return json({ code: "rest_post_invalid_id", message: "Invalid post ID." }, 404);
      if (method === "GET") return json(view(it));
      const b = body as Record<string, unknown>;
      for (const k of ["title", "content", "excerpt", "slug", "status"] as const) if (typeof b[k] === "string") it[k] = b[k] as string;
      return json(view(it));
    }
    return json({ code: "rest_no_route", message: "No route was found matching the URL and request method." }, 404);
  };

  return {
    fetch,
    calls,
    items,
    failNext,
    /** The owner revoked the password in WordPress. */
    revoke: () => {
      password = "revoked";
    },
    /** The requests that change something on the site. */
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}
