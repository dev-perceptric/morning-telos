// Loads schema.sql into a throwaway Postgres database and checks who can see and change what.
// Uses TEST_DATABASE_URL only (default: local mt/mt), never DATABASE_URL. Skips when no database answers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL || "postgres://mt:mt@localhost:5432/mt";
const dbName = `mt_rls_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let admin: pg.Client | null = null;
let db: pg.Client | null = null;

async function connect(url: string) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  await c.connect();
  return c;
}

before(async () => {
  try {
    admin = await connect(BASE);
  } catch {
    admin = null;
    return;
  }
  await admin.query(`create database ${dbName}`);
  const url = new URL(BASE);
  url.pathname = `/${dbName}`;
  db = await connect(url.toString());
  await db.query(readFileSync(new URL("./sql/supabase-shim.sql", import.meta.url), "utf8"));
  await db.query(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  // Then every numbered change, in order, the way they run on Supabase.
  const dir = new URL("../supabase/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await db.query(readFileSync(new URL(f, dir), "utf8"));
});

after(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  }
});

type User = { id: string; email: string };

async function signUp(email: string, meta: Record<string, string> = {}): Promise<User> {
  const id = randomUUID();
  await db!.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, meta]);
  return { id, email };
}

// Runs fn as this user, the way PostgREST does: role authenticated plus the JWT claims. Rolls back after.
async function as<T>(u: User | null, fn: (q: (sql: string, args?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  await db!.query("begin");
  try {
    await db!.query(`set local role ${u ? "authenticated" : "anon"}`);
    await db!.query("select set_config('request.jwt.claims', $1, true)", [u ? JSON.stringify({ sub: u.id, email: u.email, role: "authenticated" }) : ""]);
    return await fn((sql, args) => db!.query(sql, args));
  } finally {
    await db!.query("rollback");
  }
}

// Same, but keeps the changes.
async function asCommit<T>(u: User, fn: (q: (sql: string, args?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  await db!.query("begin");
  try {
    await db!.query("set local role authenticated");
    await db!.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: "authenticated" })]);
    const r = await fn((sql, args) => db!.query(sql, args));
    await db!.query("commit");
    return r;
  } catch (e) {
    await db!.query("rollback");
    throw e;
  }
}

const wsOf = async (u: User) => (await db!.query("select workspace_id from workspace_members where user_id = $1 and role = 'owner'", [u.id])).rows[0]?.workspace_id as string;

test("sign-up with a business name makes a workspace with the person as owner", async (t) => {
  if (!db) return t.skip("no test database");
  const ana = await signUp("ana@example.com", { business: "Ana's Bakery", website: "anasbakery.com", timezone: "Asia/Ho_Chi_Minh" });
  const ws = await wsOf(ana);
  assert.ok(ws);
  const row = (await db.query("select name, website, timezone, plan from workspaces where id = $1", [ws])).rows[0];
  assert.deepEqual(row, { name: "Ana's Bakery", website: "anasbakery.com", timezone: "Asia/Ho_Chi_Minh", plan: "trial" });
});

test("sign-up from an invite (no business name) makes no workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const bo = await signUp("bo@example.com");
  const n = (await db.query("select count(*)::int n from workspace_members where user_id = $1", [bo.id])).rows[0].n;
  assert.equal(n, 0);
});

test("one customer can't see another's workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const a = await signUp("a1@example.com", { business: "A Co" });
  const b = await signUp("b1@example.com", { business: "B Co" });
  const bws = await wsOf(b);
  await as(a, async (q) => {
    const seen = (await q("select id, name from workspaces")).rows;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].name, "A Co");
    assert.equal((await q("select * from workspace_members where workspace_id = $1", [bws])).rowCount, 0);
    const upd = await q("update workspaces set name = 'hacked' where id = $1", [bws]);
    assert.equal(upd.rowCount, 0);
  });
});

test("signed-out visitors see nothing", async (t) => {
  if (!db) return t.skip("no test database");
  await signUp("c1@example.com", { business: "C Co" });
  await as(null, async (q) => {
    assert.equal((await q("select * from workspaces")).rowCount, 0);
    assert.equal((await q("select * from workspace_members")).rowCount, 0);
  });
});

test("members can't change their plan or billing", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("o1@example.com", { business: "O Co" });
  const ws = await wsOf(o);
  await as(o, async (q) => {
    await assert.rejects(q("update workspaces set plan = 'pro' where id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("update workspaces set trial_ends_at = now() + interval '1 year' where id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    const r = await q("update workspaces set name = 'O Company', website = 'o.com' where id = $1", [ws]);
    assert.equal(r.rowCount, 1);
  });
});

test("members can't add themselves to a workspace directly", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("o2@example.com", { business: "O2 Co" });
  const x = await signUp("x2@example.com");
  const ws = await wsOf(o);
  await as(x, async (q) => {
    await assert.rejects(q("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [ws, x.id]), /permission denied/);
  });
});

test("invites: admins invite, the right email accepts, roles are enforced", async (t) => {
  if (!db) return t.skip("no test database");
  const owner = await signUp("own@example.com", { business: "Invite Co" });
  const ws = await wsOf(owner);
  const viewerUser = await signUp("view@example.com");
  const stranger = await signUp("stranger@example.com");

  // Owner invites a viewer.
  const token = await asCommit(owner, async (q) =>
    (await q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'view@example.com', 'viewer', $2) returning token", [ws, owner.id])).rows[0].token as string);

  // Someone with another email can't use it.
  await as(stranger, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [token]), /This invite is for view@example.com/);
  });

  // The right person joins as a viewer.
  const joined = await asCommit(viewerUser, async (q) => (await q("select accept_invite($1) id", [token])).rows[0].id as string);
  assert.equal(joined, ws);
  const role = (await db.query("select role from workspace_members where workspace_id = $1 and user_id = $2", [ws, viewerUser.id])).rows[0]?.role;
  assert.equal(role, "viewer");

  // The link only works once. Opening it again just goes back to the workspace.
  await as(viewerUser, async (q) => {
    assert.equal((await q("select accept_invite($1) id", [token])).rows[0].id, ws);
  });
  await as(stranger, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [token]), /already used/);
  });

  // A viewer can see the workspace but can't invite, rename it, or delete it.
  await as(viewerUser, async (q) => {
    await assert.rejects(q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'z@example.com', 'admin', $2)", [ws, viewerUser.id]), /row-level security/);
  });
  await as(viewerUser, async (q) => {
    assert.equal((await q("select * from workspaces where id = $1", [ws])).rowCount, 1);
    assert.equal((await q("update workspaces set name = 'Mine now' where id = $1", [ws])).rowCount, 0);
    assert.equal((await q("delete from workspaces where id = $1", [ws])).rowCount, 0);
  });

  // Nobody can be promoted to owner, and the owner can't be removed.
  await as(owner, async (q) => {
    await assert.rejects(q("update workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2", [ws, viewerUser.id]), /row-level security/);
  });
  await as(owner, async (q) => {
    assert.equal((await q("delete from workspace_members where workspace_id = $1 and user_id = $2", [ws, owner.id])).rowCount, 0);
  });

  // The viewer can leave.
  await as(viewerUser, async (q) => {
    assert.equal((await q("delete from workspace_members where workspace_id = $1 and user_id = $2", [ws, viewerUser.id])).rowCount, 1);
  });
});

test("an expired invite can't be used", async (t) => {
  if (!db) return t.skip("no test database");
  const owner = await signUp("own2@example.com", { business: "Late Co" });
  const late = await signUp("late@example.com");
  const ws = await wsOf(owner);
  const token = (await db.query("insert into workspace_invites (workspace_id, email, role, expires_at) values ($1, 'late@example.com', 'editor', now() - interval '1 minute') returning token", [ws])).rows[0].token;
  await as(late, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [token]), /expired/);
  });
});

test("only the owner can delete the workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const owner = await signUp("own3@example.com", { business: "Bye Co" });
  const ws = await wsOf(owner);
  await as(owner, async (q) => {
    assert.equal((await q("delete from workspaces where id = $1", [ws])).rowCount, 1);
  });
});

test("a second workspace never gets a fresh trial", async (t) => {
  if (!db) return t.skip("no test database");
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, created_at) values ($1, 'old@example.com', now() - interval '20 days')", [id]);
  const ws = await asCommit({ id, email: "old@example.com" }, async (q) => (await q("select create_workspace('Second Co') id")).rows[0].id as string);
  const ends = (await db.query("select trial_ends_at < now() expired from workspaces where id = $1", [ws])).rows[0].expired;
  assert.equal(ends, true);
});

// ─────────────── P1.5: settings, members, invites, delete ───────────────

/** A workspace with an owner, an admin, an editor and a viewer. */
async function team(tag: string) {
  const owner = await signUp(`own-${tag}@example.com`, { business: `${tag} Co` });
  const ws = await wsOf(owner);
  const people: Record<"admin" | "editor" | "viewer", User> = {
    admin: await signUp(`adm-${tag}@example.com`),
    editor: await signUp(`ed-${tag}@example.com`),
    viewer: await signUp(`vw-${tag}@example.com`),
  };
  for (const [role, u] of Object.entries(people)) {
    await db!.query("insert into workspace_members (workspace_id, user_id, email, role) values ($1, $2, $3, $4)", [ws, u.id, u.email, role]);
  }
  return { ws, owner, ...people };
}

test("settings: admins and the owner change name, website and time zone; editors and viewers can't", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("set");
  for (const u of [owner, admin]) {
    await as(u, async (q) => {
      const r = await q("update workspaces set name = 'New', website = 'new.com', timezone = 'Europe/London' where id = $1", [ws]);
      assert.equal(r.rowCount, 1);
    });
  }
  for (const u of [editor, viewer]) {
    await as(u, async (q) => {
      assert.equal((await q("update workspaces set name = 'Mine' where id = $1", [ws])).rowCount, 0);
    });
  }
  await as(owner, async (q) => {
    await assert.rejects(q("update workspaces set timezone = $2 where id = $1", [ws, "x".repeat(65)]), /workspaces_timezone_check/);
  });
});

test("invites: only admins and the owner can see, make or cancel them", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("inv");
  const id = (await db.query("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'new-inv@example.com', 'editor', $2) returning id", [ws, owner.id])).rows[0].id;
  for (const u of [editor, viewer]) {
    await as(u, async (q) => {
      assert.equal((await q("select * from workspace_invites where workspace_id = $1", [ws])).rowCount, 0);
      assert.equal((await q("delete from workspace_invites where id = $1", [id])).rowCount, 0);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'x@example.com', 'viewer', $2)", [ws, u.id]), /row-level security/);
    });
  }
  await as(admin, async (q) => {
    assert.equal((await q("select token from workspace_invites where workspace_id = $1", [ws])).rowCount, 1);
    assert.equal((await q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'y@example.com', 'admin', $2)", [ws, admin.id])).rowCount, 1);
    assert.equal((await q("delete from workspace_invites where id = $1", [id])).rowCount, 1);
  });
  // Nobody can invite someone as owner, and an invite must name who sent it.
  await as(owner, async (q) => {
    await assert.rejects(q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'z@example.com', 'owner', $2)", [ws, owner.id]), /check/);
  });
  await as(admin, async (q) => {
    await assert.rejects(q("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, 'z@example.com', 'viewer', $2)", [ws, owner.id]), /row-level security/);
  });
});

test("roles: admins change and remove others; editors and viewers can't; the owner stays", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("role");
  const setRole = "update workspace_members set role = $3 where workspace_id = $1 and user_id = $2";
  const remove = "delete from workspace_members where workspace_id = $1 and user_id = $2";
  for (const u of [owner, admin]) {
    await as(u, async (q) => {
      assert.equal((await q(setRole, [ws, editor.id, "viewer"])).rowCount, 1);
      assert.equal((await q(remove, [ws, viewer.id])).rowCount, 1);
    });
  }
  // Admins can't touch the owner.
  await as(admin, async (q) => {
    assert.equal((await q(setRole, [ws, owner.id, "viewer"])).rowCount, 0);
    assert.equal((await q(remove, [ws, owner.id])).rowCount, 0);
  });
  // Editors and viewers can't change anyone, themselves included.
  for (const u of [editor, viewer]) {
    await as(u, async (q) => {
      assert.equal((await q(setRole, [ws, viewer.id, "editor"])).rowCount, 0);
      assert.equal((await q(setRole, [ws, u.id, "admin"])).rowCount, 0);
      assert.equal((await q(remove, [ws, admin.id])).rowCount, 0);
    });
  }
  // A role change can't also rewrite who the member is.
  await as(admin, async (q) => {
    await assert.rejects(q("update workspace_members set email = 'me@evil.com' where workspace_id = $1 and user_id = $2", [ws, editor.id]), /permission denied/);
  });
  await as(admin, async (q) => {
    await assert.rejects(q("update workspace_members set user_id = $3 where workspace_id = $1 and user_id = $2", [ws, editor.id, admin.id]), /permission denied/);
  });
  // Everyone but the owner can leave.
  for (const u of [admin, editor, viewer]) {
    await as(u, async (q) => {
      assert.equal((await q(remove, [ws, u.id])).rowCount, 1);
    });
  }
  await as(owner, async (q) => {
    assert.equal((await q(remove, [ws, owner.id])).rowCount, 0);
  });
});

test("accept_invite says what is wrong: cancelled, expired, used or another email", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner } = await team("acc");
  const pat = await signUp("pat-acc@example.com");
  const other = await signUp("other-acc@example.com");
  await as(pat, async (q) => {
    await assert.rejects(q("select accept_invite('no-such-token-here')"), /does not work.*cancelled/);
  });
  const mk = async (late = false) =>
    (
      await db!.query(
        `insert into workspace_invites (workspace_id, email, role, invited_by, expires_at) values ($1, 'Pat-Acc@example.com', 'editor', $2, ${late ? "now() - interval '1 second'" : "now() + interval '7 days'"}) returning token`,
        [ws, owner.id],
      )
    ).rows[0].token as string;
  const late = await mk(true);
  await as(pat, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [late]), /has expired/);
  });
  const good = await mk();
  await as(other, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [good]), /This invite is for Pat-Acc@example.com/);
  });
  // The email check ignores case.
  assert.equal(await asCommit(pat, async (q) => (await q("select accept_invite($1) id", [good])).rows[0].id), ws);
  const role = (await db.query("select role from workspace_members where workspace_id = $1 and user_id = $2", [ws, pat.id])).rows[0].role;
  assert.equal(role, "editor");
  // A cancelled invite stops working.
  const cancelled = await mk();
  await db.query("delete from workspace_invites where token = $1", [cancelled]);
  await as(other, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [cancelled]), /does not work/);
  });
  // Signed-out visitors can't call it at all.
  await as(null, async (q) => {
    await assert.rejects(q("select accept_invite($1)", [good]), /permission denied/);
  });
});

test("deleting a workspace removes its members and invites, and only the owner can", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("del");
  await db.query("insert into workspace_invites (workspace_id, email, role) values ($1, 'gone@example.com', 'viewer')", [ws]);
  for (const u of [admin, editor, viewer]) {
    await as(u, async (q) => {
      assert.equal((await q("delete from workspaces where id = $1", [ws])).rowCount, 0);
    });
  }
  await asCommit(owner, async (q) => {
    assert.equal((await q("delete from workspaces where id = $1", [ws])).rowCount, 1);
  });
  assert.equal((await db.query("select count(*)::int n from workspace_members where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from workspace_invites where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from workspaces where id = $1", [ws])).rows[0].n, 0);
});
