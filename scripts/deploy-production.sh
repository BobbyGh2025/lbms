#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/lightworld/webapps/lbms"
BRANCH="main"

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

bun install --frozen-lockfile
bun scripts/prepare-postgres-schema.mjs

test -f prisma/schema.postgresql.prisma || fail "PostgreSQL Prisma schema was not prepared"

bunx prisma validate --schema=prisma/schema.postgresql.prisma
bunx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
bunx prisma generate --schema=prisma/schema.postgresql.prisma

bun run build

if pm2 describe lbms >/dev/null 2>&1; then
  pm2 reload lbms
else
  pm2 start .next/standalone/server.js --name lbms --cwd "$APP_DIR"
fi

pm2 save
echo "LBMS deployment completed."
