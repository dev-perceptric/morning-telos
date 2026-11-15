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

body=$(python3 -c 'import json; print(json.dumps({"project_name":"morningtelos","content":open("docker-compose.yml").read()}))')

# Take down the old project if it exists, then create it fresh.
# (Recreating pulls the latest site from GitHub and makes Traefik retry the SSL certificate.)
if curl -sS "$API/docker/morningtelos" "${auth[@]}" | grep -q '"content":"services'; then
  id=$(curl -sS -X DELETE "$API/docker/morningtelos/down" "${auth[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  wait_for "$id"
fi
r=$(curl -sS -X POST "$API/docker" "${auth[@]}" -H "Content-Type: application/json" -d "$body")
id=$(echo "$r" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])') || { echo "$r"; exit 1; }
wait_for "$id" && echo "deployed"
