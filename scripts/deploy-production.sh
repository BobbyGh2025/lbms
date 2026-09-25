#!/usr/bin/env bash
set -euo pipefail

# The script is streamed over SSH stdin. Detach child processes from that
# stream so Prisma/Bun cannot inherit the remote script input descriptor.
exec </dev/null

APP_DIR="/home/lightworld/webapps/lbms"
BRANCH="main"
LBMS_PORT="3015"
HEALTH_URL="http://127.0.0.1:${LBMS_PORT}/"

fail() {
  echo "LBMS deployment stopped: $1" >&2
  exit 1
}

[ "$(id -un)" = "lbmsdeploy" ] || fail "must run as lbmsdeploy"
[ -d "$APP_DIR" ] || fail "LBMS directory does not exist"
command -v git >/dev/null 2>&1 || fail "git is not installed"
command -v bun >/dev/null 2>&1 || fail "bun is not installed"
command -v pm2 >/dev/null 2>&1 || fail "pm2 is not installed for lbmsdeploy"

cd "$APP_DIR"
pwd
[ -r . ] || fail "LBMS directory is not readable"

if [ ! -d .git ]; then
  git init
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/BobbyGh2025/lbms.git"
else
  git remote add origin "https://github.com/BobbyGh2025/lbms.git"
fi

git fetch --prune origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

cd "$APP_DIR"
pwd
[ -r . ] || fail "LBMS directory became unreadable after checkout"
[ -f "$APP_DIR/.env" ] || fail "production .env is missing"

# Load the VPS-only production environment. .env is ignored by Git and remains
# outside the repository working tree during checkout/reset.
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is missing from production .env"
[ -n "${NEXTAUTH_SECRET:-}" ] || fail "NEXTAUTH_SECRET is missing from production .env"
[ -n "${NEXTAUTH_URL:-}" ] || fail "NEXTAUTH_URL is missing from production .env"

bun install --frozen-lockfile --ignore-scripts

cd "$APP_DIR"
bun scripts/prepare-postgres-schema.mjs

test -f prisma/schema.postgresql.prisma || fail "PostgreSQL Prisma schema was not prepared"

cd "$APP_DIR"
node node_modules/prisma/build/index.js validate --schema=prisma/schema.postgresql.prisma

# The repository currently contains a historical duplicate init migration:
# 20260917000927_init is byte-for-byte identical to the already-applied
# 20260911000441_init. On a fresh database the first migration succeeds and
# the duplicate fails on the existing User table. We recover only this exact,
# known condition by marking the duplicate migration applied, matching the
# manual production recovery already performed. Any other migration failure
# remains fatal.
migration_output=""
if ! migration_output="$(node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.postgresql.prisma 2>&1)"; then
  printf '%s\n' "$migration_output" >&2

  if printf '%s\n' "$migration_output" | grep -Fq 'Migration name: 20260917000927_init' &&
     printf '%s\n' "$migration_output" | grep -Fq 'relation "User" already exists'; then
    echo "Known duplicate init migration detected; resolving it as applied."
    node node_modules/prisma/build/index.js migrate resolve --applied "20260917000927_init" --schema=prisma/schema.postgresql.prisma
    bunx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
  else
    fail "Prisma migration deployment failed"
  fi
else
  printf '%s\n' "$migration_output"
fi

node node_modules/prisma/build/index.js migrate status --schema=prisma/schema.postgresql.prisma
node node_modules/prisma/build/index.js generate --schema=prisma/schema.postgresql.prisma

cd "$APP_DIR"
bun run build

if pm2 describe lbms >/dev/null 2>&1; then
  PORT="$LBMS_PORT" NODE_ENV=production pm2 reload lbms --update-env
else
  PORT="$LBMS_PORT" NODE_ENV=production pm2 start .next/standalone/server.js --name lbms --cwd "$APP_DIR"
fi

pm2 save

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "LBMS health check passed."
    echo "LBMS deployment completed."
    exit 0
  fi
  sleep 2
done

pm2 status
fail "LBMS process did not pass the local health check"
