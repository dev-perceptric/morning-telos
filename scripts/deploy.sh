#!/usr/bin/env bash
# Deploys the site to the Hostinger VPS as the "morningtelos" Docker project.
# The container downloads site/ from the main branch on GitHub each time it
# starts, so push your changes first.
# Traefik (already on the VPS) routes morningtelos.com and handles SSL.
# Usage: HOSTINGER_API_TOKEN=... scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VM_ID="${VM_ID:-2139771}"
TOKEN="${HOSTINGER_API_TOKEN:-dummy}"
API="https://developers.hostinger.com/api/vps/v1/virtual-machines/$VM_ID"
auth=(-H "Authorization: Bearer $TOKEN")

wait_for() {
  for _ in $(seq 1 100); do
    state=$(curl -sS "$API/actions/$1" "${auth[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["state"])')
    case "$state" in success) return 0;; error) echo "action $1 failed"; return 1;; esac
    sleep 3
  done
  echo "action $1 timed out"; return 1
}

sha=$(git rev-parse HEAD)
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$sha" ] || { echo "Push your commits to main first"; exit 1; }
# Pin the download to this exact commit so GitHub's cache can't serve an older copy.
# Keep the app's secrets (stored on the server, never in git). Create them on the first deploy.
current_env=$(curl -sS "$API/docker/morningtelos" "${auth[@]}" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("environment") or "")
except Exception: print("")')
body=$(SHA="$sha" ENVIN="$current_env" SET_ENV="${SET_ENV:-}" python3 -c '
import json, os, secrets
env = {}
for line in os.environ["ENVIN"].splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
for k in ("APP_SECRET", "DB_PASSWORD"):
    env.setdefault(k, secrets.token_urlsafe(32))
# Extra settings for this deploy: SET_ENV="KEY=value;KEY2=value" (kept on the server, never in git).
for pair in os.environ.get("SET_ENV", "").split(";"):
    if "=" in pair:
        k, v = pair.split("=", 1); env[k.strip()] = v.strip()
c = open(os.environ.get("COMPOSE", "docker-compose.yml")).read().replace("refs/heads/main", os.environ["SHA"])
print(json.dumps({"project_name": "morningtelos", "content": c, "environment": "\n".join(f"{k}={v}" for k, v in env.items())}))')

# Take down the old project if it exists, then create it fresh.
# (Recreating pulls the latest site from GitHub and makes Traefik retry the SSL certificate.)
if curl -sS "$API/docker/morningtelos" "${auth[@]}" | grep -q '"content":"services'; then
  id=$(curl -sS -X DELETE "$API/docker/morningtelos/down" "${auth[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  wait_for "$id"
fi
# Retry the create step, since the old project is already down at this point.
for try in 1 2 3 4 5 6; do
  r=$(curl -sS -X POST "$API/docker" "${auth[@]}" -H "Content-Type: application/json" -d "$body")
  if id=$(echo "$r" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null); then
    wait_for "$id" && { echo "deployed"; exit 0; }
  else
    echo "create failed (try $try): $(echo "$r" | head -c 200)"
  fi
  sleep $((try * 15))
done
exit 1
