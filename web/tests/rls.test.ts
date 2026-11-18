// Loads schema.sql and then every numbered migration (002_*.sql, ...) in order into a throwaway Postgres database,
// and checks who can see and change what.
// Uses TEST_DATABASE_URL only (default: local mt/mt), never DATABASE_URL. Skips when no database answers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";
import { effectivePlan } from "../src/lib/plans.ts";

// schema.sql first, then the numbered migrations in number order, the way they are run in Supabase.
const SQL_DIR = new URL("../supabase/", import.meta.url);
const MIGRATIONS = readdirSync(SQL_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));

const BASE = process.env.TEST_DATABASE_URL || "postgres://mt:mt@localhost:5432/mt";
const dbName = `mt_rls_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let admin: pg.Client | null = null;
let db: pg.Client | null = null;
/** The throwaway database's address, for tests that need a second connection. */
let dbUrl = "";

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
  dbUrl = url.toString();
  db = await connect(dbUrl);
  await db.query(readFileSync(new URL("./sql/supabase-shim.sql", import.meta.url), "utf8"));
  for (const f of ["schema.sql", ...MIGRATIONS]) await db.query(readFileSync(new URL(f, SQL_DIR), "utf8"));
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

test("every SQL file is loaded: schema.sql, then the numbered migrations in order", () => {
  const all = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
  assert.deepEqual([...all].sort(), ["schema.sql", ...MIGRATIONS].sort(), "a .sql file in supabase/ is neither schema.sql nor numbered");
  assert.ok(MIGRATIONS.includes("002_billing.sql"));
  const nums = MIGRATIONS.map((f) => parseInt(f, 10));
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
});

test("members can't read or write Stripe events", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("se1@example.com", { business: "Events Co" });
  await db.query("insert into stripe_events (id, type) values ('evt_rls_1', 'invoice.paid')");
  await as(o, async (q) => {
    await assert.rejects(q("select * from stripe_events"), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("insert into stripe_events (id, type) values ('evt_fake', 'invoice.paid')"), /permission denied/);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from stripe_events"), /permission denied/);
  });
  // Even with table rights back, RLS with no policies still shows nothing.
  await db.query("grant select on stripe_events to authenticated");
  await as(o, async (q) => {
    assert.equal((await q("select * from stripe_events")).rowCount, 0);
  });
  await db.query("revoke select on stripe_events from authenticated");
  // The server's secret key (service_role) sees every event, and a repeated id is refused.
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    assert.equal((await db.query("select * from stripe_events where id = 'evt_rls_1'")).rowCount, 1);
    await assert.rejects(db.query("insert into stripe_events (id, type) values ('evt_rls_1', 'invoice.paid')"), /duplicate key/);
  } finally {
    await db.query("rollback");
  }
});

// The billing states the issue names, for effective_plan() and effectivePlan().
const CASES: { name: string; plan: string; status: string; days: number; want: string }[] = [
  { name: "trial", plan: "trial", status: "trialing", days: 10, want: "trial" },
  { name: "trial ended", plan: "trial", status: "trialing", days: -1, want: "expired" },
  { name: "active Starter", plan: "starter", status: "active", days: -30, want: "starter" },
  { name: "active Pro during the trial", plan: "pro", status: "active", days: 5, want: "pro" },
  { name: "past due keeps the plan", plan: "pro", status: "past_due", days: -30, want: "pro" },
  { name: "canceled after the trial", plan: "pro", status: "canceled", days: -30, want: "expired" },
  { name: "canceled during the trial", plan: "starter", status: "canceled", days: 3, want: "trial" },
  { name: "unpaid", plan: "starter", status: "unpaid", days: -30, want: "expired" },
  { name: "first payment still going through", plan: "pro", status: "incomplete", days: -1, want: "expired" },
  { name: "internal, long after the trial", plan: "internal", status: "active", days: -90, want: "internal" },
  { name: "internal, even when canceled", plan: "internal", status: "canceled", days: -90, want: "internal" },
];

test("effective_plan() for trial, active, past due, canceled and trial ended, and it matches effectivePlan()", async (t) => {
  if (!db) return t.skip("no test database");
  for (const c of CASES) {
    const ws = (
      await db.query("insert into workspaces (name, plan, status, trial_ends_at) values ($1, $2, $3, now() + make_interval(days => $4)) returning id, trial_ends_at", [c.name, c.plan, c.status, c.days])
    ).rows[0];
    const sql = (await db.query("select effective_plan($1::uuid) p", [ws.id])).rows[0].p;
    assert.equal(sql, c.want, `SQL: ${c.name}`);
    const ts = effectivePlan({ plan: c.plan, status: c.status, trial_ends_at: (ws.trial_ends_at as Date).toISOString() }).plan;
    assert.equal(ts, c.want, `TypeScript: ${c.name}`);
  }
});

test("a new workspace starts on the trial", async (t) => {
  if (!db) return t.skip("no test database");
  const n = await signUp("new1@example.com", { business: "New Co" });
  const ws = await wsOf(n);
  await as(n, async (q) => {
    assert.equal((await q("select effective_plan($1::uuid) p", [ws])).rows[0].p, "trial");
  });
});

test("members only get effective_plan() for their own workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const a = await signUp("ep1@example.com", { business: "EP A" });
  const b = await signUp("ep2@example.com", { business: "EP B" });
  const aws = await wsOf(a);
  const bws = await wsOf(b);
  await as(a, async (q) => {
    assert.equal((await q("select effective_plan($1::uuid) p", [aws])).rows[0].p, "trial");
    assert.equal((await q("select effective_plan($1::uuid) p", [bws])).rows[0].p, null);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select effective_plan($1::uuid) p", [aws]), /permission denied/);
  });
});

test("plan and status only take known values", async (t) => {
  if (!db) return t.skip("no test database");
  await assert.rejects(db.query("insert into workspaces (name, plan) values ('Bad plan', 'enterprise')"), /workspaces_plan_check/);
  await assert.rejects(db.query("insert into workspaces (name, status) values ('Bad status', 'whatever')"), /workspaces_status_check/);
});

// ─────────────── P2.1: services and sealed brand keys ───────────────

test("services: members see each product's status, never the brand id or key; other workspaces see nothing", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("svc1@example.com", { business: "Svc Co" });
  const x = await signUp("svc2@example.com", { business: "Other Co" });
  const ws = await wsOf(o);
  // The workspace's pending rows from 006_jobs.sql, replaced with a ready one and a pending one.
  await db.query("delete from services where workspace_id = $1", [ws]);
  await db.query(
    "insert into services (workspace_id, product, brand_id, sealed_key, key_prefix, status) values ($1, 'arrowsterr', 'b1', 'v2.a.iv.tag.body', 'aw_brand_ab', 'ready'), ($1, 'capybaroar', null, null, null, 'pending')",
    [ws],
  );
  await as(o, async (q) => {
    await assert.rejects(q("select * from services"), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("select sealed_key from services where workspace_id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("update services set status = 'ready' where workspace_id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    const rows = (await q("select * from service_status($1)", [ws])).rows;
    assert.deepEqual(rows.map((r) => [r.product, r.status]), [["arrowsterr", "ready"], ["capybaroar", "pending"]]);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["product", "status", "updated_at"]);
  });
  await as(x, async (q) => {
    assert.equal((await q("select * from service_status($1)", [ws])).rowCount, 0);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from service_status($1)", [ws]), /permission denied/);
  });
});

test("services: one row per product, known products and statuses only, gone with the workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("svc3@example.com", { business: "Svc3 Co" });
  const ws = await wsOf(o);
  await db.query("delete from services where workspace_id = $1", [ws]);
  await db.query("insert into services (workspace_id, product) values ($1, 'arrowsterr')", [ws]);
  await assert.rejects(db.query("insert into services (workspace_id, product) values ($1, 'arrowsterr')", [ws]), /duplicate key/);
  await assert.rejects(db.query("insert into services (workspace_id, product) values ($1, 'zapier')", [ws]), /services_product_check/);
  await assert.rejects(db.query("insert into services (workspace_id, product, status) values ($1, 'capybaroar', 'great')", [ws]), /services_status_check/);
  await db.query("delete from workspaces where id = $1", [ws]);
  assert.equal((await db.query("select count(*)::int n from services where workspace_id = $1", [ws])).rows[0].n, 0);
});

// ─────────────── P2.2: the job queue and the provision job ───────────────

test("a new workspace queues exactly one provision job and two pending services", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("prov1@example.com", { business: "Prov Co", website: "prov.example" });
  const ws = await wsOf(o);
  const jobs = (await db.query("select kind, payload, attempts, max_attempts, done_at, run_at <= now() as due from jobs where workspace_id = $1 and kind = 'provision'", [ws])).rows;
  assert.deepEqual(jobs, [{ kind: "provision", payload: {}, attempts: 0, max_attempts: 5, done_at: null, due: true }]);
  // Its website is read too (012_knowledge.sql), as its own job.
  assert.deepEqual((await db.query("select kind from jobs where workspace_id = $1 and kind <> 'provision'", [ws])).rows, [{ kind: "scan_website" }]);
  const svc = (await db.query("select product, status, brand_id, sealed_key from services where workspace_id = $1 order by product", [ws])).rows;
  assert.deepEqual(svc, [
    { product: "arrowsterr", status: "pending", brand_id: null, sealed_key: null },
    { product: "capybaroar", status: "pending", brand_id: null, sealed_key: null },
  ]);
  // The same for a workspace made in the app (create_workspace), and the owner sees it as pending.
  const second = await asCommit(o, async (q) => (await q("select create_workspace('Prov Two') id")).rows[0].id as string);
  assert.equal((await db.query("select count(*)::int n from jobs where workspace_id = $1 and kind = 'provision'", [second])).rows[0].n, 1);
  await as(o, async (q) => {
    assert.deepEqual((await q("select product, status from service_status($1)", [second])).rows, [
      { product: "arrowsterr", status: "pending" },
      { product: "capybaroar", status: "pending" },
    ]);
  });
  // A sign-up from an invite makes no workspace, so no job.
  const before = (await db.query("select count(*)::int n from jobs")).rows[0].n;
  await signUp("prov-invited@example.com");
  assert.equal((await db.query("select count(*)::int n from jobs")).rows[0].n, before);
  // A deleted workspace's jobs stay, with no workspace (008_cancel.sql), so its brands can still be removed.
  await db.query("delete from workspaces where id = $1", [second]);
  assert.equal((await db.query("select count(*)::int n from jobs where workspace_id = $1", [second])).rows[0].n, 0);
});

test("jobs: members and visitors can't read or write jobs, or call claim_jobs", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("jobs1@example.com", { business: "Jobs Co" });
  const ws = await wsOf(o);
  for (const u of [o, null]) {
    await as(u, async (q) => {
      await assert.rejects(q("select * from jobs"), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select * from jobs where workspace_id = $1", [ws]), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into jobs (kind, workspace_id) values ('provision', $1)", [ws]), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("update jobs set attempts = 0 where workspace_id = $1", [ws]), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("delete from jobs where workspace_id = $1", [ws]), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select * from claim_jobs(10)"), /permission denied for function claim_jobs/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select queue_provision()"), /permission denied|trigger functions can only be called as triggers/);
    });
  }
  // Even with table rights back, RLS with no policies still shows nothing.
  await db.query("grant select on jobs to authenticated");
  try {
    await as(o, async (q) => {
      assert.equal((await q("select * from jobs")).rowCount, 0);
    });
  } finally {
    await db.query("revoke select on jobs from authenticated");
  }
});

test("claim_jobs: two callers at once never get the same job; leases and max_attempts hold", async (t) => {
  if (!db) return t.skip("no test database");
  // Park every other test's jobs so only this test's jobs are due.
  await db.query("update jobs set run_at = run_at + interval '100 years' where kind <> 'claim_test'");
  const c1 = await connect(dbUrl);
  const c2 = await connect(dbUrl);
  const claim = async (c: pg.Client, n: number) => {
    await c.query("begin");
    await c.query("set local role service_role");
    const r = await c.query("select id, attempts from claim_jobs($1, interval '5 minutes')", [n]);
    return r.rows as { id: string; attempts: number }[];
  };
  try {
    const one = (await db.query("insert into jobs (kind) values ('claim_test') returning id")).rows[0].id as string;
    // c1 holds the job in an open transaction. c2 doesn't wait for it and doesn't get it.
    const a = await claim(c1, 5);
    const b = await claim(c2, 5);
    assert.deepEqual(a, [{ id: one, attempts: 1 }]);
    assert.deepEqual(b, []);
    await c1.query("commit");
    await c2.query("commit");
    // Leased now: a third caller doesn't get it either.
    assert.deepEqual(await claim(c2, 5), []);
    await c2.query("commit");
    // When the lease runs out (the worker died) it comes back, as a second attempt.
    await db.query("update jobs set locked_until = now() - interval '1 second' where id = $1", [one]);
    assert.deepEqual(await claim(c1, 5), [{ id: one, attempts: 2 }]);
    await c1.query("commit");
    // A job that used up its attempts, a finished one and a later one are never taken.
    await db.query("update jobs set locked_until = null, attempts = max_attempts where id = $1", [one]);
    await db.query("insert into jobs (kind, done_at) values ('claim_test', now())");
    await db.query("insert into jobs (kind, run_at) values ('claim_test', now() + interval '1 hour')");
    assert.deepEqual(await claim(c1, 5), []);
    await c1.query("commit");

    // 30 due jobs, two workers racing: every job claimed once, none twice.
    await db.query("insert into jobs (kind) select 'claim_test' from generate_series(1, 30)");
    const race = async (c: pg.Client) => {
      const got: string[] = [];
      for (let i = 0; i < 10; i++) {
        got.push(...(await claim(c, 4)).map((r) => r.id));
        await c.query("commit");
      }
      return got;
    };
    const [x, y] = await Promise.all([race(c1), race(c2)]);
    const all = [...x, ...y];
    assert.equal(all.length, 30);
    assert.equal(new Set(all).size, 30);
  } finally {
    await c1.query("rollback").catch(() => {});
    await c2.query("rollback").catch(() => {});
    await c1.end();
    await c2.end();
    await db.query("delete from jobs where kind = 'claim_test'");
    await db.query("update jobs set run_at = run_at - interval '100 years' where run_at > now() + interval '50 years'");
  }
});

test("jobs only take known shapes", async (t) => {
  if (!db) return t.skip("no test database");
  await assert.rejects(db.query("insert into jobs (kind) values ('')"), /jobs_kind_check/);
  await assert.rejects(db.query("insert into jobs (kind, max_attempts) values ('x', 0)"), /jobs_max_attempts_check/);
  await assert.rejects(db.query("insert into jobs (kind, last_error) values ('x', repeat('a', 1001))"), /jobs_last_error_check/);
});

// ─────────────── P2.3: social channels and webhook events ───────────────

test("social_channels: members read their own workspace's channels, never another's, and can't write them", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("soc1@example.com", { business: "Soc Co" });
  const x = await signUp("soc2@example.com", { business: "Soc Other" });
  const ws = await wsOf(o);
  const xws = await wsOf(x);
  // A viewer in the same workspace reads too.
  const v = await signUp("soc-viewer@example.com");
  await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [ws, v.id]);
  await db.query("set role service_role");
  try {
    assert.equal((await db.query("select save_social_channel($1, 'ch1', 'instagram', '@soc', 'connected', now()) ok", [ws])).rows[0].ok, true);
    await db.query("select save_social_channel($1, 'chx', 'facebook', 'Other', 'connected', now())", [xws]);
  } finally {
    await db.query("reset role");
  }
  for (const u of [o, v]) {
    await as(u, async (q) => {
      const rows = (await q("select workspace_id, channel_id, network, name, status from social_channels")).rows;
      assert.deepEqual(rows, [{ workspace_id: ws, channel_id: "ch1", network: "instagram", name: "@soc", status: "connected" }]);
    });
  }
  await as(o, async (q) => {
    await assert.rejects(q("insert into social_channels (workspace_id, channel_id, network, status) values ($1, 'ch2', 'x', 'connected')", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("update social_channels set status = 'lost' where workspace_id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("delete from social_channels where workspace_id = $1", [ws]), /permission denied/);
  });
  await as(o, async (q) => {
    await assert.rejects(q("select save_social_channel($1, 'ch3', 'x', 'X', 'connected', now())", [ws]), /permission denied for function save_social_channel/);
  });
  await as(x, async (q) => {
    assert.deepEqual((await q("select channel_id from social_channels")).rows, [{ channel_id: "chx" }]);
    assert.equal((await q("select * from social_channels where workspace_id = $1", [ws])).rowCount, 0);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from social_channels"), /permission denied/);
  });
  // Channels go with their workspace.
  await db.query("delete from workspaces where id = $1", [xws]);
  assert.equal((await db.query("select count(*)::int n from social_channels where workspace_id = $1", [xws])).rows[0].n, 0);
});

test("save_social_channel: an older event never replaces a newer one, and only known values are saved", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("soc3@example.com", { business: "Soc3 Co" });
  const ws = await wsOf(o);
  const save = async (status: string, at: string) => (await db!.query("select save_social_channel($1, 'ch1', 'linkedin', 'Soc3', $2, $3::timestamptz) ok", [ws, status, at])).rows[0].ok as boolean;
  assert.equal(await save("connected", "2027-01-15T08:00:00Z"), true);
  assert.equal(await save("lost", "2027-01-16T08:00:00Z"), true);
  assert.equal(await save("connected", "2027-01-15T09:00:00Z"), false, "a late retry of an older event");
  assert.equal((await db.query("select status from social_channels where workspace_id = $1", [ws])).rows[0].status, "lost");
  assert.equal(await save("connected", "2027-01-17T08:00:00Z"), true);
  await assert.rejects(save("great", "2027-01-18T08:00:00Z"), /social_channels_status_check/);
  await assert.rejects(db.query("select save_social_channel($1, 'ch2', 'Bad Network!', '', 'connected', now())", [ws]), /social_channels_network_check/);
});

test("webhook_events: server only, and each source and id once", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("whe1@example.com", { business: "Whe Co" });
  await db.query("insert into webhook_events (source, id, type) values ('capybaroar', 'msg_rls_1', 'channel.connected')");
  await assert.rejects(db.query("insert into webhook_events (source, id, type) values ('capybaroar', 'msg_rls_1', 'channel.lost')"), /duplicate key/);
  await assert.rejects(db.query("insert into webhook_events (source, id, type) values ('stripe', 'msg_rls_2', 'x')"), /webhook_events_source_check/);
  for (const u of [o, null]) {
    await as(u, async (q) => {
      await assert.rejects(q("select * from webhook_events"), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into webhook_events (source, id, type) values ('capybaroar', 'msg_fake', 'channel.connected')"), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("delete from webhook_events"), /permission denied/);
    });
  }
});

// ─────────────── P2.4: cancel and delete ───────────────

test("jobs outlive a deleted workspace: workspace_id becomes null and the payload stays", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("close1@example.com", { business: "Close Co" });
  const ws = await wsOf(o);
  const payload = { product: "capybaroar", brand_id: "cb-9", workspace_id: ws };
  const id = (await db.query("insert into jobs (kind, workspace_id, payload, run_at, max_attempts) values ('remove_brand', $1, $2, now() + interval '30 days', 12) returning id", [ws, payload])).rows[0].id;
  await db.query("delete from workspaces where id = $1", [ws]);
  const row = (await db.query("select kind, workspace_id, payload, done_at from jobs where id = $1", [id])).rows[0];
  assert.deepEqual(row, { kind: "remove_brand", workspace_id: null, payload, done_at: null });
  // The provision job made at sign-up stays too, and finds no workspace when it runs.
  assert.ok((await db.query("select count(*)::int n from jobs where kind = 'provision' and workspace_id is null")).rows[0].n >= 1);
  // Running 008 again keeps one foreign key, still on delete set null.
  await db.query(readFileSync(new URL("008_cancel.sql", SQL_DIR), "utf8"));
  const fks = (await db.query("select confdeltype from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'f'")).rows;
  assert.deepEqual(fks, [{ confdeltype: "n" }]);
});

// ─────────────── website gate: Arrowsterr waits for the website ───────────────

test("services take 'waiting', and members see it through service_status()", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("wait1@example.com", { business: "Wait Co" });
  const ws = await wsOf(o);
  await db.query("update services set status = 'waiting' where workspace_id = $1 and product = 'arrowsterr'", [ws]);
  await db.query("update services set status = 'ready' where workspace_id = $1 and product = 'capybaroar'", [ws]);
  await as(o, async (q) => {
    assert.deepEqual((await q("select product, status from service_status($1)", [ws])).rows, [
      { product: "arrowsterr", status: "waiting" },
      { product: "capybaroar", status: "ready" },
    ]);
  });
  await assert.rejects(db.query("update services set status = 'sleeping' where workspace_id = $1", [ws]), /services_status_check/);
});

test("adding the website sets a waiting Arrowsterr service pending and queues provision once", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("wait2@example.com", { business: "Wait Two" });
  const ws = await wsOf(o);
  // The sign-up provision job ran and found no website.
  await db.query("update jobs set done_at = now() where workspace_id = $1", [ws]);
  await db.query("update services set status = 'waiting' where workspace_id = $1 and product = 'arrowsterr'", [ws]);
  await db.query("update services set status = 'ready' where workspace_id = $1 and product = 'capybaroar'", [ws]);
  const open = async () => (await db!.query("select count(*)::int n from jobs where workspace_id = $1 and kind = 'provision' and done_at is null", [ws])).rows[0].n as number;

  // Changing the name, or clearing the website, starts nothing.
  await asCommit(o, (q) => q("update workspaces set name = 'Wait Two Co' where id = $1", [ws]));
  await asCommit(o, (q) => q("update workspaces set website = '' where id = $1", [ws]));
  assert.equal(await open(), 0);

  // The owner adds the website in Settings (as themselves, through row level security).
  await asCommit(o, (q) => q("update workspaces set website = 'waittwo.example' where id = $1", [ws]));
  assert.equal(await open(), 1);
  const svc = (await db.query("select product, status, last_error from services where workspace_id = $1 order by product", [ws])).rows;
  assert.deepEqual(svc, [
    { product: "arrowsterr", status: "pending", last_error: null },
    { product: "capybaroar", status: "ready", last_error: null },
  ]);
  // Changing it again while the job waits doesn't queue a second one. A ready service starts nothing either.
  await db.query("update services set status = 'waiting' where workspace_id = $1 and product = 'arrowsterr'", [ws]);
  await asCommit(o, (q) => q("update workspaces set website = 'waittwo.example/home' where id = $1", [ws]));
  assert.equal(await open(), 1);
  await db.query("update jobs set done_at = now() where workspace_id = $1", [ws]);
  await db.query("update services set status = 'ready' where workspace_id = $1", [ws]);
  await asCommit(o, (q) => q("update workspaces set website = 'other.example' where id = $1", [ws]));
  assert.equal(await open(), 0);
  // Members still can't call the trigger function.
  await as(o, async (q) => {
    await assert.rejects(q("select website_added()"), /permission denied|trigger functions can only be called as triggers/);
  });
});

// ─────────────── trials that end without a plan ───────────────

test("queue_daily_jobs: one expire_trials job per UTC day, even from many calls at once", async (t) => {
  if (!db) return t.skip("no test database");
  const asServer = async (c: pg.Client) => {
    await c.query("begin");
    await c.query("set local role service_role");
    const n = (await c.query("select queue_daily_jobs() n")).rows[0].n as number;
    await c.query("commit");
    return n;
  };
  const conns = await Promise.all([connect(dbUrl), connect(dbUrl), connect(dbUrl)]);
  try {
    // Three worker ticks at the same moment, then five more one after another.
    const made = await Promise.all(conns.map(asServer));
    for (let i = 0; i < 5; i++) made.push(await asServer(conns[0]));
    assert.equal(made.reduce((a, b) => a + b, 0), 1);
  } finally {
    await Promise.all(conns.map((c) => c.end()));
  }
  const today = (await db.query("select to_char(now() at time zone 'utc', 'YYYY-MM-DD') d")).rows[0].d;
  const rows = (await db.query("select workspace_id, payload, max_attempts, done_at, run_at <= now() due from jobs where kind = 'expire_trials'")).rows;
  assert.deepEqual(rows, [{ workspace_id: null, payload: { day: today }, max_attempts: 20, done_at: null, due: true }]);
  // Done or not, today's job is never queued twice; another day's is.
  await db.query("update jobs set done_at = now() where kind = 'expire_trials'");
  assert.equal((await db.query("select queue_daily_jobs() n")).rows[0].n, 0);
  await assert.rejects(db.query("insert into jobs (kind, payload) values ('expire_trials', $1)", [{ day: today }]), /jobs_daily_idx/);
  await db.query("update jobs set payload = '{\"day\": \"2000-01-01\"}' where kind = 'expire_trials'");
  assert.equal((await db.query("select queue_daily_jobs() n")).rows[0].n, 1);
  // Other jobs (no day in the payload) are never limited by it.
  const ws = (await db.query("insert into workspaces (name) values ('Daily Co') returning id")).rows[0].id;
  await db.query("insert into jobs (kind, workspace_id) values ('provision', $1), ('provision', $1)", [ws]);
  await db.query("delete from jobs where kind = 'expire_trials'");
});

test("expired_workspaces: trials over with open services, never running trials, paid plans or closed ones; matches trialOver()", async (t) => {
  if (!db) return t.skip("no test database");
  const { trialOver } = await import("../src/lib/closeout.ts");
  const cases: { name: string; plan: string; status: string; days: number; services: string[]; want: boolean }[] = [
    { name: "trial over, brands ready", plan: "trial", status: "trialing", days: -1, services: ["ready", "ready"], want: true },
    { name: "trial over, pending and waiting", plan: "trial", status: "trialing", days: -3, services: ["pending", "waiting"], want: true },
    { name: "trial over, one failed", plan: "trial", status: "trialing", days: -3, services: ["failed", "removed"], want: true },
    { name: "trial still running", plan: "trial", status: "trialing", days: 2, services: ["ready", "ready"], want: false },
    { name: "active", plan: "pro", status: "active", days: -30, services: ["ready", "ready"], want: false },
    { name: "past due", plan: "starter", status: "past_due", days: -30, services: ["ready", "ready"], want: false },
    { name: "first payment going through", plan: "pro", status: "incomplete", days: -1, services: ["ready", "ready"], want: false },
    { name: "canceled but the webhook's close was missed", plan: "pro", status: "canceled", days: -30, services: ["ready", "ready"], want: true },
    { name: "already removing", plan: "trial", status: "trialing", days: -20, services: ["removing", "removing"], want: false },
    { name: "already removed", plan: "trial", status: "trialing", days: -40, services: ["removed", "removed"], want: false },
  ];
  // Close every other test's workspaces so only these are expired with open services.
  await db.query("update services set status = 'removed'");
  const ids = new Map<string, string>();
  for (const c of cases) {
    const w = (await db.query("insert into workspaces (name, plan, status, trial_ends_at) values ($1, $2, $3, now() + make_interval(days => $4)) returning id, trial_ends_at", [c.name, c.plan, c.status, c.days])).rows[0];
    await db.query("update services set status = $2 where workspace_id = $1 and product = 'arrowsterr'", [w.id, c.services[0]]);
    await db.query("update services set status = $2 where workspace_id = $1 and product = 'capybaroar'", [w.id, c.services[1]]);
    ids.set(w.id, c.name);
    const ts = trialOver({ plan: c.plan, status: c.status, trial_ends_at: (w.trial_ends_at as Date).toISOString() });
    // trialOver() is the plan rule only; the SQL adds "still has an open service".
    if (c.services.some((s) => !["removing", "removed"].includes(s))) assert.equal(ts, c.want, `TypeScript: ${c.name}`);
  }
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    const found = (await db.query("select * from expired_workspaces(50) id")).rows.map((r) => ids.get(r.id));
    assert.deepEqual([...found].sort(), cases.filter((c) => c.want).map((c) => c.name).sort());
    assert.equal((await db.query("select * from expired_workspaces(2)")).rowCount, 2);
    assert.equal((await db.query("select * from expired_workspaces(0)")).rowCount, 0);
  } finally {
    await db.query("rollback");
  }
});

test("members and visitors can't call queue_daily_jobs or expired_workspaces", async (t) => {
  if (!db) return t.skip("no test database");
  const o = await signUp("daily1@example.com", { business: "Daily Owner" });
  for (const u of [o, null]) {
    await as(u, async (q) => {
      await assert.rejects(q("select queue_daily_jobs()"), /permission denied for function queue_daily_jobs/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select * from expired_workspaces(10)"), /permission denied for function expired_workspaces/);
    });
  }
});

// ─────────────── the AI team (011_ai_team.sql) ───────────────

/** A thread with one message of each role, written as the server. */
async function chatIn(ws: string, by: User) {
  const t = (await db!.query("insert into threads (workspace_id, title, created_by) values ($1, 'Plan my week', $2) returning id", [ws, by.id])).rows[0].id as string;
  await db!.query(
    "insert into messages (thread_id, workspace_id, role, agent, content, meta) values ($1, $2, 'user', null, 'Plan my week', '{}'), ($1, $2, 'agent', 'chief', 'Here it is.', '{}'), ($1, $2, 'note', 'chief', 'Athena handed this to Artemis: check', '{\"to\":\"seo\"}')",
    [t, ws],
  );
  return t;
}

test("threads and messages: every member reads their own workspace's chats, never another's; visitors see nothing", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("chat-read");
  const other = await team("chat-other");
  const mine = await chatIn(ws, owner);
  const theirs = await chatIn(other.ws, other.owner);
  for (const u of [owner, admin, editor, viewer]) {
    await as(u, async (q) => {
      assert.deepEqual((await q("select id from threads")).rows, [{ id: mine }]);
      const msgs = (await q("select role, agent, content from messages order by id")).rows;
      assert.deepEqual(msgs.map((m) => m.role), ["user", "agent", "note"]);
      assert.equal((await q("select * from messages where thread_id = $1", [theirs])).rowCount, 0);
    });
  }
  await as(null, async (q) => {
    await assert.rejects(q("select * from threads"), /permission denied/);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from messages"), /permission denied/);
  });
});

test("threads: editors and up start, rename and delete chats; viewers can't; nobody writes another workspace's", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("chat-write");
  const other = await team("chat-write-other");
  for (const u of [owner, admin, editor]) {
    await as(u, async (q) => {
      const id = (await q("insert into threads (workspace_id, title, created_by) values ($1, 'Mine', $2) returning id", [ws, u.id])).rows[0].id;
      assert.equal((await q("update threads set title = 'Renamed' where id = $1", [id])).rowCount, 1);
      assert.equal((await q("delete from threads where id = $1", [id])).rowCount, 1);
    });
    // Started in someone else's name, or in another workspace.
    await as(u, async (q) => {
      await assert.rejects(q("insert into threads (workspace_id, title, created_by) values ($1, 'x', $2)", [ws, other.owner.id]), /row-level security/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into threads (workspace_id, title, created_by) values ($1, 'x', $2)", [other.ws, u.id]), /row-level security/);
    });
  }
  const id = await chatIn(ws, owner);
  await as(viewer, async (q) => {
    await assert.rejects(q("insert into threads (workspace_id, title, created_by) values ($1, 'x', $2)", [ws, viewer.id]), /row-level security/);
  });
  await as(viewer, async (q) => {
    assert.equal((await q("update threads set title = 'x' where id = $1", [id])).rowCount, 0);
    assert.equal((await q("delete from threads where id = $1", [id])).rowCount, 0);
  });
  // Only the title can be changed by people. updated_at is the server's.
  await as(editor, async (q) => {
    await assert.rejects(q("update threads set updated_at = now() where id = $1", [id]), /permission denied/);
  });
  await as(other.owner, async (q) => {
    assert.equal((await q("delete from threads where id = $1", [id])).rowCount, 0);
  });
  // Deleting a chat deletes its messages.
  await as(editor, async (q) => {
    assert.equal((await q("delete from threads where id = $1", [id])).rowCount, 1);
    assert.equal((await q("select count(*)::int n from messages where thread_id = $1", [id])).rows[0].n, 0);
  });
});

test("messages: editors write only their own words, in their own workspace's threads; viewers write nothing", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, editor, viewer } = await team("msg-write");
  const other = await team("msg-write-other");
  const id = await chatIn(ws, owner);
  const theirs = await chatIn(other.ws, other.owner);
  await as(editor, async (q) => {
    assert.equal((await q("insert into messages (thread_id, workspace_id, role, content) values ($1, $2, 'user', 'More please')", [id, ws])).rowCount, 1);
  });
  // A reply that looks like it came from an agent, or a handoff note: only the server writes those.
  for (const [role, agent] of [
    ["agent", "chief"],
    ["note", "chief"],
  ]) {
    await as(editor, async (q) => {
      await assert.rejects(q("insert into messages (thread_id, workspace_id, role, agent, content) values ($1, $2, $3, $4, 'fake')", [id, ws, role, agent]), /row-level security/);
    });
  }
  await as(viewer, async (q) => {
    await assert.rejects(q("insert into messages (thread_id, workspace_id, role, content) values ($1, $2, 'user', 'hi')", [id, ws]), /row-level security/);
  });
  // Another workspace's thread, named as this workspace or as its own.
  await as(editor, async (q) => {
    await assert.rejects(q("insert into messages (thread_id, workspace_id, role, content) values ($1, $2, 'user', 'x')", [theirs, ws]), /foreign key/);
  });
  await as(editor, async (q) => {
    await assert.rejects(q("insert into messages (thread_id, workspace_id, role, content) values ($1, $2, 'user', 'x')", [theirs, other.ws]), /row-level security/);
  });
  // Nobody edits or deletes a message: the history stays as it was.
  await as(owner, async (q) => {
    await assert.rejects(q("update messages set content = 'changed' where thread_id = $1", [id]), /permission denied/);
  });
  await as(owner, async (q) => {
    await assert.rejects(q("delete from messages where thread_id = $1", [id]), /permission denied/);
  });
});

test("messages only take known roles, agents and shapes", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner } = await team("msg-shape");
  const id = await chatIn(ws, owner);
  const bad = [
    ["robot", "chief", "role"],
    ["agent", "zeus", "agent"],
    ["agent", null, "check"],
    ["user", "chief", "check"],
  ];
  for (const [role, agent] of bad) {
    await assert.rejects(db.query("insert into messages (thread_id, workspace_id, role, agent, content) values ($1, $2, $3, $4, 'x')", [id, ws, role, agent]), /violates check constraint/);
  }
  await assert.rejects(db.query("insert into messages (thread_id, workspace_id, role, content, meta) values ($1, $2, 'user', 'x', '[]')", [id, ws]), /violates check constraint/);
  await assert.rejects(db.query("insert into messages (thread_id, workspace_id, role, content) values ($1, $2, 'user', $3)", [id, ws, "x".repeat(40001)]), /violates check constraint/);
});

test("agent_prefs: members read, admins and the owner change, others can't; known values only", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("prefs");
  const other = await team("prefs-other");
  for (const u of [owner, admin]) {
    await as(u, async (q) => {
      await q("insert into agent_prefs (workspace_id, agent, enabled, trust, model) values ($1, 'seo', false, 2, 'sonnet')", [ws]);
      assert.equal((await q("update agent_prefs set enabled = true where workspace_id = $1 and agent = 'seo'", [ws])).rowCount, 1);
      assert.equal((await q("delete from agent_prefs where workspace_id = $1 and agent = 'seo'", [ws])).rowCount, 1);
    });
  }
  await db.query("insert into agent_prefs (workspace_id, agent, enabled) values ($1, 'social', false), ($2, 'social', true)", [ws, other.ws]);
  for (const u of [editor, viewer]) {
    await as(u, async (q) => {
      assert.deepEqual((await q("select workspace_id, agent, enabled, trust, model from agent_prefs")).rows, [{ workspace_id: ws, agent: "social", enabled: false, trust: 0, model: "auto" }]);
      assert.equal((await q("update agent_prefs set enabled = true where workspace_id = $1", [ws])).rowCount, 0);
      assert.equal((await q("delete from agent_prefs where workspace_id = $1", [ws])).rowCount, 0);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into agent_prefs (workspace_id, agent) values ($1, 'web')", [ws]), /row-level security/);
    });
  }
  await as(owner, async (q) => {
    assert.equal((await q("update agent_prefs set enabled = false where workspace_id = $1", [other.ws])).rowCount, 0);
  });
  await as(owner, async (q) => {
    await assert.rejects(q("insert into agent_prefs (workspace_id, agent) values ($1, 'web')", [other.ws]), /row-level security/);
  });
  for (const [col, val] of [
    ["trust", 3],
    ["model", "gpt"],
    ["agent", "zeus"],
  ] as const) {
    await assert.rejects(db.query(`insert into agent_prefs (workspace_id, agent, ${col === "agent" ? "enabled" : col}) values ($1, $2, $3)`, [ws, col === "agent" ? val : "web", col === "agent" ? true : val]), /violates check constraint/);
  }
});

test("ai_usage, ai_spend and cost_by_workspace: server only", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, viewer } = await team("usage");
  await db.query("insert into ai_usage (workspace_id, agent, model, input_tokens, output_tokens, cost_usd) values ($1, 'chief', 'claude-opus-5-5', 10, 10, 0.5)", [ws]);
  for (const u of [owner, viewer, null]) {
    await as(u, async (q) => {
      await assert.rejects(q("select * from ai_usage"), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("insert into ai_usage (workspace_id, model, cost_usd) values ($1, 'x', 0)", [ws]), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select * from cost_by_workspace"), /permission denied/);
    });
    await as(u, async (q) => {
      await assert.rejects(q("select ai_spend($1, now() - interval '1 day')", [ws]), /permission denied for function ai_spend/);
    });
  }
});

test("ai_spend sums a workspace's AI cost since a time; cost_by_workspace adds it up per month", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws } = await team("spend");
  const other = await team("spend-other");
  await db.query(
    `insert into ai_usage (workspace_id, agent, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at) values
       ($1, 'chief', 'claude-opus-5-5', 100, 10, 1000, 50, 1.25, now() - interval '2 days'),
       ($1, 'seo', 'claude-opus-5-5', 100, 10, 0, 0, 0.75, now() - interval '1 hour'),
       ($1, 'seo', 'claude-opus-5-5', 1, 1, 0, 0, 9, now() - interval '40 days'),
       ($2, 'chief', 'claude-opus-5-5', 1, 1, 0, 0, 100, now())`,
    [ws, other.ws],
  );
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    const spend = async (since: string) => Number((await db!.query(`select ai_spend($1, now() - interval '${since}') usd`, [ws])).rows[0].usd);
    assert.equal(await spend("3 days"), 2);
    assert.equal(await spend("1 day"), 0.75);
    assert.equal(await spend("1 minute"), 0);
    assert.equal(Number((await db.query("select ai_spend(gen_random_uuid(), now() - interval '1 year') usd")).rows[0].usd), 0);
    const rows = (await db.query("select name, plan, month, cost_usd, calls, input_tokens, cache_read_tokens from cost_by_workspace where workspace_id = $1 order by month", [ws])).rows;
    const thisMonth = rows.filter((r) => Number(r.cost_usd) !== 9);
    assert.ok(thisMonth.length >= 1);
    assert.equal(rows.reduce((s, r) => s + Number(r.cost_usd), 0), 11);
    assert.equal(rows.reduce((s, r) => s + Number(r.calls), 0), 3);
    assert.ok(rows.every((r) => r.name === "spend Co" && r.plan === "trial"));
  } finally {
    await db.query("rollback");
  }
});

test("deleting a workspace deletes its chats and settings, and keeps its AI usage without a workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner } = await team("chat-gone");
  const id = await chatIn(ws, owner);
  await db.query("insert into agent_prefs (workspace_id, agent) values ($1, 'seo')", [ws]);
  const u = (await db.query("insert into ai_usage (workspace_id, thread_id, agent, model, cost_usd) values ($1, $2, 'chief', 'claude-opus-5-5', 0.1) returning id", [ws, id])).rows[0].id;
  await asCommit(owner, (q) => q("delete from workspaces where id = $1", [ws]));
  assert.equal((await db.query("select count(*)::int n from threads where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from messages where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from agent_prefs where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.deepEqual((await db.query("select workspace_id, thread_id, cost_usd from ai_usage where id = $1", [u])).rows, [{ workspace_id: null, thread_id: null, cost_usd: "0.100000" }]);
});

// ─────────────── P3.2: Knowledge, search and the website scan (012_knowledge.sql) ───────────────

/** A workspace with an owner, an editor and a viewer, and a stranger from another workspace. */
async function knowledgeTeam(tag: string, website: string | null = null) {
  const owner = await signUp(`kn-own-${tag}@example.com`, { business: `Kn ${tag}`, ...(website ? { website } : {}) });
  const ws = await wsOf(owner);
  const editor = await signUp(`kn-ed-${tag}@example.com`);
  const viewer = await signUp(`kn-vw-${tag}@example.com`);
  await db!.query("insert into workspace_members (workspace_id, user_id, email, role) values ($1, $2, $3, 'editor'), ($1, $4, $5, 'viewer')", [ws, editor.id, editor.email, viewer.id, viewer.email]);
  const stranger = await signUp(`kn-str-${tag}@example.com`, { business: `Other ${tag}` });
  return { owner, editor, viewer, stranger, ws, otherWs: await wsOf(stranger) };
}

const asService = async <T,>(fn: (q: (sql: string, args?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> => {
  await db!.query("begin");
  try {
    await db!.query("set local role service_role");
    const r = await fn((sql, args) => db!.query(sql, args));
    await db!.query("commit");
    return r;
  } catch (e) {
    await db!.query("rollback");
    throw e;
  }
};

test("knowledge_docs: members read, editors and up write, viewers only read, other workspaces and visitors see nothing", async (t) => {
  if (!db) return t.skip("no test database");
  const { owner, editor, viewer, stranger, ws, otherWs } = await knowledgeTeam("rls");
  const id = await asCommit(editor, async (q) =>
    (await q("insert into knowledge_docs (workspace_id, title, body, agent) values ($1, 'Prices', 'Loaf $8', 'social') returning id, created_by, source", [ws])).rows[0]);
  assert.equal(id.created_by, editor.id);
  assert.equal(id.source, "manual");

  for (const u of [owner, editor, viewer]) {
    await as(u, async (q) => assert.equal((await q("select * from knowledge_docs where workspace_id = $1", [ws])).rowCount, 1));
  }
  // A viewer can't add, change or delete.
  await as(viewer, async (q) => {
    await assert.rejects(q("insert into knowledge_docs (workspace_id, title) values ($1, 'Mine')", [ws]), /row-level security/);
  });
  await as(viewer, async (q) => {
    assert.equal((await q("update knowledge_docs set title = 'Changed' where id = $1", [id.id])).rowCount, 0);
    assert.equal((await q("delete from knowledge_docs where id = $1", [id.id])).rowCount, 0);
  });
  // Editors change and delete; updated_at follows the change.
  await as(editor, async (q) => {
    const before = (await q("select updated_at from knowledge_docs where id = $1", [id.id])).rows[0].updated_at as Date;
    await q("select pg_sleep(0.01)");
    await q("update knowledge_docs set title = 'Our prices', body = 'Loaf $9', agent = null where id = $1", [id.id]);
    const after = (await q("select title, updated_at from knowledge_docs where id = $1", [id.id])).rows[0];
    assert.equal(after.title, "Our prices");
    assert.ok(after.updated_at >= before);
    assert.equal((await q("delete from knowledge_docs where id = $1", [id.id])).rowCount, 1);
  });
  // Someone from another workspace, and a signed-out visitor, see and change nothing.
  await as(stranger, async (q) => {
    assert.equal((await q("select * from knowledge_docs where workspace_id = $1", [ws])).rowCount, 0);
    assert.equal((await q("update knowledge_docs set title = 'hacked' where id = $1", [id.id])).rowCount, 0);
    assert.equal((await q("delete from knowledge_docs where id = $1", [id.id])).rowCount, 0);
  });
  await as(stranger, async (q) => {
    await assert.rejects(q("insert into knowledge_docs (workspace_id, title) values ($1, 'Planted')", [ws]), /row-level security/);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from knowledge_docs"), /permission denied/);
  });
  // Editors can't fake who wrote a doc, claim it came from the website, or move it to another workspace.
  await as(editor, async (q) => {
    await assert.rejects(q("insert into knowledge_docs (workspace_id, title, created_by) values ($1, 'X', $2)", [ws, owner.id]), /permission denied/);
  });
  await as(editor, async (q) => {
    await assert.rejects(q("insert into knowledge_docs (workspace_id, title, source) values ($1, 'X', 'website')", [ws]), /row-level security/);
  });
  await as(editor, async (q) => {
    await assert.rejects(q("update knowledge_docs set source = 'website' where id = $1", [id.id]), /permission denied/);
  });
  await as(editor, async (q) => {
    await assert.rejects(q("update knowledge_docs set workspace_id = $2 where id = $1", [id.id, otherWs]), /permission denied/);
  });
  // Only the server saves the website doc.
  await as(owner, async (q) => {
    await assert.rejects(q("select save_website_doc($1, 'About', 'x', 'https://x.example/')", [ws]), /permission denied for function save_website_doc/);
  });
});

test("knowledge_docs: known values only, 200 docs at most (the website doc aside), one website doc replaced each scan, gone with the workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const { owner, editor, ws } = await knowledgeTeam("limits");
  for (const [sql, err] of [
    ["insert into knowledge_docs (workspace_id, title) values ($1, ' ')", /knowledge_docs_title_check/],
    ["insert into knowledge_docs (workspace_id, title, agent) values ($1, 'X', 'Bad Agent')", /knowledge_docs_agent_check/],
    ["insert into knowledge_docs (workspace_id, title, source) values ($1, 'X', 'email')", /knowledge_docs_source_check/],
    ["insert into knowledge_docs (workspace_id, title, body) values ($1, 'X', repeat('a', 50001))", /knowledge_docs_body_check/],
  ] as const) {
    await assert.rejects(db.query(sql, [ws]), err);
  }

  const first = await asService(async (q) => (await q("select save_website_doc($1, 'Website notes', 'From the site', 'https://kn.example/') id", [ws])).rows[0].id);
  const again = await asService(async (q) => (await q("select save_website_doc($1, 'About Kn limits', 'What we sell: bread', 'https://kn.example/') id", [ws])).rows[0].id);
  assert.equal(again, first, "a new scan replaces the website doc");
  assert.deepEqual((await db.query("select title, body, source, created_by from knowledge_docs where workspace_id = $1", [ws])).rows, [
    { title: "About Kn limits", body: "What we sell: bread", source: "website", created_by: null },
  ]);

  await db.query("insert into knowledge_docs (workspace_id, title) select $1, 'Doc ' || g from generate_series(1, 200) g", [ws]);
  await as(editor, async (q) => {
    await assert.rejects(q("insert into knowledge_docs (workspace_id, title) values ($1, 'One more')", [ws]), /You can have up to 200 docs/);
  });
  await asService(async (q) => q("select save_website_doc($1, 'About Kn limits', 'Still saves', 'https://kn.example/')", [ws]));
  assert.equal((await db.query("select body from knowledge_docs where workspace_id = $1 and source = 'website'", [ws])).rows[0].body, "Still saves");

  await asCommit(owner, (q) => q("delete from workspaces where id = $1", [ws]));
  assert.equal((await db.query("select count(*)::int n from knowledge_docs where workspace_id = $1", [ws])).rows[0].n, 0);
});

test("search_knowledge: word matches first, title before body, a plain text fallback, plain snippets, only the caller's workspace", async (t) => {
  if (!db) return t.skip("no test database");
  const { owner, viewer, stranger, ws, otherWs } = await knowledgeTeam("search");
  const add = (w: string, title: string, body: string) => db!.query("insert into knowledge_docs (workspace_id, title, body) values ($1, $2, $3)", [w, title, body]);
  await add(ws, "Prices", "A sourdough loaf costs $8 and a rye loaf costs $9.");
  await add(ws, "Menu", "Breads, cakes and pastries. Ask about our prices for weddings.");
  await add(ws, "Wedding cakes", "We bake custom cakes for weddings and birthdays. Order two weeks ahead.");
  await add(ws, "Hours", "Open Tuesday to Sunday, 7 to 3. 50% off bread after 2.");
  await add(otherWs, "Prices", "Secret prices of another business.");

  const search = (u: User, w: string, text: string, n = 8) => as(u, async (q) => (await q("select id, title, snippet, rank from search_knowledge($1, $2, $3)", [w, text, n])).rows);

  const prices = await search(viewer, ws, "prices");
  assert.deepEqual(prices.map((r) => r.title), ["Prices", "Menu"], "a title match ranks above a body match");
  assert.ok(prices.every((r) => r.rank >= 1));
  assert.ok(prices[0].rank > prices[1].rank);
  assert.match(prices[1].snippet, /Ask about our prices for weddings/);
  assert.doesNotMatch(prices[1].snippet, /<b>|<\/b>/, "snippets are plain text");

  // Stemming: "baking" finds "bake"; two words both count.
  assert.deepEqual((await search(viewer, ws, "baking birthdays")).map((r) => r.title), ["Wedding cakes"]);
  // Part of a word isn't a word match, so the plain text match finds it, titles first.
  const part = await search(viewer, ws, "wedd");
  assert.deepEqual(part.map((r) => [r.title, r.rank]), [["Wedding cakes", 0.5], ["Menu", 0.25]]);
  const sour = await search(viewer, ws, "sourd");
  assert.deepEqual(sour.map((r) => r.title), ["Prices"]);
  assert.match(sour[0].snippet, /sourdough loaf costs \$8/);
  // A % or _ is a plain character, not a wildcard.
  assert.deepEqual((await search(viewer, ws, "50%")).map((r) => r.title), ["Hours"]);
  assert.deepEqual(await search(viewer, ws, "_"), []);
  assert.deepEqual(await search(viewer, ws, "   "), []);
  assert.equal((await search(viewer, ws, "cakes", 1)).length, 1);

  // Another workspace's docs never come back, even when asked for by id.
  assert.deepEqual(await search(stranger, ws, "prices"), []);
  assert.deepEqual((await search(owner, otherWs, "prices")), []);
  assert.match((await search(stranger, otherWs, "prices"))[0].snippet, /^Secret prices of another business/);
  // The server (service role, no row level security) still gets only the workspace it names.
  const server = await asService(async (q) => (await q("select title from search_knowledge($1, 'prices', 8)", [ws])).rows);
  assert.deepEqual(server.map((r) => r.title), ["Prices", "Menu"]);
  await as(null, async (q) => {
    await assert.rejects(q("select * from search_knowledge($1, 'prices', 8)", [ws]), /permission denied/);
  });
});

test("website scan: queued for a new workspace with a website and when it changes, once at a time", async (t) => {
  if (!db) return t.skip("no test database");
  const scans = async (w: string, open = true) =>
    (await db!.query(`select count(*)::int n from jobs where workspace_id = $1 and kind = 'scan_website'${open ? " and done_at is null" : ""}`, [w])).rows[0].n as number;
  const { owner, ws } = await knowledgeTeam("scan", "scan.example");
  assert.equal(await scans(ws), 1);
  assert.equal((await db.query("select max_attempts from jobs where workspace_id = $1 and kind = 'scan_website'", [ws])).rows[0].max_attempts, 3);
  // No website, no scan. create_workspace in the app works the same.
  const none = await signUp("kn-none@example.com", { business: "No Site" });
  assert.equal(await scans(await wsOf(none), false), 0);
  const made = await asCommit(owner, async (q) => (await q("select create_workspace('Made Here', 'made.example') id")).rows[0].id as string);
  assert.equal(await scans(made), 1);

  // Changing the website while a scan waits adds nothing. After it ran, a change queues a new one.
  await asCommit(owner, (q) => q("update workspaces set website = 'scan.example/home' where id = $1", [ws]));
  assert.equal(await scans(ws), 1);
  await db.query("update jobs set done_at = now() where workspace_id = $1 and kind = 'scan_website'", [ws]);
  await asCommit(owner, (q) => q("update workspaces set name = 'Renamed' where id = $1", [ws]));
  await asCommit(owner, (q) => q("update workspaces set website = '' where id = $1", [ws]));
  assert.equal(await scans(ws), 0, "renaming or clearing the website reads nothing");
  await asCommit(owner, (q) => q("update workspaces set website = 'new-scan.example' where id = $1", [ws]));
  assert.equal(await scans(ws), 1);
  // A scan running right now may have read the old address, so a change queues another.
  await db.query("update jobs set locked_until = now() + interval '5 minutes', attempts = 1 where workspace_id = $1 and kind = 'scan_website' and done_at is null", [ws]);
  await asCommit(owner, (q) => q("update workspaces set website = 'newer-scan.example' where id = $1", [ws]));
  assert.equal(await scans(ws), 2);
  await as(owner, async (q) => {
    await assert.rejects(q("select queue_website_scan()"), /permission denied|trigger functions can only be called as triggers/);
  });
});

test("rescan_website: editors and up start a scan, once at a time; website_scan_status shows members where it is", async (t) => {
  if (!db) return t.skip("no test database");
  const { owner, editor, viewer, stranger, ws } = await knowledgeTeam("rescan", "rescan.example");
  const status = (u: User) => as(u, async (q) => (await q("select status from website_scan_status($1)", [ws])).rows.map((r) => r.status));
  assert.deepEqual(await status(viewer), ["queued"]);
  assert.deepEqual(await status(stranger), []);

  await as(viewer, async (q) => {
    await assert.rejects(q("select rescan_website($1)", [ws]), /You need editor access/);
  });
  await as(stranger, async (q) => {
    await assert.rejects(q("select rescan_website($1)", [ws]), /You need editor access/);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select rescan_website($1)", [ws]), /permission denied/);
  });
  // One is already waiting.
  assert.equal(await asCommit(editor, async (q) => (await q("select rescan_website($1) ok", [ws])).rows[0].ok), false);

  await db.query("update jobs set locked_until = now() + interval '5 minutes', attempts = 1 where workspace_id = $1 and kind = 'scan_website'", [ws]);
  assert.deepEqual(await status(viewer), ["running"]);
  await db.query("update jobs set locked_until = null, attempts = max_attempts where workspace_id = $1 and kind = 'scan_website'", [ws]);
  assert.deepEqual(await status(viewer), ["failed"]);
  // Just started (in the last 2 minutes): no second scan yet.
  assert.equal(await asCommit(editor, async (q) => (await q("select rescan_website($1) ok", [ws])).rows[0].ok), false);
  await db.query("update jobs set created_at = now() - interval '10 minutes' where workspace_id = $1 and kind = 'scan_website'", [ws]);
  assert.equal(await asCommit(editor, async (q) => (await q("select rescan_website($1) ok", [ws])).rows[0].ok), true);
  assert.deepEqual(await status(owner), ["queued"]);
  await db.query("update jobs set done_at = now() where workspace_id = $1 and kind = 'scan_website'", [ws]);
  assert.deepEqual(await status(viewer), ["done"]);

  await asCommit(owner, (q) => q("update workspaces set website = null where id = $1", [ws]));
  await as(editor, async (q) => {
    await assert.rejects(q("select rescan_website($1)", [ws]), /Add your website in Settings first/);
  });
});

// ─────────────── P3.3: approvals and activity (013_approvals.sql) ───────────────

/** A pending approval in a workspace, saved the way the server saves it. */
async function approvalIn(ws: string, thread: string | null, o: { status?: string; decidedAgo?: string } = {}) {
  return (
    await db!.query(
      `insert into approvals (workspace_id, thread_id, agent, product, tool, input, title, why, status, decided_at, finished_at)
       values ($1, $2, 'social', 'capybaroar', 'create_posts', '{"posts":[{"text":"Hi"}]}', 'Create posts (Social media)', 'This changes your social media.', $3,
               case when $3 = 'pending' then null else now() - $4::interval end, case when $3 in ('done', 'failed') then now() end) returning id`,
      [ws, thread, o.status ?? "pending", o.decidedAgo ?? "0 seconds"],
    )
  ).rows[0].id as string;
}

test("approvals and activity: every member reads their own workspace's, never another's; visitors see nothing; nobody writes them from the browser", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("ap-read");
  const other = await team("ap-other");
  const thread = await chatIn(ws, owner);
  const mine = await approvalIn(ws, thread);
  const theirs = await approvalIn(other.ws, null);
  await db.query("insert into activity (workspace_id, agent, thread_id, approval_id, text) values ($1, 'social', $2, $3, 'prepared it'), ($4, 'social', null, $5, 'theirs')", [ws, thread, mine, other.ws, theirs]);
  for (const u of [owner, admin, editor, viewer]) {
    await as(u, async (q) => {
      assert.deepEqual((await q("select id, status from approvals")).rows, [{ id: mine, status: "pending" }]);
      assert.deepEqual((await q("select text from activity")).rows, [{ text: "prepared it" }]);
    });
    for (const sql of [
      ["update approvals set status = 'done' where id = $1", [mine]],
      ["update approvals set input = '{}' where id = $1", [mine]],
      ["delete from approvals where id = $1", [mine]],
      ["insert into approvals (workspace_id, agent, product, tool, title) values ($1, 'social', 'capybaroar', 'create_posts', 'x')", [ws]],
      ["insert into activity (workspace_id, text) values ($1, 'x')", [ws]],
      ["update activity set text = 'x' where workspace_id = $1", [ws]],
      ["delete from activity where workspace_id = $1", [ws]],
    ] as const) {
      await as(u, async (q) => {
        await assert.rejects(q(sql[0], [...sql[1]]), /permission denied/, sql[0]);
      });
    }
  }
  await as(null, async (q) => {
    await assert.rejects(q("select * from approvals"), /permission denied/);
  });
  await as(null, async (q) => {
    await assert.rejects(q("select * from activity"), /permission denied/);
  });
  assert.equal((await db.query("select status from approvals where id = $1", [mine])).rows[0].status, "pending");
});

test("decide_approval, finish_approval and fail_stale_approvals: server only", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, editor, viewer } = await team("ap-fn");
  const id = await approvalIn(ws, null);
  for (const u of [owner, editor, viewer, null]) {
    for (const sql of [
      ["select * from decide_approval($1, $2, $3, 'approve')", [id, ws, owner.id]],
      ["select finish_approval($1, $2, 'done', 'ok')", [id, ws]],
      ["select fail_stale_approvals('1 minute')", []],
    ] as const) {
      await as(u, async (q) => {
        await assert.rejects(q(sql[0], [...sql[1]]), /permission denied for function/, sql[0]);
      });
    }
  }
  assert.equal((await db.query("select status from approvals where id = $1", [id])).rows[0].status, "pending");
});

test("decide_approval: editors and up decide once; viewers, strangers and other workspaces get nothing; edited details replace the saved ones", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner, admin, editor, viewer } = await team("ap-decide");
  const other = await team("ap-decide-other");
  const decideAs = (id: string, wsId: string, by: User, action: string, input: unknown = null) =>
    asService(async (q) => (await q("select id, status, input, decided_by from decide_approval($1, $2, $3, $4, $5)", [id, wsId, by.id, action, input === null ? null : JSON.stringify(input)])).rows);

  const a = await approvalIn(ws, null);
  assert.deepEqual(await decideAs(a, ws, viewer, "approve"), [], "a viewer");
  assert.deepEqual(await decideAs(a, ws, other.owner, "approve"), [], "the owner of another workspace");
  assert.deepEqual(await decideAs(a, other.ws, other.owner, "approve"), [], "named under the wrong workspace");
  const [row] = await decideAs(a, ws, editor, "approve", { posts: [{ text: "Edited" }] });
  assert.deepEqual({ ...row, id: String(row.id) }, { id: String(a), status: "running", input: { posts: [{ text: "Edited" }] }, decided_by: editor.id });
  assert.deepEqual(await decideAs(a, ws, owner, "approve"), [], "a second approve");
  assert.deepEqual(await decideAs(a, ws, owner, "deny"), [], "a deny after it was approved");

  for (const u of [owner, admin]) {
    const d = await approvalIn(ws, null);
    const [denied] = await decideAs(d, ws, u, "deny", { ignored: true });
    assert.deepEqual([denied.status, denied.input], ["denied", { posts: [{ text: "Hi" }] }]);
  }
  await assert.rejects(decideAs(a, ws, owner, "run"), /Pick approve or deny/);
  const b = await approvalIn(ws, null);
  await assert.rejects(decideAs(b, ws, owner, "approve", [1]), /must be an object/);
});

test("finish_approval only finishes a decided call, as done or failed; fail_stale_approvals fails calls that never finished", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws } = await team("ap-finish");
  const other = await team("ap-finish-other");
  const finish = (id: string, wsId: string, status: string) => asService(async (q) => (await q("select finish_approval($1, $2, $3, 'result') ok", [id, wsId, status])).rows[0].ok);

  const pendingId = await approvalIn(ws, null);
  assert.equal(await finish(pendingId, ws, "done"), false, "a pending one never becomes done");
  const running = await approvalIn(ws, null, { status: "running" });
  assert.equal(await finish(running, other.ws, "done"), false, "another workspace");
  await assert.rejects(finish(running, ws, "pending"), /done or failed/);
  assert.equal(await finish(running, ws, "done"), true);
  assert.equal(await finish(running, ws, "failed"), false, "only once");
  const r = (await db.query("select status, result, finished_at is not null finished from approvals where id = $1", [running])).rows[0];
  assert.deepEqual(r, { status: "done", result: "result", finished: true });

  const stale = await approvalIn(ws, null, { status: "running", decidedAgo: "11 minutes" });
  const staleApproved = await approvalIn(other.ws, null, { status: "approved", decidedAgo: "1 hour" });
  const fresh = await approvalIn(ws, null, { status: "running", decidedAgo: "1 minute" });
  const oldPending = await approvalIn(ws, null);
  await db.query("update approvals set created_at = now() - interval '2 days' where id = $1", [oldPending]);
  const n = await asService(async (q) => (await q("select fail_stale_approvals('10 minutes') n")).rows[0].n);
  assert.ok(n >= 2);
  const statusOf = async (id: string) => (await db!.query("select status, result from approvals where id = $1", [id])).rows[0];
  assert.deepEqual(await statusOf(stale), { status: "failed", result: "This stopped before it finished, so we don't know if it ran. Check before you try again." });
  assert.equal((await statusOf(staleApproved)).status, "failed");
  assert.equal((await statusOf(fresh)).status, "running");
  assert.equal((await statusOf(oldPending)).status, "pending", "waiting for a person is never stale");
});

test("approvals: known values only, the chat must be in the same workspace, a deleted chat keeps the approval, a deleted workspace removes both tables' rows", async (t) => {
  if (!db) return t.skip("no test database");
  const { ws, owner } = await team("ap-shape");
  const other = await team("ap-shape-other");
  const thread = await chatIn(ws, owner);
  const theirThread = await chatIn(other.ws, other.owner);
  const base = "insert into approvals (workspace_id, thread_id, agent, product, tool, input, title, status) values ($1, $2, $3, $4, 'create_posts', $5, 'T', $6)";
  for (const [agent, product, input, status] of [
    ["zeus", "capybaroar", "{}", "pending"],
    ["social", "Capy Baroar", "{}", "pending"],
    ["social", "capybaroar", "[]", "pending"],
    ["social", "capybaroar", "{}", "skipped"],
  ]) {
    await assert.rejects(db.query(base, [ws, null, agent, product, input, status]), /violates check constraint/, `${agent} ${product} ${input} ${status}`);
  }
  // A decided approval needs decided_at, a finished one finished_at.
  await assert.rejects(db.query(base, [ws, null, "social", "capybaroar", "{}", "running"]), /violates check constraint/);
  await assert.rejects(db.query(base, [ws, theirThread, "social", "capybaroar", "{}", "pending"]), /violates foreign key constraint/, "another workspace's chat");
  const id = await approvalIn(ws, thread);
  await db.query("insert into activity (workspace_id, agent, thread_id, approval_id, text) values ($1, 'social', $2, $3, 'prepared it')", [ws, thread, id]);
  await asCommit(owner, (q) => q("delete from threads where id = $1", [thread]));
  assert.deepEqual((await db.query("select workspace_id, thread_id from approvals where id = $1", [id])).rows, [{ workspace_id: ws, thread_id: null }]);
  assert.deepEqual((await db.query("select workspace_id, thread_id from activity where approval_id = $1", [id])).rows, [{ workspace_id: ws, thread_id: null }]);
  await asCommit(owner, (q) => q("delete from workspaces where id = $1", [ws]));
  assert.equal((await db.query("select count(*)::int n from approvals where workspace_id = $1", [ws])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from activity where workspace_id = $1", [ws])).rows[0].n, 0);
});
