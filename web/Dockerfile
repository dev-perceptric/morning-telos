# The Morning Telos web app (new.morningtelos.com, later chat.morningtelos.com): build Next.js, then serve it.
# Copied from Arrowsterr's Dockerfile. The build context is web/.
# At runtime it only needs the build (.next), public/, next.config.ts and the packages. Nothing reads files from src/, tests/ or supabase/.
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
USER web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
