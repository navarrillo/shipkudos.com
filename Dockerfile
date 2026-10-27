FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS runtime
ARG APP_SHA=development
LABEL org.opencontainers.image.source="https://github.com/navarrillo/shipkudos.com"
LABEL org.opencontainers.image.revision=$APP_SHA
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_SHA=$APP_SHA HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app && mkdir -p /app/.next/cache /app/uploads && chown -R app:app /app
COPY --from=production-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/migrations ./migrations
COPY --from=build --chown=app:app /app/tsconfig.json ./tsconfig.json
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
