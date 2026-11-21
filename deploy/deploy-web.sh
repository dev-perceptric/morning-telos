#!/usr/bin/env bash
# Runs on the OVH server. Pulls the newest app image and restarts only the app (and the backup job's image).
# GitHub Actions calls it over SSH after every image build (.github/workflows/build-images.yml, job "deploy").
#
# Setup, once, on the server:
#   1. Keep this file next to web-compose.yml, with the app's keys in a .env file in the same folder.
#   2. chmod +x deploy-web.sh
#   3. In the deploy user's ~/.ssh/authorized_keys, lock the CI key to this script and nothing else:
#        command="/path/to/deploy-web.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-deploy
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
COMPOSE=(docker compose -f web-compose.yml)

# The app reads its keys from .env. Without them the restarted app would come up with every key empty, so stop here.
if [ ! -f .env ]; then
  echo "deploy: no .env next to web-compose.yml. Put the app's keys there first." >&2
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
"${COMPOSE[@]}" pull web-new backup
echo "deploy: restarting the app"
"${COMPOSE[@]}" up -d --no-deps web-new
"${COMPOSE[@]}" up -d --no-deps backup
# Old images pile up with every build. Remove the ones nothing uses.
docker image prune -f >/dev/null
echo "deploy: done"
