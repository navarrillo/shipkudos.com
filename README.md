# ShipKudos

A public GitHub activity leaderboard for people building with agents. Open source, free participation, verified GitHub identities, agent-assisted registration and direct sponsorships.

## Stack

Next.js 16 / React / TypeScript, Tailwind CSS and shadcn-style Radix components, PostgreSQL 18, Drizzle, Better Auth with a GitHub App, Octokit and pg-boss. One application image runs the web, worker and one-off migrations. Docker Compose runs three persistent services. No external database, Redis, MCP server or model API is required.

## Local development

Use Node.js 24 and PostgreSQL 18. Install with `npm ci`. Copy `.env.example` to a location **outside the checkout**, fill the local values, and keep it private. Set `APP_URL=http://localhost:3000`, a local PostgreSQL connection URL and `NODE_ENV=development`. Generate `BETTER_AUTH_SECRET` with at least 32 random bytes and `TOKEN_ENCRYPTION_KEY` with 32 random bytes encoded as 64 hex characters. Never reuse test keys in production.

```bash
node --env-file=/absolute/path/local.env --import tsx src/migrate.ts
node --env-file=/absolute/path/local.env --import tsx src/worker.ts
# Separate terminal, same env file:
node --env-file=/absolute/path/local.env node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1
```

`npm run build` creates the production standalone bundle and copies static assets. `npm start` serves it on loopback. The Docker image runs its standalone server on the container interface, while Compose publishes it on **host loopback only**.

Optional development fixtures are explicit and prohibited with `NODE_ENV=production`:

```bash
DEMO_MODE=true node --env-file=/absolute/path/local.env --import tsx src/seed.ts 12
```

Fixture builders are named `fixture-builder-*`. Use a separate database; these are not real GitHub accounts. Pass `10000` instead of `12` to prepare the manual load-test dataset. Production launches must use a clean database without fixture accounts.

## GitHub App

Create separate development and production GitHub Apps:

- Homepage: the configured `APP_URL`.
- Authorization callback: `APP_URL/api/auth/callback/github`.
- Account permission: **Email addresses: read-only**. No repository or organization permissions are requested. Installation on repositories is not required.
- Enable expiring user access tokens. The OAuth provider disables default scopes and requests `offline_access` only.
- Webhook: `APP_URL/api/github/webhook`, with a separate random webhook secret. Authorization revocations stop future calls and revoke delegates.
- Set the App's client ID/client secret in the external `.env`. `ADMIN_GITHUB_IDS` is a comma-separated list of stable numeric GitHub IDs.

GitHub verification means account control, not proof of AI authorship. Tool choices and agent platforms are self-declared.

## Ranking and agents

Activity is the sum of public commit, opened-PR, opened-issue and review contribution counters, aggregated by UTC day. Private/restricted totals, stars, followers and lines changed are excluded. Periods are 7 and 30 days; equal scores share position. Only published accounts with a successful synchronization in the last 48 hours are ranked. Data and streak history cover 60 days.

Social cards are 1200 × 630 PNGs with a five-minute cache bounded to 64 entries / 16 MiB per web process. At most two different cards render simultaneously; duplicate requests share work and excess uncached requests receive `503` with `Retry-After`. Avatar fetching is optional, restricted to GitHub's avatar host and times out after two seconds.

The worker prioritizes initial syncs, refreshes active participants every six hours and others daily, reconciles full history weekly, and rebuilds snapshots every 15 minutes. Manual and agent update requests share a one-hour cooldown per person. A failed or partial response does not erase good data.

Agent instructions: `/agents` and `/agents.md`; discovery: `/llms.txt`; REST specification: `/openapi.json`.

An agent starts a pending registration, receives a private temporary polling credential and an authorization URL, completes GitHub authorization within the user's permissions or hands the URL to the owner. Following approval, it exchanges the temporary credential once for its own 90-day scoped key. Keys are hashed, revocable in the dashboard and limited to profile reading, requesting a sync and retrieving share links. They cannot retrieve OAuth credentials, edit accounts or access advertising administration. The participant remains the person, not the bot.

## Production preparation (one time)

Requirements on the VPS: Docker Engine with Compose v2, Bash, Python 3, `flock`, `curl`, `tar`, enough free disk, and the existing Caddy installation. The application never runs a GitHub self-hosted runner.

1. Prepare `/etc/shipkudos/.env` (mode 600), deployment state, uploads and local backup directories. Make the uploads directory writable by container UID/GID `10001:10001`. The deploy account must be able to use Docker and those directories. Give it only the access appropriate to this application.
2. Set `APP_URL=https://shipkudos.com`, production GitHub credentials and `IMAGE_REPO=ghcr.io/navarrillo/shipkudos.com`. Set a strong PostgreSQL password and the matching URL-encoded `DATABASE_URL` using service hostname `postgres`. The real `.env` stays outside Git and the Docker build context.
3. Add the independent `shipclout.caddy` fragment to the existing Caddy imports, validate, then reload. It forwards to `127.0.0.1:8020`, sets HSTS/nosniff/referrer policy and removes `Server`. If `PORT` changes, change its upstream too. It does not change other domains or enable HSTS for their subdomains.
4. Configure the GitHub App and DNS. No production credentials belong in the repository.
5. Configure the **production** GitHub Actions environment, restricted to `main`, without a required manual approval if unattended deployment is intended:

| Kind | Name | Meaning |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | VPS hostname |
| Variable | `DEPLOY_USER` | Dedicated SSH deploy account |
| Variable | `DEPLOY_PATH` | Absolute release root, e.g. `/opt/shipkudos` |
| Variable | `ENV_FILE` | External config path, e.g. `/etc/shipkudos/.env` |
| Secret | `DEPLOY_SSH_KEY` | Deployment SSH private key |
| Secret | `DEPLOY_KNOWN_HOSTS` | Previously verified SSH host-key entry; not a blind runtime key scan |

SSH transport credentials are the only deployment secrets in Actions. Application/OAuth/database secrets remain exclusively on the VPS. GHCR publication uses the ephemeral `GITHUB_TOKEN`.

### GHCR publicity

The repository is public, but newly created GHCR packages default to private. After first publication, set the package visibility to **public** in GitHub Packages. The workflow checks anonymous access and blocks deployment while it remains private; rerun that failed release after setting visibility. Later releases deploy without manual intervention. The package is linked to this repository through its OCI source label.

Images are addressed by the full 40-character commit SHA. A `vX.Y.Z` Git tag attaches that version to the existing main-branch image. Deploy and rollback never depend on `latest`.

## Automatic release and recovery

Every push to `main` runs verification, builds and publishes the SHA-tagged image, transfers the matching Compose/scripts release and calls `bin/deploy <sha>` over verified SSH. Production deliveries queue serially without cancelling running migrations.

All scripts locate the single external file using `ENV_FILE` and use the same bounded `flock` lock under `STATE_DIR`. Application secrets are not written into release metadata.

```bash
ENV_FILE=/etc/shipkudos/.env bin/deploy FULL_COMMIT_SHA
ENV_FILE=/etc/shipkudos/.env bin/rollback
```

Deploy pulls the SHA tag, resolves its digest, runs **one migration entrypoint**, recreates **web and worker only** and waits for `/readyz` to report both expected revisions. A failed pull/migration leaves the existing app running. A failed new app restores the prior app image and returns failure even when recovery succeeds. First-release failure preserves PostgreSQL and volumes. Rollback never migrates, restores a database or recreates PostgreSQL. Application and pg-boss schema updates are disabled at runtime and happen only in the migration entrypoint.

Schema and startup changes must remain compatible with the previous image. A major database upgrade or destructive migration is not part of routine release rollback.

### Resource budget

Web: 768 MiB / 0.75 CPU; worker: 512 MiB / 0.5 CPU; PostgreSQL: 1,536 MiB / 1 CPU. PostgreSQL starts with `shared_buffers=384MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`, `max_connections=40`. Pools are bounded. All Compose services rotate Docker logs at 10 MB × 3. The database has a dedicated volume and no published host port. Inspect real usage alongside other VPS websites before increasing concurrency.

### Health

`/healthz` means the web process is alive. **`/readyz` is the composite check**: PostgreSQL query succeeds, the worker heartbeat is younger than 120 seconds and matches the web revision, and runnable work has not been stuck without progress for more than 10 minutes. The worker reports every 30 seconds. Empty queues and future jobs deferred until GitHub quota recovery are healthy. Responses are not cached. Docker health status does not trigger destructive restart/rollback loops.

## Local backup and restore

The server already handles encryption and offsite copying. This project only produces local backups:

```bash
ENV_FILE=/etc/shipkudos/.env bin/backup
ENV_FILE=/etc/shipkudos/.env bin/restore /var/backups/shipkudos/BACKUP_DIRECTORY
```

`bin/backup` writes a compressed custom-format PostgreSQL dump, compressed immutable creatives and a checksum/version/image manifest to `BACKUP_DIR`, publishing the backup atomically only after success. It excludes the real `.env`, secrets and regenerable social-image cache. Creatives are immutable and not physically removed by campaign deletion in this MVP.

Restore verifies checksums, archive paths and image metadata before stopping web/worker, replaces only the configured project database with an empty one, restores the dump and creatives, starts the compatible image and verifies readiness. An empty database avoids inherited-partition constraint conflicts during restoration of the queue. Failure leaves the app stopped rather than serving an incomplete restoration. Keep the original external encryption keys available through the server's own configuration backup. Never use restore as an automatic release rollback. Schedule `bin/backup` and local retention using the server's existing backup system.

## Checks

```bash
npm run lint
npm run typecheck
npm test
node --env-file=/absolute/path/test.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
node --env-file=/absolute/path/test.env node_modules/@playwright/test/cli.js test
```

Quick PR CI runs only lint, typecheck and Vitest, aiming for under one minute with warm dependencies (runner queue time is external). It does not start services or browsers. Playwright, PostgreSQL integration, Docker build and backup/restore smoke tests run on main and infrastructure-changing PRs. PRs never publish or deploy and do not receive production secrets. Tests use disposable databases and generated sessions, never production OAuth credentials. A live GitHub consent/private-contribution check and a live Grok Bot enrollment are required before advertising verified provider compatibility.

Load testing is **manual only** via the `Manual load test` workflow (`workflow_dispatch`), against an isolated instance. It is never a push/PR/deployment step.

## Sponsorship administration

Administrators add advertiser contacts, upload PNG/JPEG/WebP creatives (max 1 MB), and schedule fixed-duration placements (`primary`, `tool`) in Stockholm time. Overlaps for the same slot are rejected transactionally. Campaigns may be drafted, active, paused or ended. Impression recording requires 50% visibility for one second, signed exposure data and deduplication. Reports/CSV are estimates, not a billing guarantee or a claim of unique visitors. Payments are arranged outside the website.

## Commit identity

Use GitHub noreply email for both author and committer. This implementation uses the verified account identity `17181891+navarrillo@users.noreply.github.com`. Never commit personal addresses, real `.env` files, credentials, backups, database files or browser profiles.

License: MIT. See `LICENSE`.
