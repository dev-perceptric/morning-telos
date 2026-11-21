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
# The database is found here, with no setup: the Supabase Postgres container (image supabase/postgres) on the app's
# own Docker networks or on the Supabase stack's network (sb-morningtelos, or MIGRATE_DB_NETWORK in .env), with the
# password that container was started with. The update runs on that network, as Supabase's admin role (or
# MIGRATE_DB_USER). MIGRATE_DATABASE_URL in .env overrides all of it. The password goes to the update only, and is
# never printed.
DB_NETWORK=${MIGRATE_DB_NETWORK:-sb-morningtelos}
find_db() {
  local app nets net c found=""
  app=$("${COMPOSE[@]}" ps -q "$SERVICE" 2>/dev/null | head -n 1)
  nets="$DB_NETWORK"
  [ -n "$app" ] && nets="$nets $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$app")"
  for net in $nets; do
    docker network inspect "$net" >/dev/null 2>&1 || continue
    for c in $(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$net"); do
      case "$(docker inspect -f '{{.Config.Image}}' "$c")" in
        supabase/postgres:*) case " $found " in *" $c@"*) ;; *) found="$found${found:+ }$c@$net" ;; esac ;;
      esac
    done
  done
  echo "$found"
}

if [ -z "$SERVICE" ]; then
  echo "deploy: no service in $FILE uses the morningtelos-web image. Not restarting the app." >&2
  exit 1
fi
# The app's image, as the compose file names it, to run the update with.
IMAGE=$(awk -v svc="$SERVICE" '/^  [A-Za-z0-9_.-]+:[[:space:]]*$/{cur=$1; sub(":","",cur)} cur==svc && /^    image:/{print $2; exit}' "$FILE")
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  echo "deploy: updating the database"
  "${COMPOSE[@]}" run --rm --no-deps -e MIGRATE_DATABASE_URL "$SERVICE" node scripts/migrate.mjs
else
  DB=$(find_db)
  if [ -n "$DB" ] && [ "${DB// /}" = "$DB" ] && [ -n "$IMAGE" ]; then
    PGHOST=${DB%@*} PGPORT=5432 PGDATABASE=postgres
    PGPASSWORD=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PGHOST" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -n 1)
    export PGHOST PGPORT PGDATABASE PGPASSWORD
    if [ -n "$PGPASSWORD" ]; then
      echo "deploy: updating the database"
      migrate() { docker run --rm --network "${DB#*@}" -e PGHOST -e PGPORT -e PGDATABASE -e PGPASSWORD -e PGUSER="$1" "$IMAGE" node scripts/migrate.mjs; }
      # Supabase's admin role first; an older stack's postgres role if that sign-in is refused.
      migrate "${MIGRATE_DB_USER:-supabase_admin}" || { [ -z "${MIGRATE_DB_USER:-}" ] && migrate postgres; }
    else
      echo "deploy: found $PGHOST but not its password. Skipping database updates." >&2
    fi
  else
    echo "deploy: couldn't find the app's database (no single supabase/postgres container on its network or on $DB_NETWORK). Skipping database updates. Set MIGRATE_DATABASE_URL in .env to point at it." >&2
  fi
fi
echo "deploy: restarting what changed"
"${COMPOSE[@]}" up -d
# Old images pile up with every build. Remove the ones nothing uses.
docker image prune -f >/dev/null
echo "deploy: done"
