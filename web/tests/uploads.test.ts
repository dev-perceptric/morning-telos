// The message box's uploads (src/lib/uploads.ts) with a fake fetch. Nothing leaves the test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachFile, saveToKnowledge, savedLine } from "../src/lib/uploads.ts";

const WS = "11111111-2222-4333-8444-555555555555";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { f, calls };
}

test("saveToKnowledge: posts the file to the Knowledge upload route for everyone, and says so in one line", async () => {
  const { f, calls } = fakeFetch(200, { doc: { title: "Price list" }, cut: false, note: null });
  const file = new File(["Bread $4"], "price-list.txt", { type: "text/plain" });
  const line = await saveToKnowledge("tok", WS, file, f);
  assert.equal(line, 'Saved "Price list" to Knowledge. Your team will use it from now on.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/knowledge/upload");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer tok" });
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("workspaceId"), WS);
  assert.equal(form.get("agent"), "", "for the whole team");
  assert.equal((form.get("file") as File).name, "price-list.txt");
});

test("saveToKnowledge: a cut file adds the route's note; an error is the route's own short line", async () => {
  const cut = fakeFetch(200, { doc: { title: "Big" }, note: "This file was long, so we kept the first 50,000 characters." });
  assert.equal(await saveToKnowledge(null, WS, new File(["x"], "big.txt"), cut.f), savedLine("Big", "This file was long, so we kept the first 50,000 characters."));
  assert.deepEqual(cut.calls[0].init.headers, {});
  const bad = fakeFetch(400, { error: "Upload a .txt, .md, .csv or .pdf file." });
  await assert.rejects(saveToKnowledge("t", WS, new File(["x"], "a.txt"), bad.f), /Upload a \.txt/);
  await assert.rejects(saveToKnowledge("t", WS, new File(["x"], "a.txt"), async () => Promise.reject(new Error("offline"))), /Couldn't reach the server/);
});

test("attachFile: posts to the chat files route and returns where the file is kept", async () => {
  const stored = { path: `${WS}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/a.png`, name: "a.png", kind: "image", type: "image/png", size: 3 };
  const { f, calls } = fakeFetch(200, { file: stored });
  assert.deepEqual(await attachFile("tok", WS, new File(["abc"], "a.png"), f), stored);
  assert.equal(calls[0].url, "/api/chat/files");
  assert.equal((calls[0].init.body as FormData).get("workspaceId"), WS);
  await assert.rejects(attachFile("t", WS, new File(["x"], "a.png"), fakeFetch(400, { error: "That image is too big. The limit is 5 MB." }).f), /limit is 5 MB/);
  await assert.rejects(attachFile("t", WS, new File(["x"], "a.png"), fakeFetch(200, {}).f), /couldn't upload/);
});
