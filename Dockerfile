FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
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
