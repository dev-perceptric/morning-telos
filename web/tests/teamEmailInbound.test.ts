// The email door end to end with fakes (src/lib/teamEmailInbound.ts): Resend's webhook with real Svix-style HMAC
// signatures built here, and the worker's team_email job with a fake database, a fake turn and a fake Resend.
// Nothing reaches Resend, Supabase or Anthropic.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import type { ChatEvent } from "../src/lib/agentLoop.ts";
import type { ReceivedEmail } from "../src/lib/email.ts";
import type { Email } from "../src/lib/emailKit.ts";
import { EMAILS_PER_HOUR, type DropReason, type SenderRow } from "../src/lib/teamEmail.ts";
import { handleInbound, processTeamEmail, type InboundDeps, type JobDeps } from "../src/lib/teamEmailInbound.ts";

const D = "team.morningtelos.com";
const RAW = randomBytes(32).toString("base64");
const SECRET = `whsec_${RAW}`;
const NOW = 1_800_000_000;
const WS = "11111111-2222-4333-8444-555555555555";

// ─────────────── the webhook ───────────────

function signed(payload: unknown, o: { id?: string; ts?: number; secret?: string; svix?: boolean; sig?: string } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = o.id ?? "msg_2abc";
  const ts = o.ts ?? NOW;
  const sig = o.sig ?? `v1,${createHmac("sha256", Buffer.from(o.secret ?? RAW, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const p = o.svix === false ? "webhook" : "svix";
  return { headers: new Headers({ [`${p}-id`]: id, [`${p}-timestamp`]: String(ts), [`${p}-signature`]: sig }), body };
}

const received = (data: Record<string, unknown> = {}) => ({
  type: "email.received",
  created_at: "2026-11-20T12:00:00.000Z",
  data: { email_id: "56761188-7520-42d8-8898-ff6fc54ce618", from: "Ana Lopez <ana@bakery.com>", to: ["acme@team.morningtelos.com"], cc: [], bcc: [], received_for: [], message_id: "<in1@mail.gmail.com>", subject: "Hi", attachments: [], ...data },
});

function inbound(o: { domain?: string | null; sender?: SenderRow | null; enabled?: boolean } = {}) {
  const drops: DropReason[] = [];
  const queued: [string, string][] = [];
  const seen = new Set<string>();
  const d: InboundDeps = {
    domain: o.domain === undefined ? D : o.domain,
    secret: SECRET,
    now: NOW,
    findAddress: async (slug) => (slug === "acme" ? { workspace_id: WS, enabled: o.enabled ?? true } : null),
    sender: async (ws, email) => (ws === WS && email === "ana@bakery.com" ? (o.sender === undefined ? { kind: "member", user_id: "u-ana", role: "owner" } : o.sender) : null),
    queue: async (id, ws) => {
      if (seen.has(id)) return false;
      seen.add(id);
      queued.push([id, ws]);
      return true;
    },
    drop: async (r) => {
      drops.push(r);
    },
  };
  return { d, drops, queued };
}

test("webhook: 404 and nothing done while TEAM_EMAIL_DOMAIN is empty", async () => {
  const { d, queued } = inbound({ domain: null });
  const r = await handleInbound(signed(received()), d);
  assert.equal(r.status, 404);
  assert.deepEqual(queued, []);
});

test("webhook signature: Svix headers (Resend) and webhook-* headers pass; wrong secret, old, changed or missing fail", async () => {
  const { d, queued } = inbound();
  assert.equal((await handleInbound(signed(received()), d)).status, 200);
  assert.equal((await handleInbound(signed(received({ email_id: "e-2" }), { svix: false }), d)).status, 200);
  assert.equal(queued.length, 2);
  for (const bad of [
    signed(received(), { secret: randomBytes(32).toString("base64") }),
    signed(received(), { ts: NOW - 301 }),
    signed(received(), { sig: "v1,AAAA" }),
    { ...signed(received()), body: JSON.stringify(received({ from: "evil@x.com" })) },
    { headers: new Headers(), body: JSON.stringify(received()) },
  ]) {
    const r = await handleInbound(bad, d);
    assert.equal(r.status, 401);
  }
  assert.equal(queued.length, 2);
});

test("webhook: queues one job per email, once, even when Resend sends it twice", async () => {
  const { d, queued, drops } = inbound();
  const a = await handleInbound(signed(received()), d);
  const b = await handleInbound(signed(received(), { id: "msg_retry" }), d);
  assert.deepEqual(a.body, { ok: true, queued: true });
  assert.deepEqual(b.body, { ok: true, queued: false });
  assert.deepEqual(queued, [["56761188-7520-42d8-8898-ff6fc54ce618", WS]]);
  assert.deepEqual(drops, []);
});

test("webhook: other events are ignored, and a bad body is refused", async () => {
  const { d, queued } = inbound();
  assert.deepEqual((await handleInbound(signed({ type: "email.sent", data: {} }), d)).body, { ok: true, ignored: true });
  assert.equal((await handleInbound(signed("not json"), d)).status, 400);
  assert.equal((await handleInbound(signed(received({ email_id: "../../x" })), d)).status, 400);
  assert.deepEqual(queued, []);
});

test("webhook drops, with no reply and only a count: unknown address, turned off, stranger, viewer, our own address", async () => {
  const cases: [Parameters<typeof inbound>[0], Record<string, unknown>, DropReason][] = [
    [{}, { to: ["nobody@team.morningtelos.com"] }, "unknown_address"],
    [{}, { to: ["acme@othersite.com"] }, "unknown_address"],
    [{ enabled: false }, {}, "off"],
    [{}, { from: "Stranger <x@spam.com>" }, "unknown_sender"],
    [{ sender: null }, {}, "unknown_sender"],
    [{ sender: { kind: "member", user_id: "u-v", role: "viewer" } }, {}, "viewer"],
    [{}, { from: "acme@team.morningtelos.com" }, "loop"],
    [{}, { from: "not an address" }, "unknown_sender"],
  ];
  for (const [o, data, reason] of cases) {
    const { d, drops, queued } = inbound(o);
    const r = await handleInbound(signed(received(data)), d);
    assert.equal(r.status, 200, reason);
    assert.deepEqual(r.body, { ok: true, dropped: true });
    assert.deepEqual(drops, [reason]);
    assert.deepEqual(queued, []);
  }
  // Forwarded to us: the address can be in received_for instead of To. An extra sender is accepted.
  const { d, queued } = inbound({ sender: { kind: "extra", user_id: null, role: null } });
  await handleInbound(signed(received({ to: ["ana@bakery.com"], received_for: ["acme@team.morningtelos.com"] })), d);
  assert.equal(queued.length, 1);
});

// ─────────────── the job ───────────────

type Sent = { to: string; mail: Email; o: { from: string; replyTo: string; headers: Record<string, string>; idempotencyKey: string } };

function email(o: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    id: "e1",
    from: "Ana Lopez <ana@bakery.com>",
    to: ["acme@team.morningtelos.com"],
    cc: [],
    received_for: [],
    subject: "Posts for next week",
    text: "Can you plan three posts?\n\nSent from my iPhone\n\nOn Mon Bo wrote:\n> old",
    html: null,
    headers: {},
    message_id: "<in1@mail.gmail.com>",
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    attachments: [{ id: "a1", filename: "menu.pdf", content_type: "application/pdf" }],
    ...o,
  };
}

function world(o: { sender?: SenderRow | null; events?: ChatEvent[]; sendFails?: number; inbound?: number } = {}) {
  const db = {
    threads: [] as { id: string; workspace_id: string; title: string; created_by: string | null; subject: string; token: string }[],
    messages: [] as { ws: string; thread: string; id: string; dir: "in" | "out" }[],
    saved: [] as { ws: string; thread: string; content: string; meta: Record<string, unknown> }[],
    links: [] as { ws: string; approval: number; user: string }[],
  };
  const drops: DropReason[] = [];
  const sent: Sent[] = [];
  const turns: { ws: string; thread: string; text: string }[] = [];
  const emails = new Map<string, ReceivedEmail>();
  let ids = 0;
  let fails = o.sendFails ?? 0;
  const d: JobDeps = {
    domain: D,
    appUrl: "https://chat.test",
    now: () => NOW * 1000,
    getEmail: async (id) => {
      const e = emails.get(id);
      if (!e) throw new Error("Resend returned 503");
      return e;
    },
    address: async (ws) => (ws === WS ? { slug: "acme", enabled: true } : null),
    sender: async (ws, from) => (ws === WS && from === "ana@bakery.com" ? (o.sender === undefined ? { kind: "member", user_id: "u-ana", role: "owner" } : o.sender) : null),
    inboundSince: async () => o.inbound ?? db.messages.filter((m) => m.dir === "in").length,
    drop: async (r) => {
      drops.push(r);
    },
    threadByToken: async (ws, token) => {
      const t = db.threads.find((x) => x.workspace_id === ws && x.token === token);
      return t ? { thread_id: t.id, token: t.token } : null;
    },
    threadsByMessageIds: async (ws, list) => Object.fromEntries(db.messages.filter((m) => m.ws === ws && list.includes(m.id)).map((m) => [m.id, m.thread])),
    tokenOf: async (ws, id) => db.threads.find((x) => x.workspace_id === ws && x.id === id)?.token ?? null,
    startThread: async (ws, t) => {
      db.threads.push({ id: t.id, workspace_id: ws, title: t.title, created_by: t.createdBy, subject: t.subject, token: t.token });
    },
    recordMessage: async (ws, thread, id, dir) => {
      if (db.messages.some((m) => m.ws === ws && m.id === id)) return false;
      db.messages.push({ ws, thread, id, dir });
      return true;
    },
    references: async (ws, thread) => db.messages.filter((m) => m.ws === ws && m.thread === thread).map((m) => m.id),
    saveMessage: async (ws, thread, content, meta) => {
      db.saved.push({ ws, thread, content, meta });
    },
    // The fake keeps PDFs and images by name and leaves out the rest, like pickAttachments and saveFile.
    saveAttachments: async (ws, id) => {
      const e = emails.get(id)!;
      const keep = e.attachments.filter((a) => /\.(pdf|png|jpe?g)$/i.test(a.filename));
      return {
        files: keep.map((a) => ({ path: `${ws}/00000000-0000-4000-8000-000000000001/${a.filename}`, name: a.filename, kind: a.filename.endsWith(".pdf") ? "pdf" : "image", type: a.content_type as "application/pdf", size: 100 })),
        skipped: e.attachments.filter((a) => !keep.includes(a)).map((a) => a.filename),
      };
    },
    runTurn: async (ws, thread, text, emit) => {
      turns.push({ ws, thread, text });
      for (const e of o.events ?? [{ type: "route", agent: "social", how: "router", reason: "" }, { type: "message", agent: "social", text: "Here are **3 posts**." }, { type: "done" }]) emit(e);
    },
    approveLink: async (ws, approval, user) => {
      db.links.push({ ws, approval, user });
      return `https://chat.test/api/email/approve?a=${approval}&t=tok${approval}`;
    },
    send: async (to, mail, opts) => {
      if (fails-- > 0) throw new Error("Resend returned 500");
      sent.push({ to, mail, o: opts });
    },
    newId: () => `id-${++ids}`,
    log: () => {},
  };
  const job = (id: string) => ({ workspace_id: WS, payload: { email_id: id } });
  return { d, db, drops, sent, turns, emails, job };
}

test("a new email starts a chat titled from the subject, saves the trimmed words as the person's message, and the answer goes back by email", async () => {
  const w = world();
  w.emails.set("e1", email());
  assert.deepEqual(await processTeamEmail(w.job("e1"), w.d), { status: "done" });
  assert.equal(w.db.threads.length, 1);
  const t = w.db.threads[0];
  assert.equal(t.title, "Posts for next week");
  assert.equal(t.created_by, "u-ana");
  assert.match(t.token, /^[a-z0-9]{16}$/);
  assert.deepEqual(w.db.saved, [
    {
      ws: WS,
      thread: t.id,
      content: "Can you plan three posts?",
      meta: {
        user: "ana@bakery.com",
        email: { from: "ana@bakery.com", to: "acme@team.morningtelos.com", subject: "Posts for next week", attachments: [] },
        files: [{ path: `${WS}/00000000-0000-4000-8000-000000000001/menu.pdf`, name: "menu.pdf", kind: "pdf", type: "application/pdf", size: 100 }],
      },
    },
  ]);
  assert.equal(w.turns.length, 1);
  assert.equal(w.turns[0].text, "Posts for next week\nCan you plan three posts?");

  assert.equal(w.sent.length, 1);
  const s = w.sent[0];
  assert.equal(s.to, "ana@bakery.com");
  assert.equal(s.o.from, "Leo at Morning Telos <acme@team.morningtelos.com>");
  assert.equal(s.o.replyTo, `acme+t${t.token}@team.morningtelos.com`);
  assert.equal(s.o.headers["In-Reply-To"], "<in1@mail.gmail.com>");
  assert.equal(s.o.headers.References, "<in1@mail.gmail.com>");
  assert.equal(s.o.headers["Message-ID"], "<id-2@team.morningtelos.com>");
  assert.equal(s.o.idempotencyKey, "team-email-e1");
  assert.equal(s.mail.subject, "Re: Posts for next week");
  assert.match(s.mail.html, /<strong[^>]*>3 posts<\/strong>/);
  assert.match(s.mail.html, new RegExp(`href="https://chat.test/chat/${t.id}"[^>]*>Open in Morning Telos`));
  assert.deepEqual(w.db.messages.map((m) => [m.id, m.dir]), [["<in1@mail.gmail.com>", "in"], ["<id-2@team.morningtelos.com>", "out"]]);
});

test("a reply continues the same chat: by the token in the reply-to address, or by In-Reply-To and References", async () => {
  const w = world();
  w.emails.set("e1", email());
  await processTeamEmail(w.job("e1"), w.d);
  const t = w.db.threads[0];

  // Reply sent to the reply-to address with the token, no threading headers (some clients drop them).
  w.emails.set("e2", email({ to: [`acme+t${t.token}@team.morningtelos.com`], subject: "Re: Posts for next week", text: "Make them shorter.", message_id: "<in2@mail.gmail.com>" }));
  await processTeamEmail(w.job("e2"), w.d);
  // Reply to the plain address but with In-Reply-To pointing at our answer.
  w.emails.set("e3", email({ subject: "Re: Posts", text: "Thanks!", message_id: "<in3@mail.gmail.com>", headers: { "In-Reply-To": w.sent[1].o.headers["Message-ID"], References: "<in1@mail.gmail.com>" } }));
  await processTeamEmail(w.job("e3"), w.d);

  assert.equal(w.db.threads.length, 1, "no new chats");
  assert.deepEqual(w.db.saved.map((m) => [m.thread, m.content]), [[t.id, "Can you plan three posts?"], [t.id, "Make them shorter."], [t.id, "Thanks!"]]);
  const last = w.sent[2].o.headers;
  assert.equal(last["In-Reply-To"], "<in3@mail.gmail.com>");
  assert.deepEqual(last.References.split(" "), ["<in1@mail.gmail.com>", "<id-2@team.morningtelos.com>", "<in2@mail.gmail.com>", w.sent[1].o.headers["Message-ID"], "<in3@mail.gmail.com>"]);
  assert.equal(w.sent[2].o.replyTo, `acme+t${t.token}@team.morningtelos.com`);
});

test("another workspace's token or Message-ID starts a new chat instead", async () => {
  const w = world();
  w.db.threads.push({ id: "T-other", workspace_id: "other-ws", title: "x", created_by: null, subject: "", token: "zzzzzzzzzzzzzzzz" });
  w.db.messages.push({ ws: "other-ws", thread: "T-other", id: "<theirs@x>", dir: "out" });
  w.emails.set("e1", email({ to: ["acme+tzzzzzzzzzzzzzzzz@team.morningtelos.com"], headers: { "In-Reply-To": "<theirs@x>" } }));
  await processTeamEmail(w.job("e1"), w.d);
  assert.equal(w.db.threads.length, 2);
  assert.notEqual(w.db.saved[0].thread, "T-other");
});

test("the same email twice is answered once", async () => {
  const w = world();
  w.emails.set("e1", email());
  w.emails.set("e1b", email({ id: "e1b" }));
  await processTeamEmail(w.job("e1"), w.d);
  assert.deepEqual(await processTeamEmail(w.job("e1b"), w.d), { status: "done" });
  assert.equal(w.db.saved.length, 1);
  assert.equal(w.sent.length, 1);
  assert.equal(w.db.threads.length, 1);
});

test("dropped with no reply: faked From (no DKIM or DMARC pass), automatic mail, a viewer, a stranger, too many, empty", async () => {
  const cases: [Parameters<typeof world>[0], Partial<ReceivedEmail>, DropReason][] = [
    [{}, { authentication: { spf: "pass", dkim: "gray", dmarc: "gray" } }, "unverified"],
    [{}, { authentication: null }, "unverified"],
    [{}, { headers: { "Auto-Submitted": "auto-replied" } }, "loop"],
    [{ sender: { kind: "member", user_id: "u-v", role: "viewer" } }, {}, "viewer"],
    [{ sender: null }, {}, "unknown_sender"],
    [{ inbound: EMAILS_PER_HOUR }, {}, "too_many"],
    [{}, { subject: "", text: "On Mon Bo wrote:\n> only a quote", attachments: [] }, "empty"],
  ];
  for (const [o, e, reason] of cases) {
    const w = world(o);
    w.emails.set("e1", email(e));
    assert.deepEqual(await processTeamEmail(w.job("e1"), w.d), { status: "done" }, reason);
    assert.deepEqual(w.drops, [reason]);
    assert.equal(w.db.saved.length, 0, reason);
    assert.equal(w.turns.length, 0, reason);
    assert.equal(w.sent.length, 0, reason);
  }
});

test("a hiccup reading the email is thrown, so the worker tries again", async () => {
  const w = world();
  await assert.rejects(processTeamEmail(w.job("missing"), w.d), /503/);
  assert.equal(w.db.saved.length, 0);
  assert.deepEqual(await processTeamEmail({ workspace_id: null, payload: {} }, w.d), { status: "failed", error: "A team_email job needs a workspace and an email id." });
});

test("approvals: each one in the email with an Approve link for the member who emailed, bound to them", async () => {
  const events: ChatEvent[] = [
    { type: "approval", agent: "social", id: 41, title: "Schedule 3 posts" },
    { type: "approval", agent: "social", id: 41, title: "Schedule 3 posts" },
    { type: "approval", agent: "social", id: 42, title: "Post a story" },
    { type: "message", agent: "social", text: "I prepared 2 changes for your OK." },
  ];
  const w = world({ events });
  w.emails.set("e1", email());
  await processTeamEmail(w.job("e1"), w.d);
  assert.deepEqual(w.db.links, [
    { ws: WS, approval: 41, user: "u-ana" },
    { ws: WS, approval: 42, user: "u-ana" },
  ]);
  const html = w.sent[0].mail.html;
  assert.match(html, /These 2 need your OK/);
  assert.match(html, /href="https:\/\/chat.test\/api\/email\/approve\?a=41&amp;t=tok41"/);
  assert.match(html, /href="https:\/\/chat.test\/approvals\/42"/);

  // An extra sender (not a member) gets Open links only.
  const x = world({ events, sender: { kind: "extra", user_id: null, role: null } });
  x.emails.set("e1", email());
  await processTeamEmail(x.job("e1"), x.d);
  assert.deepEqual(x.db.links, []);
  assert.doesNotMatch(x.sent[0].mail.html, />Approve<\/a>/);
  assert.equal(x.db.threads[0].created_by, null);
});

test("the answer is sent by the teammate who wrote the last reply; one failed send is tried again, two fail the job", async () => {
  const events: ChatEvent[] = [
    { type: "message", agent: "chief", text: "Midas can take this." },
    { type: "handoff", from: "chief", to: "sales", note: "Quote" },
    { type: "message", agent: "sales", text: "Here is the quote." },
  ];
  const w = world({ events, sendFails: 1 });
  w.emails.set("e1", email());
  assert.deepEqual(await processTeamEmail(w.job("e1"), w.d), { status: "done" });
  assert.equal(w.sent[0].o.from, "Midas at Morning Telos <acme@team.morningtelos.com>");
  assert.match(w.sent[0].mail.text, /Here is the quote\./);

  const f = world({ sendFails: 2 });
  f.emails.set("e1", email());
  const r = await processTeamEmail(f.job("e1"), f.d);
  assert.equal(r.status, "failed");
  assert.equal(f.db.saved.length, 1, "the chat still has the email");
});

test("a forward keeps the forwarded email, and a tag in the subject picks the teammate", async () => {
  const w = world();
  w.emails.set("e1", email({ subject: "Fwd: @Irene customer question", text: "Can you answer?\n\n---------- Forwarded message ---------\nFrom: Bo <bo@c.com>\n\nWhere is my order?" }));
  await processTeamEmail(w.job("e1"), w.d);
  assert.match(w.db.saved[0].content, /Where is my order\?/);
  assert.match(w.turns[0].text, /^@Irene customer question\n/);
  assert.equal(w.db.threads[0].title, "@Irene customer question");
});

test("attachments: images and PDFs become chat files on the message; other files are named only; files alone are enough", async () => {
  const w = world();
  w.emails.set("e1", email({ subject: "", text: "", attachments: [{ id: "a1", filename: "photo.jpg", content_type: "image/jpeg" }, { id: "a2", filename: "notes.docx", content_type: "application/msword" }] }));
  await processTeamEmail(w.job("e1"), w.d);
  assert.equal(w.db.saved.length, 1);
  const m = w.db.saved[0];
  assert.equal(m.content, "");
  assert.deepEqual((m.meta.files as { name: string }[]).map((f) => f.name), ["photo.jpg"]);
  assert.deepEqual((m.meta.email as { attachments: string[] }).attachments, ["notes.docx"]);
  assert.equal(w.turns[0].text, "Files: photo.jpg");
  assert.equal(w.db.threads[0].title, "Email to your team");

  // A failure keeping the files still answers the words, and names the files.
  const f = world();
  f.d.saveAttachments = async () => {
    throw new Error("storage is down");
  };
  f.emails.set("e1", email());
  await processTeamEmail(f.job("e1"), f.d);
  assert.deepEqual((f.db.saved[0].meta.email as { attachments: string[] }).attachments, ["menu.pdf"]);
  assert.equal(f.db.saved[0].meta.files, undefined);
  assert.equal(f.sent.length, 1);
});

test("Resend's receiving API: the email and its attachments are read with the key, from the documented paths", async () => {
  const { getReceivedEmail, listReceivedAttachments } = await import("../src/lib/email.ts");
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    if (String(url).endsWith("/attachments?limit=100")) return Response.json({ object: "list", has_more: false, data: [{ id: "a1", filename: "menu.pdf", size: 4096, content_type: "application/pdf", content_disposition: null, download_url: "https://inbound-cdn.resend.com/x", expires_at: "2026-11-20T13:00:00Z" }] });
    if (String(url).includes("/missing")) return new Response('{"message":"not found"}', { status: 404 });
    return Response.json({ object: "email", id: "e1", to: ["acme@team.morningtelos.com"], from: "ana@bakery.com", subject: "Hi", html: "<p>Hi</p>", text: null, headers: { "in-reply-to": "<x@y>" }, authentication: { spf: "pass", dkim: "pass", dmarc: "pass" }, message_id: "<m@gmail>", attachments: [{ id: "a1", filename: "menu.pdf", content_type: "application/pdf", size: 4096 }] });
  }) as typeof globalThis.fetch;
  const e = await getReceivedEmail("e1", { key: "re_test", fetch });
  assert.equal(calls[0].url, "https://api.resend.com/emails/receiving/e1");
  assert.equal(calls[0].auth, "Bearer re_test");
  assert.deepEqual([e.from, e.text, e.html, e.message_id, e.cc, e.received_for], ["ana@bakery.com", null, "<p>Hi</p>", "<m@gmail>", [], []]);
  assert.deepEqual(e.authentication, { spf: "pass", dkim: "pass", dmarc: "pass" });
  assert.deepEqual(e.attachments, [{ id: "a1", filename: "menu.pdf", content_type: "application/pdf", size: 4096 }]);
  const list = await listReceivedAttachments("e1", { key: "re_test", fetch });
  assert.equal(calls[1].url, "https://api.resend.com/emails/receiving/e1/attachments?limit=100");
  assert.deepEqual(list, [{ id: "a1", filename: "menu.pdf", content_type: "application/pdf", content_disposition: null, size: 4096, download_url: "https://inbound-cdn.resend.com/x" }]);
  await assert.rejects(getReceivedEmail("missing", { key: "re_test", fetch }), /Resend returned 404/);
  await assert.rejects(getReceivedEmail("../etc", { key: "re_test", fetch }), /not a Resend email id/);
  await assert.rejects(getReceivedEmail("e1", { key: "", fetch }), /RESEND_API_KEY/);
});
