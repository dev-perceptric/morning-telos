# Morning Telos

Site for [morningtelos.com](https://morningtelos.com).

- `site/`: the pages, images (`site/img`) and shared CSS/JS (`site/assets`)
- `docker-compose.yml`: an nginx container on the server that downloads `site/` from `main` on GitHub when it starts; Traefik handles routing and SSL
- `deploy/web-compose.yml`: the app at chat.morningtelos.com. Every push to `main` that touches `web/` builds a new image and deploys it to the OVH server (`.github/workflows/build-images.yml`, `deploy/deploy-web.sh`)
- `scripts/deploy.sh`: starts a deploy by hand. Deploys also run on their own on every push to `main`

To update: edit `site/`, then merge to `main`. GitHub Actions deploys it to the OVH server and fails if morningtelos.com doesn't show the new pages.
