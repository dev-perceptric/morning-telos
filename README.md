# Morning Telos

Site for [morningtelos.com](https://morningtelos.com).

- `site/`: the pages, images (`site/img`) and shared CSS/JS (`site/assets`)
- `docker-compose.yml`: an nginx container on the server that downloads `site/` from `main` on GitHub when it starts; Traefik handles routing and SSL
- `deploy/web-compose.yml`: the app at chat.morningtelos.com. Every push to `main` that touches `web/` builds a new image and deploys it to the OVH server (`.github/workflows/build-images.yml`, `deploy/deploy-web.sh`)
- `scripts/deploy.sh`: rebuilds and redeploys on the VPS

To update: edit `site/`, push to `main`, then run `scripts/deploy.sh`.
