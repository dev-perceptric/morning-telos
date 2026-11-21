# The Morning Telos web app (chat.morningtelos.com): build Next.js, then serve it.
# Copied from Arrowsterr's Dockerfile. The build context is web/.
# At runtime it needs the build (.next), public/, next.config.ts and the packages, plus supabase/ and scripts/migrate.mjs,
# which deploy/deploy-web.sh runs in this image before the app restarts. Nothing reads files from src/ or tests/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The browser reads Sentry and PostHog keys at build time. The workflow passes them from repo variables. Empty means off.
# The build needs no Sentry auth token: next.config.ts doesn't upload source maps.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
# next.config.ts uses it as the deploymentId (version skew protection). The workflow passes the commit.
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build && mkdir -p public
# The workflow copies deploy/deploy-web.sh into the build, so the server can take the newest one from this image:
#   docker run --rm --entrypoint cat ghcr.io/dev-perceptric/morningtelos-web:latest deploy-web.sh > deploy-web.sh
# A local build has none; it gets a stub that refuses to run.
RUN [ -f deploy-web.sh ] || printf '#!/usr/bin/env bash\necho "This image was built without deploy-web.sh." >&2\nexit 1\n' > deploy-web.sh

FROM node:22-bookworm-slim
ARG GIT_COMMIT=""
# The server reads next.config.ts again on start, so it needs the same GIT_COMMIT as the build.
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1 GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
RUN useradd --create-home web
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf /root/.npm
# The app writes only to .next (its image cache), so only .next belongs to the web user.
# This skips a chown of node_modules, which would copy it into a second layer and double the image.
COPY --from=build --chown=web /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/supabase ./supabase
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/deploy-web.sh ./deploy-web.sh
USER web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
