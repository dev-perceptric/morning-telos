#!/usr/bin/env bash
# Runs on the OVH server, from the app's folder (/docker/morningtelos-web). Pulls the newest images and restarts the
# containers whose image changed. Docker leaves the rest running.
# GitHub Actions calls it over SSH after every image build (.github/workflows/build-images.yml, job "deploy").
#
# Setup, once, on the server:
#   1. Keep this file next to the app's compose file (docker-compose.yml, or web-compose.yml from this repo), with the
#      app's keys in a .env file in the same folder.
#   2. chmod +x deploy-web.sh
#   3. In the deploy user's ~/.ssh/authorized_keys, lock the CI key to this script and nothing else:
#        command="/path/to/deploy-web.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-deploy
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
if [ -f docker-compose.yml ]; then FILE=docker-compose.yml; else FILE=web-compose.yml; fi
COMPOSE=(docker compose -f "$FILE")
# The app's service in the compose file: the first one that uses the morningtelos-web image.
SERVICE=$(awk '/^  [A-Za-z0-9_.-]+:[[:space:]]*$/{svc=$1; sub(":","",svc)} /^    image:.*morningtelos-web/{print svc; exit}' "$FILE")

# The app reads its keys from .env. Without them the restarted app would come up with every key empty, so stop here.
if [ ! -f .env ]; then
  echo "deploy: no .env next to $FILE. Put the app's keys there first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
if [ -z "${SUPABASE_URL:-}" ]; then
  echo "deploy: SUPABASE_URL is empty in .env. Not restarting the app." >&2
  exit 1
fi

echo "deploy: pulling images"
"${COMPOSE[@]}" pull

# New tables first, then the code that reads them. The new image runs scripts/migrate.mjs, which runs only the SQL
# files this database hasn't had yet. If one fails, stop here: the old app keeps running on the old tables.
# The database is found here, with no setup: the Supabase Postgres container (image supabase/postgres) on the same
# Docker network as the running app, with the password that container was started with. MIGRATE_DATABASE_URL in
# .env overrides it. The password goes to the migrate container only, and is never printed.
find_db() {
  local app net c found=""
  app=$("${COMPOSE[@]}" ps -q "$SERVICE" 2>/dev/null | head -n 1)
  [ -n "$app" ] || return 0
  for net in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$app"); do
    for c in $(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$net"); do
      case "$(docker inspect -f '{{.Config.Image}}' "$c")" in
        supabase/postgres*) [ "$found" = "$c" ] || found="$found${found:+ }$c" ;;
      esac
    done
  done
  echo "$found"
}

if [ -z "$SERVICE" ]; then
  echo "deploy: no service in $FILE uses the morningtelos-web image. Not restarting the app." >&2
  exit 1
fi
MIGRATE_ENV=()
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  MIGRATE_ENV=(-e MIGRATE_DATABASE_URL)
else
  DB=$(find_db)
  if [ -n "$DB" ] && [ "${DB// /}" = "$DB" ]; then
    PGHOST=$DB PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
    PGPASSWORD=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -n 1)
    export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD
    [ -n "$PGPASSWORD" ] && MIGRATE_ENV=(-e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGPASSWORD)
  fi
fi
if [ ${#MIGRATE_ENV[@]} -gt 0 ]; then
  echo "deploy: updating the database"
  "${COMPOSE[@]}" run --rm --no-deps "${MIGRATE_ENV[@]}" "$SERVICE" node scripts/migrate.mjs
else
  echo "deploy: couldn't find the app's database (no single supabase/postgres container on its network). Skipping database updates. Set MIGRATE_DATABASE_URL in .env to point at it." >&2
fi
echo "deploy: restarting what changed"
"${COMPOSE[@]}" up -d
# Old images pile up with every build. Remove the ones nothing uses.
docker image prune -f >/dev/null
echo "deploy: done"
