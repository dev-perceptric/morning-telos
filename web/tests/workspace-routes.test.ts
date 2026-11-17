// The invite and delete-workspace routes with the database and Resend replaced by fakes. Nothing reaches a real server.
import assert from "node:assert/strict";
import test from "node:test";
import { ROLE_RANK, type Role } from "../src/lib/workspace.ts";
import type { Mail } from "../src/lib/workspaceMail.ts";
import { createInvite, deleteWorkspace, type Gate, type Invite } from "../src/lib/workspaceRoutes.ts";

/** A gate that behaves like requireRole for someone with this role (or no role at all). */
function gateAs(role: Role | null, asked: Role[] = []): Gate {
  return async (min) => {
    asked.push(min);
    if (!role) return { ok: false, status: 403, error: `You need ${min} access in this workspace to do that.` };
    if (ROLE_RANK[role] < ROLE_RANK[min]) return { ok: false, status: 403, error: `You need ${min} access in this workspace to do that.` };
    return { ok: true, userId: "me", email: "me@example.com" };
  };
}

function inviteDeps(role: Role | null, opts: { members?: string[]; send?: (to: string, m: Mail) => Promise<boolean> } = {}) {
  const asked: Role[] = [];
  const saved: { email: string; role: Role; invited_by: string }[] = [];
  const sent: { to: string; mail: Mail }[] = [];
  const d = {
    gate: gateAs(role, asked),
    origin: "https://app.example",
    workspaceName: async () => "Ana's Bakery",
    memberEmails: async () => opts.members ?? ["me@example.com"],
    saveInvite: async (row: { email: string; role: Role; invited_by: string }): Promise<Invite> => {
      saved.push(row);
      return { id: "inv1", email: row.email, role: row.role, token: "tok123456789", expires_at: "2026-11-24T00:00:00Z" };
    },
    send:
      opts.send ??
      (async (to: string, mail: Mail) => {
        sent.push({ to, mail });
        return true;
      }),
  };
  return { d, asked, saved, sent };
}

for (const role of ["viewer", "editor", null] as const) {
  test(`a ${role ?? "non-member"} can't invite, and nothing is saved or sent`, async () => {
    const { d, asked, saved, sent } = inviteDeps(role);
    const r = await createInvite({ email: "new@example.com", role: "editor" }, d);
    assert.equal(r.status, 403);
    assert.deepEqual(asked, ["admin"]);
    assert.equal(saved.length, 0);
    assert.equal(sent.length, 0);
  });
}

for (const role of ["admin", "owner"] as const) {
  test(`an ${role} invites by email: saves the invite, emails the link and returns it`, async () => {
    const { d, saved, sent } = inviteDeps(role);
    const r = await createInvite({ email: " New@Example.com ", role: "editor" }, d);
    assert.equal(r.status, 200);
    assert.deepEqual(saved, [{ email: "new@example.com", role: "editor", invited_by: "me" }]);
    assert.equal(r.body.link, "https://app.example/invite/tok123456789");
    assert.equal(r.body.emailed, true);
    assert.equal(sent[0].to, "new@example.com");
    assert.match(sent[0].mail.text, /https:\/\/app\.example\/invite\/tok123456789/);
    assert.match(sent[0].mail.subject, /Ana's Bakery/);
  });
}

test("invite: without Resend the link still comes back, marked not emailed", async () => {
  const { d } = inviteDeps("admin", { send: async () => false });
  const r = await createInvite({ email: "new@example.com", role: "viewer" }, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.emailed, false);
  assert.equal(r.body.link, "https://app.example/invite/tok123456789");
  assert.equal(r.body.emailError, undefined);
});

test("invite: when Resend fails the link still comes back with a clear note", async () => {
  const { d } = inviteDeps("admin", {
    send: async () => {
      throw new Error("Resend returned 500");
    },
  });
  const r = await createInvite({ email: "new@example.com", role: "viewer" }, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.emailed, false);
  assert.match(String(r.body.emailError), /Copy the link/);
});

test("invite: rejects bad emails, owner role, unknown roles, yourself and current members", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ email: "nope", role: "editor" }, /real email/],
    [{ email: "new@example.com", role: "owner" }, /admin, editor or viewer/],
    [{ email: "new@example.com", role: "god" }, /admin, editor or viewer/],
    [{ email: "new@example.com" }, /admin, editor or viewer/],
    [{ email: "ME@example.com", role: "editor" }, /already in this workspace/],
    [{ email: "pat@example.com", role: "editor" }, /already in this workspace/],
  ];
  for (const [input, err] of cases) {
    const { d, saved } = inviteDeps("owner", { members: ["me@example.com", "Pat@Example.com"] });
    const r = await createInvite(input, d);
    assert.equal(r.status, 400, JSON.stringify(input));
    assert.match(String(r.body.error), err);
    assert.equal(saved.length, 0);
  }
});

function deleteDeps(role: Role | null, opts: { name?: string | null; send?: (to: string, m: Mail) => Promise<boolean> } = {}) {
  const asked: Role[] = [];
  let removed = 0;
  const sent: { to: string; mail: Mail }[] = [];
  const d = {
    gate: gateAs(role, asked),
    workspaceName: async () => (opts.name === undefined ? "Ana's Bakery" : opts.name),
    remove: async () => {
      removed++;
    },
    send:
      opts.send ??
      (async (to: string, mail: Mail) => {
        sent.push({ to, mail });
        return true;
      }),
  };
  return { d, asked, sent, removed: () => removed };
}

for (const role of ["viewer", "editor", "admin", null] as const) {
  test(`a ${role ?? "non-member"} can't delete the workspace, even with the right name typed`, async () => {
    const { d, asked, sent, removed } = deleteDeps(role);
    const r = await deleteWorkspace({ confirm: "Ana's Bakery" }, d);
    assert.equal(r.status, 403);
    assert.deepEqual(asked, ["owner"]);
    assert.equal(removed(), 0);
    assert.equal(sent.length, 0);
  });
}

test("the owner deletes after typing the name, and gets a goodbye email", async () => {
  const { d, sent, removed } = deleteDeps("owner");
  const r = await deleteWorkspace({ confirm: "ana's bakery" }, d);
  assert.deepEqual(r, { status: 200, body: { ok: true, emailed: true } });
  assert.equal(removed(), 1);
  assert.equal(sent[0].to, "me@example.com");
  assert.match(sent[0].mail.subject, /Ana's Bakery was deleted/);
});

test("delete: the wrong name does nothing", async () => {
  const { d, removed, sent } = deleteDeps("owner");
  const r = await deleteWorkspace({ confirm: "Ana" }, d);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /Type Ana's Bakery to confirm/);
  assert.equal(removed(), 0);
  assert.equal(sent.length, 0);
});

test("delete: a missing workspace is a 404", async () => {
  const { d, removed } = deleteDeps("owner", { name: null });
  assert.equal((await deleteWorkspace({ confirm: "x" }, d)).status, 404);
  assert.equal(removed(), 0);
});

test("delete: a failed goodbye email still counts as deleted", async () => {
  const { d, removed } = deleteDeps("owner", {
    send: async () => {
      throw new Error("Resend returned 500");
    },
  });
  const r = await deleteWorkspace({ confirm: "Ana's Bakery" }, d);
  assert.deepEqual(r, { status: 200, body: { ok: true, emailed: false } });
  assert.equal(removed(), 1);
});
