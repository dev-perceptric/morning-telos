# Morning Telos

Site for [morningtelos.com](https://morningtelos.com).

- `site/`: the page and its images
- `Dockerfile`: serves `site/` with nginx
- `docker-compose.yml`: the Hostinger VPS builds this straight from `main` on GitHub; Traefik handles routing and SSL
- `scripts/deploy.sh`: rebuilds and redeploys on the VPS

To update: edit `site/`, push to `main`, then run `scripts/deploy.sh`.
