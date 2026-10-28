# Operations on Helios (production VPS)

Production: https://shipkudos.com (www.shipkudos.com → 301 to apex). Repo: navarrillo/shipkudos.com.
Staging (staging.shipkudos.com, branch `development`) is a separate database, OAuth app, and image channel. See [staging.md](staging.md).
Everything runs as the unprivileged `deploy` user under `/home/deploy/apps/shipkudos` (the operator's layout; the repo defaults `/etc/shipkudos/.env` etc. are overridden in the env file). No GitHub runner, no SSH from Actions.

## 1. Release model (pull)
1. Push/merge to `main` → GitHub Actions "Main release" runs integration tests, builds the image and pushes
   `ghcr.io/navarrillo/shipkudos.com:<40-char sha>` (public, anonymous pull checked). Actions never touches the server.
2. Helios cron runs `auto-deploy/auto-deploy.sh` every 10 min (minute 4,14,…,54). If `origin/main` has a new SHA
   **and** its image is anonymously pullable, it checks out that SHA in `repo/` and runs the repo's `bin/deploy <sha>`:
   flock lock → pull + pin digest → start postgres if needed → one migration run → recreate web+worker only →
   wait for `/readyz` with web **and** worker reporting the new SHA. On failure bin/deploy restores the previous image itself.
3. auto-deploy then checks through Caddy: `/readyz`=200, `/`=200, `www`=301. If that fails it runs `bin/rollback`.
4. Skips 03:00–03:59 (backups). Release history (last 10, sha + digest): `state/releases.json`.

Typical merge→live: CI 2.5–6 min + up to 10 min cron wait (fe63963: merged 23:16:44, CI done 23:19:21, live 23:20:21 CET).

## 2. Layout
| Path | What |
|---|---|
| `repo/` | git checkout, detached at the deployed SHA (scripts + compose come from the same SHA as the image) |
| `config/.env` | the single ENV_FILE (mode 600). Never print, copy or commit |
| `state/` | `releases.json`, `maintenance.lock` (shared by deploy/rollback/backup/restore) |
| `uploads/` | ad creatives, bind-mounted to `/app/uploads` (ACL: uid 10001 rwx, deploy rwx) |
| `backups/` | `bin/backup` output, newest 7 kept |
| `auto-deploy/` | `auto-deploy.sh`, `auto-deploy.log`, `deploy.last.log`, `auto-deploy.FAILED` (if any) |
| `bin/backup.sh` | nightly backup wrapper + retention |
| `caddy/shipkudos.caddy` | source of `/etc/caddy/sites/shipkudos.caddy` |
| `logs/backup.log` | one line per backup run |
Compose project `shipkudos`: `postgres` (18.3, volume `shipkudos_pgdata`, no host port), `web` (127.0.0.1:8020 only), `worker`.

## 3. Common commands
```bash
cd ~/apps/shipkudos/repo; export ENV_FILE=~/apps/shipkudos/config/.env
alias dcs='docker compose -p shipkudos --env-file $ENV_FILE -f compose.yaml'   # needs APP_IMAGE=x for read-only cmds
curl -s https://shipkudos.com/readyz                    # {"status":"ok","release":<sha>,"workerRelease":<sha>,...}
~/apps/shipkudos/auto-deploy/auto-deploy.sh --dry-run   # what would happen now
APP_IMAGE=x dcs ps ; APP_IMAGE=x dcs logs --since 1h web worker
```

### Quick-fix deploy (don't wait for cron)
After the Main release run for the fix is green:
```bash
~/apps/shipkudos/auto-deploy/auto-deploy.sh             # deploys origin/main now (same checks + auto rollback)
```
Specific SHA (must be on GHCR; e.g. re-deploy an older good one):
```bash
cd ~/apps/shipkudos/repo && git fetch -q origin && git checkout -q --detach <sha>
ENV_FILE=~/apps/shipkudos/config/.env bin/deploy <sha> </dev/null
```
Note: a manual SHA older than origin/main will be replaced by the next cron run. To hold it, comment out the
auto-deploy cron line (or `touch` a FAILED flag with `sha=<main sha> ` in it) and re-enable afterwards.

### Rollback
```bash
cd ~/apps/shipkudos/repo && ENV_FILE=~/apps/shipkudos/config/.env bin/rollback </dev/null   # previous image, no migration, no DB restore
```
Then hold the cron (see above) until main has a fixed commit, otherwise the next run redeploys the bad SHA
(unless it is already in `auto-deploy.FAILED`). Compose keeps a fallback so the first (TS-runtime) image can still run.

### Stop / take offline
```bash
APP_IMAGE=x dcs stop web worker          # Caddy then answers 502
# fully remove the site: rm /etc/caddy/sites/shipkudos.caddy && caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## 4. FAILED flag
`auto-deploy/auto-deploy.FAILED` = `<ts> sha=<sha> stage=<fetch|deploy|verify|rollback> rc=<n>`. That SHA is not retried.
Read `auto-deploy/deploy.last.log`, fix, then a new push retries automatically, or `auto-deploy.sh --force`, or remove the flag.
The daily health script WARNs while the flag exists.

## 5. Logs and journal tags
| Source | Where |
|---|---|
| auto-deploy | `auto-deploy/auto-deploy.log`, `journalctl -t shipkudos-autodeploy` |
| last deploy output | `auto-deploy/deploy.last.log` |
| backups | `logs/backup.log`, `journalctl -t shipkudos-backup` |
| app | `docker compose … logs web worker` (json-file, 10 MB × 3 per container) |
| health | `~/health/report.txt`, `journalctl -t helios-health` |
| Caddy | `journalctl -u caddy` |

## 6. Env file and secrets
- Only file: `config/.env` (600). Template: repo `.env.example`. Paths/port/project are overridden there
  (`STATE_DIR`, `UPLOADS_DIR`, `BACKUP_DIR` under this dir, `PORT=8020`, `COMPOSE_PROJECT_NAME=shipkudos`).
- Generated on Helios (openssl, never shown): `POSTGRES_PASSWORD`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`.
  Do NOT rotate `TOKEN_ENCRYPTION_KEY` (stored GitHub tokens become unreadable → everyone must reconnect) or the
  Postgres password (lives inside the volume) without a plan.
- From the project owner (production GitHub App): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`.
- Add/change a secret: receive it through a private channel (never chat, issues or PRs), stream it over ssh stdin into a small script that
  rewrites that one line (atomic write, mode 600), then `python3 repo/bin/env.py validate config/.env`. Never put values
  on a command line. Apply with `auto-deploy.sh --force` or `bin/deploy <current sha>` (recreates web+worker).
- New required var in a release: compare `.env.example` before deploying; compose fails fast on missing required vars
  (`:?`), and bin/deploy then leaves the running release untouched.

## 7. Caddy and DNS
- `/etc/caddy/sites/shipkudos.caddy` (imported by `/etc/caddy/Caddyfile` via `sites/*.caddy`): apex → `127.0.0.1:8020`
  with HSTS (no includeSubDomains), nosniff, referrer policy, no Server header; www → 301 apex. Certs: Let's Encrypt, automatic.
- Change: edit `caddy/shipkudos.caddy`, copy, `caddy validate --config /etc/caddy/Caddyfile`, `sudo systemctl reload caddy`.
- DNS: Cloudflare zone shipkudos.com, A records apex + www, DNS only (grey cloud). Back up the zone before changes.

## 8. Backups and restore
- 03:20 `bin/backup.sh` → repo `bin/backup` (pg_dump -Fc, uploads tar, manifest with checksums + image digest), keep 7.
- A nightly encrypted off-site backup includes the app's `backups/` and `config/` directories.
- Restore (stops web/worker, replaces the DB): `ENV_FILE=… repo/bin/restore ~/apps/shipkudos/backups/<dir> </dev/null`.
  Never use restore as a release rollback.

## 9. Monitoring
`~/health/helios-health.sh` (daily 07:45): https://shipkudos.com/readyz 200, www 301, cert days, FAILED flag, last backup.
`/readyz` = DB query ok + worker heartbeat < 120 s with same revision + queue not stuck > 10 min.

## 10. Gotchas
- `bin/deploy`/`bin/restore` read stdin (compose run/exec): run them with `</dev/null` in scripts or piped ssh sessions.
- Leaderboard appears up to ~16 min after a first sync (rankings rebuilt every 15 min + 60 s cache).
- Resource limits: web 768 MiB/0.75 CPU, worker 512 MiB/0.5 CPU, postgres 1.5 GiB/1 CPU (4 CPU / 7.6 GB host).

## Verification record (issue #4)
- Releases deployed by the pull procedure: a188586 (2026-10-27 23:08 CET) and fe63963 (23:20 CET), each logged
  `ok deployed … /readyz=200 /=200 www=301`; `/readyz` reports matching `release`/`workerRelease`.
- web publishes only `127.0.0.1:8020`; worker/postgres publish nothing.
- Memory/CPU limits and json-file log rotation (10m × 3) confirmed with `docker inspect`.
