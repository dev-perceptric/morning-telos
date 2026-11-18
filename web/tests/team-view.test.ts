import assert from "node:assert/strict";
import test from "node:test";
import { AGENTS, ORDER } from "../src/lib/team.ts";
import { agentStatus, agentToolkits } from "../src/lib/teamView.ts";

test("the Team page lists every teammate once", () => {
  assert.equal(new Set(ORDER).size, ORDER.length);
  assert.deepEqual([...ORDER].sort(), Object.keys(AGENTS).sort());
});

test("agentStatus: paused, setting up, connect an app, working", () => {
  const none = { paused: false, services: {}, connected: [] as string[] };
  assert.deepEqual(agentStatus("chief", none), { tone: "ok", label: "Working" });
  assert.deepEqual(agentStatus("chief", { ...none, paused: true }), { tone: "idle", label: "Paused" });
  assert.deepEqual(agentStatus("seo", { ...none, services: { arrowsterr: "pending" } }), { tone: "wait", label: "Setting up" });
  assert.deepEqual(agentStatus("seo", { ...none, services: { arrowsterr: "ready" } }), { tone: "ok", label: "Working" });
  assert.deepEqual(agentStatus("social", none), { tone: "wait", label: "Setting up" });
  if (!AGENTS.email.soon) {
    assert.deepEqual(agentStatus("email", none), { tone: "wait", label: "Connect an app" });
    assert.deepEqual(agentStatus("email", { ...none, connected: ["gmail"] }), { tone: "ok", label: "Working" });
    assert.ok(agentToolkits("email").includes("gmail"));
  } else assert.deepEqual(agentStatus("email", none), { tone: "idle", label: "Coming soon" });
  assert.deepEqual(agentToolkits("chief"), []);
});
