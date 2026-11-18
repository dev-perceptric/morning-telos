# Morning Telos

Morning Telos sells an AI team to small businesses. Each customer gets a workspace with AI employees (named after Greek gods) they chat with, tag with @, and approve work from.

**The plan is the source of truth:** the "Morning Telos SaaS Plan" doc (https://claude.ai/artifact/5BnjVisY2z2vwxrCEYfyNm). Read it before planning or building. Work only on the current phase. If an issue conflicts with the plan, the plan wins: comment on the issue and label it `agent-blocked`.

## Layout

- `web/`: **the app**, live at chat.morningtelos.com. Next 16, React 19, Tailwind 4, TypeScript, Supabase (`db.morningtelos.com`), Stripe, Resend, Sentry, PostHog. One client app at `src/app/[[...slug]]`.
  - `web/supabase/`: `schema.sql` plus numbered migrations (`001_*.sql`, `002_*.sql`, ...). Every customer table has `workspace_id` and RLS through `has_role(workspace_id, '<role>')`. Server-only tables have RLS on and no policies.
  - `web/tests/*.test.ts`: `node --test`.
- `app/`: **the old app**, replaced by `web/` at launch. It still runs on the server with its own data but has no public address. Plain Node. Don't change it.
- `site/`: the marketing site (static HTML), built by `scripts/` from `content/`.
- `docker-compose.yml`, `scripts/deploy.sh`: production for the old app and the site. Containers pull `main` from GitHub when they start, so anything merged to `main` under `app/` or `site/` goes live on the next restart.

## Copy before you write

The plan's "What we copy from Arrowsterr and Omniscient" table says where each piece comes from. Read the source first and lift it, then trim what Morning Telos doesn't need.

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/perceptric/arrowsterr /home/user/perceptric/arrowsterr
```

Omniscient (`perceptric/omniscient`) is private: attach it with the `add_repo` tool (read access) before cloning. Match their file layout, lint config, CI and naming so the three products stay alike.

## Checks (run before every commit)

```bash
cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build
cd app && npm ci && npm run verify   # only if you touched app/
```

`web/tests/rls.test.ts` loads `web/supabase/*.sql` into a throwaway database (through `TEST_DATABASE_URL`, default `postgres://mt:mt@localhost:5432/mt`) with a test-only Supabase stand-in (`web/tests/sql/supabase-shim.sql`), then signs in as different users to check RLS. The `mt` role must be a superuser so it can create the API roles. It skips if no database answers, so start Postgres first.

Add tests for every pure function, route handler and SQL policy you write. New tables get an RLS test in `rls.test.ts`. CI runs the same checks on every pull request.

## Rules

- Never read, print or use `DATABASE_URL` or any other real credential from the environment. Tests use `TEST_DATABASE_URL` or mocks only. Never call real Stripe, Supabase, Resend or Anthropic from tests.
- Never commit keys. Keys live in the server's environment. Add each new one to `web/.env.example` with an empty value and a comment saying where it comes from.
- One customer must never see another's data: RLS on every table, and server code checks the workspace too.
- Agent tools that change something outside the app go through approvals. No send, publish or delete without the owner's OK, unless the agent's trust level is autopilot.
- User-facing text: plain English, 9th grade level, short sentences, no em dashes.
- If you'd write a comment telling the next agent "don't do X", write a lint rule or a test that fails on X instead.
- Do not write new markdown files (notes, plans, summaries) unless the issue asks for one.
- Do not edit `docker-compose.yml`, `scripts/deploy.sh` or anything under `.github/` unless the issue is about deploys or CI.

## How agents work here

Issues labeled `agent-ready` are the queue. Each issue has a phase label (`phase-1`, ...) and a "Done when" list.

- **Builder:** one issue per branch `agent/<n>-<short-name>`. Open a PR into `main` that says `Closes #<n>`, what changed and how you tested it. Swap the label to `agent-done`. Never merge, never push to `main`.
- **Blocked:** if an issue needs a key, a human decision or another unmerged issue, comment saying exactly what's needed, swap the label to `agent-blocked`, and move on.
- **Review fixes:** a PR with review comments from the reviewer agent or a human gets fixed on its own branch before you start new issues.
- Repeated mistakes become a lint rule, a test, or a line in this file.
