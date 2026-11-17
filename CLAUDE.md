# Morning Telos

Morning Telos sells an AI team to small businesses. Each customer gets a workspace with AI employees (named after Greek gods) they chat with, tag with @, and approve work from.

## Layout

- `app/`: the product at chat.morningtelos.com. Plain Node 22 (ES modules), `pg`, `@anthropic-ai/sdk`. No framework, no build step.
  - `server.js`: HTTP server, every API route (`route(...)`), the routines scheduler.
  - `lib/agents.js`: the team (`AGENTS`, `ORDER`), the tool gateway (`SCOPE`) that locks each customer to their own brand, and the agent loop (`runAgent`, `runTurn`).
  - `lib/db.js`: the whole schema and migrations. Migrations must be idempotent (`create table if not exists`, `add column if not exists`). They run on every start.
  - `public/`: the single-page web app (`index.html`, `app.js`, `app.css`). Vanilla JS.
- `site/`: the marketing site (static HTML). Built by the Python scripts in `scripts/` from `content/`.
- `docker-compose.yml`, `scripts/deploy.sh`: production. Containers pull `main` from GitHub when they start.

## Checks (run before every commit)

```bash
cd app && npm ci && npm run verify
```

`npm run check` syntax-checks every file and scans for leaked keys. `npm test` runs the unit tests and a smoke test that boots the server against Postgres and signs up. The smoke test reads `TEST_DATABASE_URL` (default `postgres://mt:mt@localhost:5432/mt`) and skips if no database answers. If Postgres is installed but stopped, start it and create the `mt` user and database so the smoke test really runs.

Add a test for every new route or pure function. CI runs the same checks on every pull request.

## Rules

- Never read, print or use `DATABASE_URL` or any other real credential from the environment. Tests use `TEST_DATABASE_URL` only.
- Never commit keys. Platform keys live only in the server's environment (`lib/platform.js`).
- Every query on customer data must filter by `workspace_id`. One customer must never see another's data.
- Tools that change something outside the app go through the approvals flow in `runAgent`. Never let an agent send, publish or delete without owner approval unless the agent's trust level is autopilot.
- New tool access for agents must go through `SCOPE` in `lib/agents.js` so calls stay locked to the customer's brand.
- User-facing text: plain English, 9th grade level, short sentences, no em dashes.
- Keep the code style: small, dense, no new dependencies unless clearly needed. No TypeScript, no bundler.
- Do not write new markdown files (notes, plans, summaries) unless the task asks for one.
- Do not edit `docker-compose.yml` or `scripts/deploy.sh` unless the task is about deploys.

## Overnight agent work

Tasks live in GitHub issues labeled `agent-ready`. Work one issue per branch (`agent/<issue-number>-<short-name>`), open a pull request that says `Closes #<n>`, and stop. Never merge, never push to `main`. When done, swap the issue's label to `agent-done`. If an issue is unclear or blocked (needs a key, a design choice, or a big refactor), comment on the issue explaining why, swap its label to `agent-blocked`, and move on.
