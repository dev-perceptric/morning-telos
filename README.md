# Morning Telos

Site for [morningtelos.com](https://morningtelos.com).

- `site/`: the page and its images
- `docker-compose.yml`: an nginx container on the Hostinger VPS that downloads `site/` from `main` on GitHub when it starts; Traefik handles routing and SSL
- `scripts/deploy.sh`: rebuilds and redeploys on the VPS

To update: edit `site/`, push to `main`, then run `scripts/deploy.sh`.
