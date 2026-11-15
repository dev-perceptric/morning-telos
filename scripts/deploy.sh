#!/usr/bin/env bash
# Deploys site/ to the Hostinger VPS as the "morningtelos" Docker project.
# Traefik (already on the VPS) routes morningtelos.com and handles SSL.
# Usage: HOSTINGER_API_TOKEN=... scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VM_ID="${VM_ID:-2139771}"
TOKEN="${HOSTINGER_API_TOKEN:-dummy}"
API="https://developers.hostinger.com/api/vps/v1/virtual-machines/$VM_ID/docker"

compose=$(python3 - <<'PY'
import pathlib, textwrap
html = pathlib.Path("site/index.html").read_text().replace("$", "$$")
body = textwrap.indent(html, " " * 6)
print(f"""services:
  web:
    image: nginx:1.27-alpine
    restart: unless-stopped
    configs:
      - source: index
        target: /usr/share/nginx/html/index.html
    labels:
      - traefik.enable=true
      - traefik.http.routers.morningtelos.rule=Host(`morningtelos.com`) || Host(`www.morningtelos.com`)
      - traefik.http.routers.morningtelos.entrypoints=websecure
      - traefik.http.routers.morningtelos.tls.certresolver=letsencrypt
      - traefik.http.services.morningtelos.loadbalancer.server.port=80

configs:
  index:
    content: |
{body}""")
PY
)
printf '%s\n' "$compose" > docker-compose.yml

if curl -sS "$API/morningtelos" -H "Authorization: Bearer $TOKEN" | grep -q '"content":"services'; then
  method=PUT; url="$API/morningtelos/update"
else
  method=POST; url="$API"
fi
python3 -c 'import json,sys; print(json.dumps({"project_name":"morningtelos","content":open("docker-compose.yml").read()}))' \
  | curl -sS -X "$method" "$url" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @-
echo
