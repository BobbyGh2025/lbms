# Deployment

This document covers local development, the Caddy gateway convention, the
production build/start flow, database migration, backup/restore, and PWA
preparation for LBMS.

---

## 1. Prerequisites

### Runtime

- **Bun** (preferred — the project uses `bun.lock` and `bun run db:seed`
  which executes `prisma/seed.ts` as a Bun script). Install from
  https://bun.sh.
- Or **Node.js 20+** with `npm` / `pnpm` / `yarn` — adjust the commands
  accordingly (`npm install`, `npm run db:push`, etc.). The Prisma seed
  script can also be run with `ts-node` or `tsx` if Bun is unavailable.

### Environment variables

Create `.env` in the project root:

```bash
DATABASE_URL="file:./db/custom.db"
NEXTAUTH_SECRET="generate-a-long-random-string-here"
NEXTAUTH_URL="http://localhost:3000"
```

`NEXTAUTH_SECRET` can be generated with:

```bash
openssl rand -base64 32
# or
bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`NEXTAUTH_URL` should match the public base URL of the deployment (e.g.
`https://lbms.lightworld.tech` in production).

---

## 2. Local development

```bash
# 1. Install dependencies
bun install

# 2. Create/sync the SQLite schema
bun run db:push

# 3. Seed the foundation data (idempotent — safe to re-run)
bun run db:seed

# 4. Start the dev server
bun run dev
```

`bun run dev` is defined as `next dev -p 3000 2>&1 | tee dev.log`. The
dev server is reachable at `http://localhost:3000`. Output is also piped to
`dev.log` for debugging.

Sign in with one of the default credentials:

- MD: `md@lightworld.tech` / `Lightworld@2025`
- Admin: `admin@lightworld.tech` / `Admin@2025`

Both passwords are placeholders and **must be changed after first login**
(see Phase 10's `mustChangePassword` enforcement plan in `SECURITY.md`).

---

## 3. Caddy gateway + `XTransformPort`

The repository ships a `Caddyfile`:

```caddy
:81 {
  @transform_port_query {
    query XTransformPort=*
  }

  handle @transform_port_query {
    reverse_proxy localhost:{query.XTransformPort} {
      header_up Host {host}
      header_up X-Forwarded-For {remote_host}
      header_up X-Forwarded-Proto {scheme}
      header_up X-Real-IP {remote_host}
    }
  }

  handle {
    reverse_proxy localhost:3000 {
      header_up Host {host}
      header_up X-Forwarded-For {remote_host}
      header_up X-Forwarded-Proto {scheme}
      header_up X-Real-IP {remote_host}
    }
  }
}
```

### Convention

- The Caddy gateway listens on **port 81**.
- The default upstream is `localhost:3000` (the LBMS dev server).
- Any request that includes a `?XTransformPort=<port>` query parameter is
  reverse-proxied to `localhost:<port>` instead. This allows the sandbox
  environment to host multiple mini-services behind a single Caddy entry
  point: the main LBMS app on `:3000`, plus side-channel services on
  `:3015`, `:3020`, etc., addressed as
  `http://localhost:81/?XTransformPort=3015`.

### Headers

Caddy forwards `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, and
`X-Real-IP` to the upstream. The auth layer reads
`x-forwarded-for` (first IP in the comma-separated list) and falls back to
`x-real-ip` when populating `AuditLog.ipAddress` and `User.lastLoginIp`.

### Production hardening (Phase 10)

Phase 1's Caddyfile listens on plain HTTP. Phase 10 will add:

- TLS termination (Let's Encrypt automatic via Caddy).
- A real domain name instead of `:81`.
- Strict `Strict-Transport-Security`, `Content-Security-Policy`, and
  `X-Frame-Options` headers.
- Per-IP rate limiting at the gateway.

---

## 4. Production build (standard flow)

> **Sandbox constraint**: do not run `bun run build` inside this sandbox
> (per environment rules). The instructions below are the standard flow
> for a real deployment.

### Build

```bash
# Generates .next/standalone/server.js + .next/static
bun run build
```

`bun run build` is defined as
`next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`.
This produces a self-contained server bundle in `.next/standalone/`.

### Start

```bash
NODE_ENV=production bun .next/standalone/server.js
```

The `start` script wraps this with `tee server.log` for log capture. The
standalone server reads the same `.env` (the build step inlines public env
vars but `NEXTAUTH_SECRET` and `DATABASE_URL` remain runtime env vars).

### Production prerequisites

- A process manager (systemd, PM2, or a container orchestrator) to keep
  the server alive and restart it on crash.
- A reverse proxy (Caddy or nginx) for TLS termination and to forward
  `X-Forwarded-*` headers.
- A writable `db/custom.db` location (or a MySQL instance for Phase 2+).

### Phase 1 caveat

Phase 1 is **not** production-hardened. See `SECURITY.md` §14 for the list
of known limitations (no rate limiting, no CSP, no 2FA, no backup UI,
SQLite single-writer). Production deployment should wait for Phase 10.

---

## 5. Database migration procedure

### Development: `prisma db push`

`bun run db:push` runs `prisma db push --accept-data-loss`. This is fine
for development — there is no production data to preserve. The
`--accept-data-loss` flag lets Prisma rebuild tables when a column type
changes. Re-run the seed afterwards:

```bash
bun run db:push
bun run db:seed
```

### Production (Phase 2+): `prisma migrate`

Once Phase 2 ships and real data exists, switch to migration-based
schema management:

```bash
# Create + apply a migration in development
bun run db:migrate      # `prisma migrate dev`

# Deploy migrations in production (no schema drift)
npx prisma migrate deploy
```

Migrations will be checked in under `prisma/migrations/` from Phase 2
onward. Phase 1's `prisma db push` history is intentionally not committed.

### Reset (development only)

`bun run db:reset` runs `prisma migrate reset`, which drops and recreates
the database, then re-applies all migrations and runs the seed. Useful
when iterating on the schema during Phase 2 development.

### Prisma client regeneration

Whenever `prisma/schema.prisma` changes, regenerate the Prisma client:

```bash
bun run db:generate     # `prisma generate`
```

This is also automatically run as part of `bun install` via the
`postinstall` hook (Prisma's default behaviour).

---

## 6. Backup strategy (Phase 10 — planned approach)

Phase 1 has no in-app backup/restore UI. Backups must be performed
out-of-band until Phase 10 ships the `Backup & Restore` module. The
planned approach is documented here so operators can implement it
manually if required.

### Development (SQLite)

The SQLite database is a single file at `db/custom.db`. A consistent
backup can be taken with:

```bash
# Option A: copy the file (acceptable for low-write dev databases)
cp db/custom.db "db/backup-$(date +%Y%m%d-%H%M%S).db"

# Option B: use the SQLite CLI for a consistent snapshot
sqlite3 db/custom.db ".backup db/backup-$(date +%Y%m%d-%H%M%S).db"
```

Option B uses SQLite's online backup API, which is safe to run while the
app is writing.

### Production (MySQL — Phase 2+)

When the datasource is switched to MySQL, the standard backup is
`mysqldump`:

```bash
mysqldump -u lbms -p lbms_production > "lbms-$(date +%Y%m%d).sql"
```

For larger databases, `--single-transaction --quick` should be added to
avoid locking the database during the dump.

### Backup schedule (Phase 10)

Phase 10 will ship a cron-driven backup job that:

- Takes a daily full backup at 02:00 local time.
- Retains 7 daily backups + 4 weekly backups + 12 monthly backups.
- Writes backups to a separate volume (not the app server's root disk).
- Uploads encrypted copies to off-site storage (S3 / B2 / similar).

The Phase 10 Backup & Restore UI will let an administrator trigger an
ad-hoc backup and download the latest backup file.

---

## 7. Restore procedure

### SQLite restore (development)

```bash
# 1. Stop the app server.
# 2. Move the current DB aside (in case the restore needs to be reverted).
mv db/custom.db "db/custom.db.broken-$(date +%Y%m%d-%H%M%S)"

# 3. Restore from the backup file.
cp db/backup-20250101-020000.db db/custom.db

# 4. Restart the app server.
bun run dev
```

### MySQL restore (Phase 2+)

```bash
# Stop the app server.
mysql -u lbms -p lbms_production < /path/to/lbms-20250101.sql
# Restart the app server.
```

### Phase 10 UI restore

The Phase 10 Backup & Restore module will provide a one-click restore
button for the most recent backup. Restore will be a privileged action
restricted to the MD and Administrator roles.

---

## 8. PWA preparation (Phase 10)

Phase 10 will turn LBMS into an installable Progressive Web App. The
Phase 1 codebase already lays the groundwork:

### Already present

- `next-themes` for light/dark theming (PWA needs stable theme on install).
- A `public/logo.svg` for the app icon source.
- Mobile-first responsive layout in `AppShell` and every view.
- HTTPS-ready (Caddy will terminate TLS in Phase 10).

### Phase 10 deliverables

- `public/manifest.webmanifest` — PWA manifest with name, short name,
  icons (192×192, 512×512, maskable), `start_url = "/"`,
  `display = "standalone"`, `theme_color` matching the emerald primary,
  `background_color` matching the sidebar slate-teal.
- `<link rel="manifest" href="/manifest.webmanifest">` in `src/app/layout.tsx`.
- Apple touch icon + favicon link tags.
- A service worker (`public/sw.js`) with a stale-while-revalidate cache
  strategy for the JS/CSS bundles and a network-first strategy for the
  API endpoints.
- An "Install LBMS" prompt via the `beforeinstallprompt` event.
- Offline fallback page for unauthenticated users.

### Phase 10 service worker constraints

The service worker must **not** cache:

- `/api/auth/*` (would break session refresh).
- `/api/dashboard`, `/api/notifications` (real-time data).
- Any `POST`/`PATCH`/`PUT`/`DELETE` request.

---

## 9. Health check

The legacy `GET /` (no session) renders the `LoginScreen`. There is no
dedicated `/health` endpoint in Phase 1. The Phase 1 health signal is:

- `GET /api/auth/session` returns `{}` (HTTP 200) when the app is alive
  and unauthenticated. This is the recommended liveness probe for the
  load balancer.
- The Caddyfile's default upstream (`localhost:3000`) is the readiness
  signal: if the dev server is down, Caddy returns 502.

Phase 10 will add a dedicated `/api/health` endpoint that returns the
build SHA, the database connection status, and the active migration
version.

---

## 10. Common operations cheat sheet

| Task | Command |
| --- | --- |
| Install dependencies | `bun install` |
| Push schema (dev) | `bun run db:push` |
| Re-seed (idempotent) | `bun run db:seed` |
| Start dev server | `bun run dev` |
| Lint | `bun run lint` |
| Regenerate Prisma client | `bun run db:generate` |
| Reset DB (dev only) | `bun run db:reset` |
| Build (real deploy only) | `bun run build` |
| Start production server | `NODE_ENV=production bun .next/standalone/server.js` |
| Backup (SQLite dev) | `cp db/custom.db db/backup-$(date +%Y%m%d).db` |
| Restore (SQLite dev) | `cp db/backup-YYYYMMDD.db db/custom.db` |
