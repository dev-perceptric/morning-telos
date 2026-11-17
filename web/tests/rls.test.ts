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
  const jobs = (await db.query("select kind, payload, attempts, max_attempts, done_at, run_at <= now() as due from jobs where workspace_id = $1", [ws])).rows;
  assert.deepEqual(jobs, [{ kind: "provision", payload: {}, attempts: 0, max_attempts: 5, done_at: null, due: true }]);
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
