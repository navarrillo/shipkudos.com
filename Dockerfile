FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
ARG APP_SHA=development
LABEL org.opencontainers.image.source="https://github.com/navarrillo/shipkudos.com"
LABEL org.opencontainers.image.revision=$APP_SHA
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_SHA=$APP_SHA HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app && mkdir -p /app/.next/cache /app/uploads && chown -R app:app /app
COPY --from=build --chown=app:app /app/.next/standalone ./
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
