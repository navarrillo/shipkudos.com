#!/usr/bin/env bash
set -Eeuo pipefail
root=$(pwd)
temp=$(mktemp -d)
registry="shipkudos-registry-$RANDOM"
project="shipkudos-smoke-$RANDOM"
sha=${GITHUB_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
export ENV_FILE="$temp/runtime.env"
mkdir -p "$temp/uploads" "$temp/state" "$temp/backups"
chmod 777 "$temp/uploads"
cat > "$ENV_FILE" <<EOF
APP_NAME=ShipKudos
APP_URL=http://127.0.0.1:18020
PORT=18020
APP_SHA=$sha
APP_IMAGE=localhost:15000/shipkudos:$sha
IMAGE_REPO=localhost:15000/shipkudos
COMPOSE_PROJECT_NAME=$project
STATE_DIR=$temp/state
UPLOADS_DIR=$temp/uploads
BACKUP_DIR=$temp/backups
POSTGRES_USER=shipkudos
POSTGRES_DB=shipkudos
POSTGRES_PASSWORD=isolated-smoke-only
DATABASE_URL=postgresql://shipkudos:isolated-smoke-only@postgres:5432/shipkudos
BETTER_AUTH_SECRET=isolated-smoke-secret-at-least-32-characters
TOKEN_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000001
GITHUB_CLIENT_ID=isolated-client
GITHUB_CLIENT_SECRET=isolated-client-secret
GITHUB_WEBHOOK_SECRET=isolated-webhook-secret
ADMIN_GITHUB_IDS=1001
EOF
cleanup() {
  docker compose --env-file "$ENV_FILE" -f "$root/compose.yaml" logs --tail 30 || true
  # Disposable, uniquely named CI project only. Production scripts never use down -v.
  docker compose --env-file "$ENV_FILE" -f "$root/compose.yaml" down -v || true
  docker rm -f "$registry" || true
}
trap cleanup EXIT
docker run -d --name "$registry" -p 127.0.0.1:15000:5000 registry:2
docker tag shipkudos:test "localhost:15000/shipkudos:$sha"
docker push "localhost:15000/shipkudos:$sha"
bin/deploy "$sha"
compose() { docker compose --env-file "$ENV_FILE" -f "$root/compose.yaml" "$@"; }
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U shipkudos -d shipkudos -c "INSERT INTO advertisers(id,name,email) VALUES('00000000-0000-4000-8000-000000000001','Recovery fixture','fixture@example.invalid')"
compose exec -T web sh -c 'printf creative-fixture > /app/uploads/example.webp'
backup=$(bin/backup | tail -n 1)
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U shipkudos -d shipkudos -c "DELETE FROM advertisers WHERE id='00000000-0000-4000-8000-000000000001'"
compose exec -T web sh -c 'printf modified > /app/uploads/example.webp'
bin/restore "$backup"
test "$(cat "$temp/uploads/example.webp")" = creative-fixture
test "$(compose exec -T postgres psql -At -U shipkudos -d shipkudos -c "SELECT name FROM advertisers WHERE id='00000000-0000-4000-8000-000000000001'")" = 'Recovery fixture'
# A second healthy release makes rollback executable without touching the schema.
other=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
docker tag shipkudos:test "localhost:15000/shipkudos:$other"
docker push "localhost:15000/shipkudos:$other"
bin/deploy "$other"
bin/rollback
