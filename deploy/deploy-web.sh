#!/usr/bin/env bash
# Runs on the OVH server, from the app's folder (/docker/morningtelos-web). Pulls the newest images and restarts the
# containers whose image changed. Docker leaves the rest running.
# It also refreshes the website (morningtelos.com), so a push to main that changes site/ goes live too.
# GitHub Actions calls it over SSH on every push to main (.github/workflows/build-images.yml, job "deploy"), as
# "deploy-web.sh <commit>". By hand: ./deploy-web.sh, or ./deploy-web.sh <commit> to put the site on that commit.
#
# Setup, once, on the server:
#   1. Keep this file next to the app's compose file (docker-compose.yml, or web-compose.yml from this repo), with the
#      app's keys in a .env file in the same folder.
#   2. chmod +x deploy-web.sh
#   3. In the deploy user's ~/.ssh/authorized_keys, lock the CI key to this script and nothing else:
#        command="/path/to/deploy-web.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-deploy
set -euo pipefail

SELF=$(readlink -f "$0")
# A newer copy of this script, run from a temp file (below), works in the app's folder all the same.
cd "${DEPLOY_DIR:-$(dirname "$SELF")}"
[ -n "${DEPLOY_TMP:-}" ] && trap 'rm -f "$DEPLOY_TMP"' EXIT
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

if [ -z "$SERVICE" ]; then
  echo "deploy: no service in $FILE uses the morningtelos-web image. Not restarting the app." >&2
  exit 1
fi
# The app's image, as the compose file names it, to run the update with.
IMAGE=$(awk -v svc="$SERVICE" '/^  [A-Za-z0-9_.-]+:[[:space:]]*$/{cur=$1; sub(":","",cur)} cur==svc && /^    image:/{print $2; exit}' "$FILE")

# Pulled already when an older copy of this script handed over to this one.
if [ -z "${DEPLOY_TMP:-}" ]; then
  echo "deploy: pulling images"
  "${COMPOSE[@]}" pull
fi

# This script keeps itself current: every new image carries the newest copy (deploy-web.sh). If it differs from this
# one, run that one instead, so a change to the deploy needs nothing done on the server. The copy on disk is replaced
# too when this user may write it.
if [ -z "${DEPLOY_TMP:-}" ] && [ -n "$IMAGE" ]; then
  NEW=$(mktemp)
  if docker run --rm --entrypoint cat "$IMAGE" deploy-web.sh > "$NEW" 2>/dev/null && head -n 1 "$NEW" | grep -q '^#!' && ! cmp -s "$NEW" "$SELF"; then
    cp "$NEW" "$SELF" 2>/dev/null || true
    echo "deploy: running the newest deploy script"
    DEPLOY_TMP="$NEW" DEPLOY_DIR="$PWD" exec bash "$NEW" "$@"
  fi
  rm -f "$NEW"
fi

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

# The website: the nginx container that serves morningtelos.com, in its own compose project (docker-compose.yml from
# this repo). It downloads site/ from GitHub each time it starts, so a fresh container serves the newest site. Its
# download is set to ${SITE_REF:-refs/heads/main}: this deploy passes the exact commit, so GitHub's cache can't
# hand back an older copy, and a plain restart takes main. An older copy pinned to one commit is switched over here.
# The commit comes from GitHub Actions (ssh ... deploy-web.sh <commit>), or from the first argument by hand.
SITE_REF=""
for word in ${SSH_ORIGINAL_COMMAND:-} "$@"; do
  [[ "$word" =~ ^[0-9a-f]{40}$ ]] && SITE_REF=$word
done
SITE_FAILED=""
refresh_site() {
  local c dir project files file args=()
  c=$(docker ps -aq --filter "label=traefik.http.routers.morningtelos.rule" | head -n 1)
  if [ -z "$c" ]; then
    echo "deploy: no website container (Traefik router morningtelos) on this server." >&2
    return 1
  fi
  dir=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c")
  project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")
  files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$c")
  IFS=, read -r -a list <<< "$files"
  for file in "${list[@]}"; do
    [ -f "$file" ] || continue
    args+=(-f "$file")
    if ! grep -qF 'tar.gz/${SITE_REF' "$file" && grep -Eq 'tar\.gz/(refs/heads/main|[0-9a-f]{40})' "$file"; then
      if sed -i -E 's#tar\.gz/(refs/heads/main|[0-9a-f]{40})#tar.gz/${SITE_REF:-refs/heads/main}#g' "$file"; then
        echo "deploy: $file now downloads the commit each deploy asks for"
      else
        echo "deploy: can't write $file. The website will download main." >&2
      fi
    fi
  done
  if [ -n "$project" ] && [ -n "$dir" ] && [ "${#args[@]}" -gt 0 ]; then
    (cd "$dir" && SITE_REF="$SITE_REF" docker compose -p "$project" "${args[@]}" up -d --no-deps --force-recreate web)
  else
    echo "deploy: the website's compose file isn't on this server. Restarting the container as it is." >&2
    docker restart "$c" >/dev/null
  fi
}
echo "deploy: refreshing the website${SITE_REF:+ to $SITE_REF}"
refresh_site || SITE_FAILED=1

# Old images pile up with every build. Remove the ones nothing uses.
docker image prune -f >/dev/null
if [ -n "$SITE_FAILED" ]; then
  echo "deploy: the app is updated, but the website wasn't." >&2
  exit 1
fi
echo "deploy: done"
