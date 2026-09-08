# Changelog

All notable changes to the Lightworld Business Management System (LBMS)
are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once a 1.0.0 release is cut. Until then, the `[Unreleased]` section tracks
Phase 1 deliverables.

---

## [Unreleased] — Phase 1 Foundation

### Added

#### Authentication & RBAC
- NextAuth v4 Credentials provider backed by the Prisma `User` table.
- bcryptjs password hashing (cost factor 10).
- JWT session strategy with 8-hour expiry.
- 5-attempt login lockout for 15 minutes (`failedLoginAttempts`,
  `lockedUntil` columns on `User`).
- Server-side `authorize(module, action)` helper enforced on every API
  route via `src/lib/api-helpers.ts`.
- MD role bypasses all permission checks (`session.user.isMD === true`
  short-circuits `authorize()` and `requirePermission()`).
- Type augmentation in `src/types/next-auth.d.ts` extends the NextAuth
  session with `id`, `username`, `roles`, `permissions`, `isMD`.

#### Roles & permissions
- 150-row canonical permission catalogue (25 modules × 6 actions) seeded
  via `prisma/seed.ts`.
- 7 system roles seeded: `md`, `administrator`, `finance_manager`,
  `operations_manager`, `hr_manager`, `project_manager`, `employee`.
- Roles API (`/api/roles`, `/api/roles/:id`, `/api/roles/:id/permissions`)
  with create / patch / delete (hard-delete for non-system roles with no
  users assigned).
- Permissions catalogue API (`/api/permissions`) grouped by module.
- Roles view with a 25 × 6 permission-matrix editor dialog.

#### Organisation structure
- 7 departments seeded: Management, Finance, Operations, Sales, Marketing,
  Technical, Administration.
- 18 positions seeded across those departments.
- Departments & Positions module with two-pane master-detail view, soft-
  delete with active-children guard.
- Department code uppercased on write; uniqueness enforced among
  non-deleted records.

#### Company settings
- Singleton `CompanySetting` row keyed by literal `"singleton"`.
- Seeded with `Lightworld Tech`, GHS currency, `GH₵` symbol, Accra /
  Greater Accra / Ghana address, `INV-` invoice prefix starting at 1.
- Settings API: GET (create-on-read) + PUT (partial update with
  `previousValue` + `newValue` audit).
- Tabbed settings view: Company Profile, Financial, Scope (read-only
  Phase-1 scope notes).
- Currency validation: exactly 3 uppercase letters via Zod regex.

#### Audit trail
- `AuditLog` model with `userId`, `action`, `module`, `recordId`,
  `recordType`, `description`, `ipAddress`, `userAgent`, `previousValue`
  (JSON string), `newValue` (JSON string), `createdAt`.
- `recordAudit()` helper in `src/lib/audit.ts` — the only writer.
- Audit API: GET `/api/audit` (paginated, filterable by search / module /
  action / userId / date range) and GET `/api/audit/stats` (top 8 modules
  + all actions).
- Audit view with stat cards, filter bar, expandable rows showing
  `previousValue` + `newValue` as pretty-printed JSON.
- Append-only at the application layer: no `update`/`delete` on
  `AuditLog` exists anywhere in the codebase.

#### Notifications
- `Notification` model with `title`, `message`, `type`, `category`,
  `linkUrl`, `isRead`, `readAt`, `createdAt`.
- 2 welcome notifications seeded (one for the MD, one for the admin).
- Notifications API: GET `/api/notifications` (last 30 for the signed-in
  user) + POST `/api/notifications/read-all`.

#### Users management module
- Users API (`/api/users`, `/api/users/:id`, `/api/users/:id/roles`,
  `/api/users/:id/reset-password`, `/api/users/employees`,
  `/api/users/roles`).
- Users view with paginated table, debounced search, status filter, role
  multi-select, employee picker, create/edit/manage-roles/reset-password
  dialogs.
- Soft-delete convention with `deletedAt` + `notDeleted()` filter on all
  reads.
- Last-MD guard (blocks delete + non-active status PATCH on the only MD).
- Self-delete guard.
- `passwordHash` excluded from every API response via Prisma `select`
  projection; never written to audit `previousValue`/`newValue` payloads.

#### Executive dashboard shell
- Dashboard view with 10 financial KPI cards, 8 business KPI cards,
  cash-flow Recharts area chart, alerts panel.
- Dashboard API (`/api/dashboard`) returning the full payload shape; all
  financial values are 0 in Phase 1 (downstream finance modules land in
  Phase 2). `totalStaff` is real (derived from the `Employee` table).

#### Application shell
- `AppShell` with sidebar + topbar + footer + content area.
- Sidebar built from `NAV_GROUPS` in `src/lib/navigation.ts` (single
  source of truth); items filtered by the user's permissions via
  `useAuth().can(...)`; collapsible.
- Topbar with search input, mobile sidebar trigger, notifications bell,
  theme toggle, user menu.
- User menu with avatar, email, role badges, "Sign out" (NextAuth
  `signOut()`).
- Notifications menu polling `/api/notifications`.
- Theme toggle (light / dark / system) via `next-themes`.
- Emerald primary + deep slate-teal sidebar colour system (deliberately
  avoids indigo/blue as primary brand colour per spec).
- Mobile-first responsive layout; tables scroll horizontally on small
  viewports.

#### Single-route architecture
- One user-visible URL (`/`) for the entire authenticated application.
- `?view=` query parameter drives the active module via the
  client-side `ViewRouter` (`src/components/views/view-router.tsx`).
- Phase 1 views: `dashboard`, `users`, `roles`, `departments`,
  `settings`, `audit`. Unknown `?view=` keys fall back to dashboard;
  Phase 2+ known keys render a "Coming soon" placeholder.

#### Tech stack
- Next.js 16 (App Router, React 19, React Server Components).
- TypeScript 5.
- Prisma 6 + SQLite (`db/custom.db`) — MySQL-ready schema.
- NextAuth v4 (Credentials provider, JWT strategy).
- bcryptjs (password hashing).
- Zod 4 (request body validation).
- shadcn/ui (New York style) on Radix UI primitives.
- Tailwind CSS 4 with emerald primary + slate-teal sidebar theme.
- Recharts 2 (dashboard charts).
- React Hook Form + `@hookform/resolvers` (settings + users forms).
- Sonner 2 (toasts).
- Lucide React (icons).
- next-themes (light/dark).
- Bun as the runtime + package manager (also Node-compatible).

#### Documentation set
- `README.md` — project overview, quick start, default credentials.
- `ARCHITECTURE.md` — system architecture, App Router layout, RBAC,
  audit, 10-phase roadmap, module-dependency diagram.
- `DATABASE.md` — full Prisma data dictionary + seed data + conventions.
- `SECURITY.md` — security posture, controls, known limitations.
- `API.md` — complete API endpoint reference.
- `DEPLOYMENT.md` — local dev, Caddy gateway, build, backup/restore, PWA
  preparation.
- `TESTING.md` — Phase 1 manual acceptance matrix + later-phase plan.
- `CHANGELOG.md` — this file.
- `WORKLOG.md` — formal Phase 1 worklog deliverable (per spec §41).

### Documented assumptions
- Per spec §50: the original LBMS specification called for a
  PHP / CodeIgniter 3 / MySQL implementation. After architecture review the
  team standardised on a single TypeScript stack (Next.js 16 + Prisma +
  SQLite + NextAuth v4 + Tailwind 4 + shadcn/ui). The schema is
  provider-agnostic; switching to MySQL later requires only a `provider`
  change in `prisma/schema.prisma` and a `prisma migrate` run. Money
  (Decimal) fields are deferred to Phase 2 so they land in a
  MySQL-compatible database from day one of the finance modules. All other
  functional requirements of the spec are honoured by this
  implementation.

### Known limitations (Phase 1)
- No rate limiting beyond the 5-attempt login lockout (Phase 10).
- No file upload endpoints (Phase 8 / 10).
- No Content-Security-Policy (Phase 10).
- No PWA / service worker (Phase 10).
- No backup / restore UI (Phase 10).
- No 2FA / MFA (Phase 10).
- No `mustChangePassword` enforcement in the UI (Phase 10).
- SQLite single-writer ceiling (lifted by Phase 2 MySQL migration).
- Phase 2+ modules show "Coming soon" placeholders.

### Default credentials
- MD: `md@lightworld.tech` / `Lightworld@2025`
- Admin: `admin@lightworld.tech` / `Admin@2025`

Both passwords are placeholders and must be changed after first login
(Phase 10 will add a forced password-change screen via the
`mustChangePassword` flag that already exists on the `User` model).
