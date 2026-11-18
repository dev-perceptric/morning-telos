// POST /api/knowledge/upload, the agent loop's knowledgeForPrompt and searchKnowledge, the Claude wrapper and the
// scan_website handler, with fake databases and a fake Claude. Nothing reaches Supabase, Anthropic or a website.
// Run with: node --conditions=react-server --test tests/server/*.test.ts (part of npm test).

import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { fakeDb } from "./fakeDb.ts";
import { auth } from "./stubs/serverAuth.ts";

register("./tsResolve.mjs", import.meta.url);

const upload = await import("../../src/app/api/knowledge/upload/route.ts");
const { knowledgeForPrompt, searchKnowledge } = await import("../../src/lib/knowledgeServer.ts");
const { askWith, knowledgeJobHandlers, retryableClaudeError } = await import("../../src/lib/siteScanDb.ts");

globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`test tried to reach ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";

type Row = Record<string, unknown>;
/** Enough of supabase-js for the upload route: insert(...).select(...).single(), with a chosen error. */
function docsDb() {
  const rows: Row[] = [];
  let failWith: string | null = null;
  return {
    rows,
    fail: (m: string | null) => void (failWith = m),
    from(table: string) {
      assert.equal(table, "knowledge_docs");
      let row: Row = {};
      const q = {
        insert: (r: Row) => ((row = r), q),
        select: () => q,
        single: async () => {
          if (failWith) return { data: null, error: { message: failWith } };
          const saved = { id: `doc-${rows.length + 1}`, source_url: null, updated_at: "2026-11-18T00:00:00Z", ...row };
          rows.push(saved);
          return { data: saved, error: null };
        },
      };
      return q;
    },
  };
}

let db: ReturnType<typeof docsDb>;
beforeEach(() => {
  db = docsDb();
  auth.db = db;
  auth.roles = new Map([
    [`editor-1:${WS}`, "editor"],
    [`viewer-1:${WS}`, "viewer"],
  ]);
});

function post(user: string | null, fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return upload.POST(new Request("http://app.test/api/knowledge/upload", { method: "POST", headers: user ? { Authorization: `Bearer ${user}` } : {}, body: form }));
}
const file = (name: string, text: string | Uint8Array, type = "text/plain") => new File([text], name, { type });

test("upload: editors add a text file as a doc, saved as themselves with source file", async () => {
  const res = await post("editor-1", { workspaceId: WS, file: file("Our_prices.txt", "﻿Loaf $8\r\nRye $9\n"), agent: "social" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cut, false);
  assert.equal(body.note, null);
  assert.equal(body.doc.title, "Our prices");
  assert.deepEqual(db.rows.map(({ workspace_id, title, body, agent, source }) => ({ workspace_id, title, body, agent, source })), [
    { workspace_id: WS, title: "Our prices", body: "Loaf $8\nRye $9", agent: "social", source: "file" },
  ]);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("upload: viewers, strangers and signed-out people can't upload", async () => {
  for (const [user, ws, status] of [["viewer-1", WS, 403], ["editor-1", OTHER, 403], [null, WS, 401]] as const) {
    const res = await post(user, { workspaceId: ws, file: file("a.txt", "Hello there") });
    assert.equal(res.status, status, `${user} ${ws}`);
  }
  assert.deepEqual(db.rows, []);
});

test("upload: wrong types, empty, too big, binary and unknown agents are turned away with plain messages", async () => {
  const cases: [Record<string, string | File>, number, RegExp][] = [
    [{ workspaceId: WS }, 400, /Choose a file/],
    [{ workspaceId: WS, file: file("photo.jpg", "jpg", "image/jpeg") }, 400, /Upload a \.txt, \.md, \.csv or \.pdf file/],
    [{ workspaceId: WS, file: file("empty.md", "") }, 400, /empty/],
    [{ workspaceId: WS, file: file("big.csv", "a,b\n".repeat(1_400_000)) }, 413, /up to 5 MB/],
    [{ workspaceId: WS, file: file("bin.txt", new Uint8Array([80, 75, 0, 1])) }, 400, /isn't plain text/],
    [{ workspaceId: WS, file: file("fake.pdf", "hello", "application/pdf") }, 400, /isn't a PDF/],
    [{ workspaceId: WS, file: file("a.txt", "Hello there"), agent: "zeus" }, 400, /Pick who uses this doc/],
  ];
  for (const [fields, status, error] of cases) {
    const res = await post("editor-1", fields);
    assert.equal(res.status, status, JSON.stringify(Object.keys(fields)));
    assert.match((await res.json()).error, error);
  }
  assert.deepEqual(db.rows, []);
});

test("upload: a long file is cut and the answer says so; the 200-doc limit and other errors read plainly", async () => {
  const res = await post("editor-1", { workspaceId: WS, file: file("long.md", "All about our services and our prices.\n".repeat(3000)) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cut, true);
  assert.match(body.note, /kept the first 50,000 characters/);
  assert.ok((db.rows[0].body as string).length <= 50_000);

  db.fail("You can have up to 200 docs. Delete some to add more.");
  const full = await post("editor-1", { workspaceId: WS, file: file("a.txt", "Hello there") });
  assert.equal(full.status, 400);
  assert.equal((await full.json()).error, "You can have up to 200 docs. Delete some to add more.");
  db.fail('new row violates row-level security policy for table "knowledge_docs"');
  const rls = await post("editor-1", { workspaceId: WS, file: file("a.txt", "Hello there") });
  assert.equal((await rls.json()).error, "You need editor access in this workspace to do that.");
  db.fail("connection reset by peer at 10.0.0.3");
  const other = await post("editor-1", { workspaceId: WS, file: file("a.txt", "Hello there") });
  assert.equal(other.status, 500);
  assert.equal((await other.json()).error, "We couldn't save the file. Try again.");
});

// ─────────────── what the agent loop calls ───────────────

/** Enough of supabase-js for knowledgeForPrompt and searchKnowledge, recording the filters each call used. */
function readDb(rows: Row[]) {
  const calls: { table?: string; eq?: [string, unknown][]; or?: string; rpc?: [string, Record<string, unknown>] }[] = [];
  return {
    calls,
    from(table: string) {
      const call: (typeof calls)[number] = { table, eq: [] };
      calls.push(call);
      let list = rows.slice();
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (call.eq!.push([c, v]), (list = list.filter((r) => r[c] === v)), q),
        or: (f: string) => {
          call.or = f;
          const key = f.match(/agent\.eq\.(\w+)/)?.[1];
          list = list.filter((r) => r.agent === null || r.agent === key);
          return q;
        },
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(ok),
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ rpc: [name, args] });
      return { data: [{ id: "d1", title: "Prices", snippet: "Loaf $8", rank: "1.5" }], error: null };
    },
  };
}

test("knowledgeForPrompt reads only this workspace's docs for everyone and this agent, within the budget", async () => {
  const rows: Row[] = [
    { workspace_id: WS, title: "About Ana's", body: "We bake bread.", agent: null, source: "website", updated_at: "2026-11-01T00:00:00Z" },
    { workspace_id: WS, title: "Post ideas", body: "Show the ovens.", agent: "social", updated_at: "2026-11-02T00:00:00Z", source: "manual" },
    { workspace_id: WS, title: "SEO notes", body: "Keywords.", agent: "seo", updated_at: "2026-11-03T00:00:00Z", source: "manual" },
    { workspace_id: OTHER, title: "Their secret", body: "Not yours.", agent: null, updated_at: "2026-11-04T00:00:00Z", source: "manual" },
  ];
  const fake = readDb(rows);
  const text = await knowledgeForPrompt(WS, "social", 5000, fake as never);
  assert.equal(text, '<doc title="About Ana\'s" source="website">\nWe bake bread.\n</doc>\n<doc title="Post ideas" for="Aphrodite">\nShow the ovens.\n</doc>');
  assert.deepEqual(fake.calls[0].eq, [["workspace_id", WS]]);
  assert.equal(fake.calls[0].or, "agent.is.null,agent.eq.social");
  await assert.rejects(knowledgeForPrompt("not-a-uuid", "social", 5000, fake as never), /Missing workspace/);
  // An agent key can't change the filter.
  await knowledgeForPrompt(WS, "social),workspace_id.neq.x", 5000, fake as never);
  assert.equal(fake.calls.at(-1)!.or, "agent.is.null,agent.eq.socialworkspace_idneqx");
});

test("searchKnowledge calls search_knowledge for this workspace with a clean question and a capped limit", async () => {
  const fake = readDb([]);
  assert.deepEqual(await searchKnowledge(WS, "  loaf   price ", 99, fake as never), [{ id: "d1", title: "Prices", snippet: "Loaf $8", rank: 1.5 }]);
  assert.deepEqual(fake.calls[0].rpc, ["search_knowledge", { ws: WS, q: "loaf price", n: 20 }]);
  assert.deepEqual(await searchKnowledge(WS, "   ", 5, fake as never), []);
  assert.equal(fake.calls.length, 1, "an empty question asks nothing");
  await assert.rejects(searchKnowledge("x", "loaf", 5, fake as never), /Missing workspace/);
});

// ─────────────── Claude and the job ───────────────

test("askWith sends Haiku a structured-output request and reads only the text blocks", async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        sent.push(body);
        return {
          model: body.model,
          stop_reason: "end_turn",
          usage: { input_tokens: 12, output_tokens: 3 },
          content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: '{"sell":' }, { type: "text", text: '""}' }],
        } as unknown as Anthropic.Message;
      },
    },
  };
  const ask = askWith(client);
  const out = await ask({ model: "claude-haiku-5-5", system: "Rules", user: "Pages", schema: { type: "object" }, maxTokens: 4000 });
  assert.deepEqual(out, { text: '{"sell":""}', stopReason: "end_turn", model: "claude-haiku-5-5", usage: { input_tokens: 12, output_tokens: 3 } });
  assert.deepEqual(sent[0], {
    model: "claude-haiku-5-5",
    max_tokens: 4000,
    system: "Rules",
    messages: [{ role: "user", content: "Pages" }],
    output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object" } } },
  });
});

test("Claude errors: rate limits, overload, server errors and the network retry; bad requests and keys don't", async () => {
  const h = new Headers();
  assert.equal(retryableClaudeError(new Anthropic.RateLimitError(429, {}, "slow down", h)), true);
  assert.equal(retryableClaudeError(Anthropic.APIError.generate(529, {}, "overloaded", h)), true);
  assert.equal(retryableClaudeError(Anthropic.APIError.generate(500, {}, "oops", h)), true);
  assert.equal(retryableClaudeError(new Anthropic.APIConnectionError({ message: "reset" })), true);
  assert.equal(retryableClaudeError(Anthropic.APIError.generate(400, {}, "bad", h)), false);
  assert.equal(retryableClaudeError(Anthropic.APIError.generate(401, {}, "key", h)), false);
  assert.equal(retryableClaudeError(new Error("other")), false);
  const ask = askWith({ messages: { create: async () => Promise.reject(new Anthropic.RateLimitError(429, {}, "slow down", h)) } });
  await assert.rejects(ask({ model: "m", system: "", user: "", schema: {}, maxTokens: 1 }), (e: Error & { retryable?: boolean }) => e.retryable === true && /429/.test(e.message));
});

test("scan_website handler: no website finishes, a private address fails without any request, no key means no Claude", async () => {
  const fake = fakeDb();
  fake.tables.workspaces = [
    { id: WS, name: "Ana's", website: null },
    { id: OTHER, name: "Inside", website: "10.0.0.7" },
  ];
  const run = knowledgeJobHandlers(fake as never, {}).scan_website;
  const job = (ws: string | null) => ({ id: 1, kind: "scan_website", workspace_id: ws, payload: {}, attempts: 1, max_attempts: 3 });
  assert.deepEqual(await run(job(WS)), { status: "done" });
  assert.deepEqual(await run(job(null)), { status: "done" });
  const r = await run(job(OTHER));
  assert.equal(r.status, "failed");
  assert.match(r.status === "failed" ? r.error : "", /can't be read/);
  assert.deepEqual(fake.writes, []);
});
