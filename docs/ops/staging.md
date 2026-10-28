# Staging (staging.shipkudos.com)

Staging tracks the `development` branch. It follows the same pull-based deploy as production ([helios.md](helios.md)) with its own checkout, env file, database, GitHub OAuth app, Compose project, and image channel. Production keeps publishing and deploying the commit SHA from `main`.

## Image tags

A push to `development` runs `.github/workflows/staging.yml` (concurrency group `staging-release`). That workflow calls `.github/workflows/heavy.yml` with `publish: true` and `channel: development`.

Published tags:

- `ghcr.io/navarrillo/shipkudos.com:development`
- `ghcr.io/navarrillo/shipkudos.com:development-<40-character sha>`

`:development-<sha>` is immutable. A rerun reuses it when the image revision label matches the commit. `:development` moves only when that commit is still the tip of `origin/development`. The workflow does not push `latest`, `main`, version tags, or the bare commit SHA.

`bin/deploy <sha>` pulls `IMAGE_REPO:<sha>` when `IMAGE_CHANNEL` is unset (production). Staging sets `IMAGE_CHANNEL` so the pull is `IMAGE_REPO:development-<sha>`.

## Required environment variable names

Set these on the staging host only. Keep values in the staging env file (mode 600). This list is names only.

- APP_ENV
- APP_URL
- APP_NAME
- PORT
- IMAGE_REPO
- IMAGE_CHANNEL
- COMPOSE_PROJECT_NAME
- STATE_DIR
- UPLOADS_DIR
- BACKUP_DIR
- POSTGRES_USER
- POSTGRES_DB
- POSTGRES_PASSWORD
- DATABASE_URL
- BETTER_AUTH_SECRET
- TOKEN_ENCRYPTION_KEY
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- GITHUB_WEBHOOK_SECRET
- ADMIN_GITHUB_IDS

`bin/deploy` sets `APP_SHA` and `APP_IMAGE` for the process it starts. `APP_URL` is the runtime canonical origin (canonicals, `og:url`, share links, sitemaps, auth callbacks, agent URLs). The image is shared with production, so that origin is read when the process starts. Application source does not hard-code the production site origin. Unset `APP_ENV` is production.

`APP_ENV` for this host is `staging`. `APP_URL` is the staging origin (`https://staging.shipkudos.com`). `IMAGE_CHANNEL` is `development`. `COMPOSE_PROJECT_NAME` and `PORT` are distinct from production so the containers, volume, and loopback port stay separate.

Optional names:

- UMAMI_STAGING_WEBSITE_ID
- UMAMI_SCRIPT_URL
- STAGING_OUTBOUND
- WORKER_HEARTBEAT_SECONDS
- QUEUE_STALL_SECONDS
- DEPLOY_READY_TIMEOUT
- LOCK_TIMEOUT

Staging reads `UMAMI_STAGING_WEBSITE_ID` for analytics. With that name unset, the Umami script is omitted. `UMAMI_SCRIPT_URL` overrides the script URL when a website id is set (HTTPS). GitHub contribution sync and the X share composer run on staging. `STAGING_OUTBOUND` enables ad clicks that leave the site. While it is unset, those redirects stay on the staging origin. Sign-in reads the GitHub user API for this OAuth app.

## Separate database

Use a staging-only Postgres volume, user, database name, and `DATABASE_URL`. `bin/deploy` migrates that database. Production data stays on the production volume.

## Separate GitHub OAuth app

Create a GitHub App for staging. Put its client id, client secret, and webhook secret only in the staging env file. Homepage, authorization callback (`APP_URL/api/auth/callback/github`), and webhook (`APP_URL/api/github/webhook`) use the staging origin. Staging sync and token refresh use this app, so they do not rotate production tokens.

## Caddy basic auth

TLS for `staging.shipkudos.com` terminates in Caddy. Put HTTP basic auth on that site, then reverse-proxy to the staging loopback port. The application does not check basic auth. Generate the password hash on the server and keep it in the Caddy site file, not in git.

```
staging.shipkudos.com {
  basic_auth {
    # server-local htpasswd hash
  }
  reverse_proxy 127.0.0.1:<staging port>
}
```

DNS: an A record for `staging` on the `shipkudos.com` zone, DNS only, in addition to the production apex and `www` records.

## Deploy cron

Use a separate directory, for example `~/apps/shipkudos-staging`, with its own `repo/`, `config/.env`, `state/`, `uploads/`, `backups/`, and `auto-deploy/` (including its own `auto-deploy.FAILED`).

- Cron every 10 minutes, offset from production. Production uses minutes 4,14,…,54. Staging uses 9,19,…,49.
- Watch `origin/development`.
- Deploy when `ghcr.io/navarrillo/shipkudos.com:development-<sha>` is anonymously pullable.
- Run `ENV_FILE=… bin/deploy <sha> </dev/null`. Same lock, one migration, recreate web and worker, wait until `/readyz` reports that SHA for both web and worker, and restore the previous image if readiness fails.
- Skip 03:00–03:59 when that hour is reserved for backups.
- After deploy, check through Caddy that `/readyz` and `/` return 200.
- A manual SHA older than `origin/development` is replaced on the next cron run unless that cron line is held.

## Runtime when APP_ENV is staging

- `/robots.txt` allows nothing: `Disallow: /` for every user agent, and it omits the sitemap.
- Responses include `X-Robots-Tag: noindex, nofollow`.
- HTML includes a `noindex, nofollow` robots meta tag.
- A one-line Staging banner shows the host from `APP_URL`.
- The Umami script is off unless `UMAMI_STAGING_WEBSITE_ID` is set.
- GitHub sync and profile share to X stay on. Share links use the staging `APP_URL`.
- Ad clicks stay on the staging origin unless `STAGING_OUTBOUND` is enabled.

With `APP_ENV` unset or `production`, robots rules, response headers, the banner, and outbound calls stay as they are on production. The Umami script loads only when `UMAMI_WEBSITE_ID` is set.
