// Postgres connection and schema. The schema is created on start (idempotent).
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://mt:mt@localhost:5432/mt",
  max: 10,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

const SCHEMA = `
create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null default '',
  pass_hash text not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists settings (
  key text primary key,
  value text
);
create table if not exists connections (
  tool text primary key,
  url text,
  secret_enc text,
  status text not null default 'off',
  tool_count int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create table if not exists agent_settings (
  agent text primary key,
  enabled boolean not null default true,
  trust int not null default 0
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
create index if not exists approvals_status on approvals(status, id);
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
`;

export async function migrate() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (e) {
      if (i === 29) throw e;
      console.log("waiting for database…", e.code || e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function getSetting(key, fallback = null) {
  const r = await one("select value from settings where key=$1", [key]);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  await q("insert into settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [key, value]);
}
export async function log(agent, text, threadId = null) {
  await q("insert into activity(agent,text,thread_id) values($1,$2,$3)", [agent, text, threadId]);
}
