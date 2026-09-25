#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/lightworld/webapps/lbms"
BRANCH="main"
HEALTH_URL="http://127.0.0.1:3000/"

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

# Git operations can replace the working tree; explicitly re-establish CWD
# before invoking Bun so child lifecycle processes never inherit a stale CWD.
cd "$APP_DIR"
pwd
[ -r . ] || fail "LBMS directory became unreadable after checkout"

# Lifecycle scripts are disabled here because the deployment shell is itself
# fed over SSH stdin. Prisma generation is performed explicitly below.
bun install --frozen-lockfile --ignore-scripts

cd "$APP_DIR"
bun scripts/prepare-postgres-schema.mjs

test -f prisma/schema.postgresql.prisma || fail "PostgreSQL Prisma schema was not prepared"

cd "$APP_DIR"
bunx prisma validate --schema=prisma/schema.postgresql.prisma
bunx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
bunx prisma generate --schema=prisma/schema.postgresql.prisma

cd "$APP_DIR"
bun run build

if pm2 describe lbms >/dev/null 2>&1; then
  pm2 reload lbms
else
  pm2 start .next/standalone/server.js --name lbms --cwd "$APP_DIR"
fi

pm2 save

# Give the process a short window to become ready, then verify locally.
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
