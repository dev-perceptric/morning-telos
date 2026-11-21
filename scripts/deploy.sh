#!/usr/bin/env bash
# Deploys are automatic: every push to main that changes web/, site/ or deploy/ runs the "Build images" workflow,
# which deploys to the OVH server and checks that chat.morningtelos.com and morningtelos.com serve the new commit
# (.github/workflows/build-images.yml, deploy/deploy-web.sh).
# This script starts that same deploy by hand, for main as it is now, and waits for it to finish.
# Usage: scripts/deploy.sh   (needs the GitHub CLI, signed in)
set -euo pipefail
cd "$(dirname "$0")/.."
gh workflow run build-images.yml --ref main
sleep 5
id=$(gh run list --workflow build-images.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$id" --exit-status
