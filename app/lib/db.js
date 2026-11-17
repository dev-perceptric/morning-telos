// Postgres connection, schema and migrations (all idempotent, run on start).
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://mt:mt@localhost:5432/mt",
  max: 10,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

const SCHEMA = `
create table if not exists workspaces (
  id serial primary key,
  name text not null,
  website text not null default '',
  timezone text not null default 'America/Chicago',
  plan text not null default 'trial',
  status text not null default 'trialing',
  trial_ends_at timestamptz not null default now() + interval '14 days',
  period_start timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  arrowsterr_brand text,
  capybaroar_brand_id text,
  setup_note text not null default '',
  hook_token text,
  created_at timestamptz not null default now()
);
create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null default '',
  pass_hash text not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);
alter table users add column if not exists workspace_id int references workspaces(id) on delete cascade;
alter table users add column if not exists is_admin boolean not null default false;
create table if not exists sessions (
  token text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists settings (key text primary key, value text);
-- Platform connections: Morning Telos's own keys (Claude, Arrowsterr, Capybaroar, Stripe...).
create table if not exists connections (
  tool text primary key,
  url text,
  secret_enc text,
  status text not null default 'off',
  tool_count int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create table if not exists agent_prefs (
  workspace_id int not null references workspaces(id) on delete cascade,
  agent text not null,
  enabled boolean not null default true,
  trust int not null default 0,
  primary key (workspace_id, agent)
);
create table if not exists knowledge (
  id serial primary key,
  title text not null,
  body text not null default '',
  scope text not null default 'company',
  agent text,
  created_by int references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists threads (
  id serial primary key,
  title text not null,
  user_id int references users(id) on delete set null,
  routine_id int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists messages (
  id serial primary key,
  thread_id int not null references threads(id) on delete cascade,
  role text not null,
  agent text,
  content text not null default '',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists messages_thread on messages(thread_id, id);
create table if not exists approvals (
  id serial primary key,
  thread_id int references threads(id) on delete set null,
  agent text not null,
  server text not null,
  tool text not null,
  input jsonb not null default '{}',
  title text not null default '',
  why text not null default '',
  status text not null default 'pending',
  result text,
  decided_by int references users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create table if not exists activity (
  id serial primary key,
  agent text,
  text text not null,
  thread_id int,
  created_at timestamptz not null default now()
);
create table if not exists usage (
  id serial primary key,
  agent text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read int not null default 0,
  cache_write int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists routines (
  id serial primary key,
  agent text not null,
  title text not null,
  instruction text not null,
  days int[] not null default '{1,2,3,4,5}',
  at_time text not null default '08:00',
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists submissions (
  id serial primary key,
  source text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists plans (
  key text primary key,
  name text not null,
  price_label text not null default '',
  stripe_price_id text,
  ai_budget_usd numeric not null default 10,
  sort int not null default 0,
  active boolean not null default true
);
`;
const SCOPED = ["knowledge", "threads", "approvals", "activity", "usage", "routines", "submissions"];

export async function migrate() {
  for (let i = 0; ; i++) {
    try { await pool.query(SCHEMA); break; }
    catch (e) {
      if (i >= 29) throw e;
      console.log("waiting for database…", e.code || e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  for (const t of SCOPED) {
    await q(`alter table ${t} add column if not exists workspace_id int references workspaces(id) on delete cascade`);
    await q(`create index if not exists ${t}_ws on ${t}(workspace_id)`);
  }
  // Move users from the single-business version into a workspace.
  const orphans = await one("select count(*)::int n from users where workspace_id is null");
  if (orphans.n) {
    const name = (await one("select value from settings where key='business_name'"))?.value || "Morning Telos";
    const tz = (await one("select value from settings where key='timezone'"))?.value || "America/Chicago";
    const ws = await one("insert into workspaces(name,timezone,plan,status,trial_ends_at) values($1,$2,'internal','active',now()+interval '100 years') returning id", [name, tz]);
    await q("update users set workspace_id=$1 where workspace_id is null", [ws.id]);
    await q("update users set is_admin=true where role='owner' and workspace_id=$1", [ws.id]);
    for (const t of SCOPED) await q(`update ${t} set workspace_id=$1 where workspace_id is null`, [ws.id]);
    const old = await one("select to_regclass('agent_settings') t");
    if (old.t) await q("insert into agent_prefs(workspace_id,agent,enabled,trust) select $1, agent, enabled, trust from agent_settings on conflict do nothing", [ws.id]);
    console.log("migrated existing users into workspace", ws.id);
  }
  await q(`insert into plans(key,name,price_label,ai_budget_usd,sort) values
    ('trial','Free trial','14 days free',10,0),
    ('starter','Starter','',50,1),
    ('pro','Pro','',200,2)
    on conflict(key) do nothing`);
}

export async function getSetting(key, fallback = null) {
  const r = await one("select value from settings where key=$1", [key]);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  await q("insert into settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [key, value]);
}
export async function log(ws, agent, text, threadId = null) {
  await q("insert into activity(workspace_id,agent,text,thread_id) values($1,$2,$3,$4)", [ws, agent, text, threadId]);
}
