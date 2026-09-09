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

### Phase 1 Audit & Hardening Pass

A read-only audit of every Phase 1 API route and UI component was performed
against the 12-point security checklist and the 7 specific concerns raised
during Phase 1 sign-off. Three critical privilege-escalation paths were
identified and fixed, the dashboard permission gate was closed, error
handling on the audit route was hardened, and four UI/accessibility nits
were addressed. A scripted RBAC probe (one test user per system role,
logged in via the NextAuth credentials flow, probed against 9 protected
endpoints + 2 privilege-escalation attempts + 3 unauthenticated attempts)
returned **14/14 PASS, 0 FAIL**.

#### Security fixes (critical)

- **Privilege-escalation guard on MD-role assignment** — `POST /api/users`
  and `PUT /api/users/[id]/roles` now block non-MD users from assigning
  the `md` role. The handlers fetch the candidate roles' `name` field and
  reject the request with HTTP 403 if any candidate is the `md` role and
  the acting user is not MD. Closes the hole where any user with
  `users:create` / `users:edit` could grant themselves (or anyone else)
  full MD access in a single request.
  (`src/app/api/users/route.ts`, `src/app/api/users/[id]/roles/route.ts`)
- **Last-MD guard on role replacement** — `PUT /api/users/[id]/roles` now
  prevents stripping the MD role from the last MD user. If the target
  user is currently MD, the new `roleIds` omit `md`, and no other MD
  remains, the request is rejected. The same handler also blocks non-MD
  users from removing the MD role at all (mirrors the create-side guard).
  (`src/app/api/users/[id]/roles/route.ts`)
- **Self-deactivation block** — `PATCH /api/users/[id]` now blocks a user
  from deactivating or suspending their own account (status transitions
  to `inactive` or `suspended` where `auth.ctx.userId === id`). Brings
  the PATCH handler to parity with the existing DELETE self-deletion
  guard. (`src/app/api/users/[id]/route.ts`)

#### Security fixes (minor)

- **Dashboard permission enforcement** — `/api/dashboard` now requires
  the `dashboard:view` permission. Previously the handler only checked
  session existence, so any authenticated user could read KPIs. Every
  Phase 1 role already has `dashboard:view`, so legitimate access is
  unchanged; the route is now correctly gated for the contract.
  (`src/app/api/dashboard/route.ts`)
- **Audit route error handling** — `GET /api/audit` now wraps date
  parsing and Prisma queries in `try`/`catch`. Invalid `from`/`to` query
  params return HTTP 400 with a friendly message instead of an unhandled
  500. (`src/app/api/audit/route.ts`)

#### UI / accessibility fixes

- **ThemeToggle hydration fix** — Added a `mounted` guard so the toggle
  icon is not rendered until `next-themes` has resolved the theme
  client-side. Eliminates the SSR/client hydration mismatch that
  polluted the dev console on every page load when a non-default theme
  was stored in `localStorage`.
  (`src/components/layout/theme-toggle.tsx`)
- **Settings save-bar a11y** — `SaveBar` now renders conditionally
  (`{dirty && <SaveBar/>}`) instead of being always mounted and visually
  hidden via CSS `translate-y-full`. Hidden buttons are no longer
  keyboard-focusable when the form is clean.
  (`src/components/views/settings/settings-view.tsx`)
- **Departments form a11y** — Added `required` and `aria-required="true"`
  to the Department Name and Position Title inputs so screen readers
  announce them as required (the visual `*` asterisk in the label was
  already present).
  (`src/components/views/departments/departments-view.tsx`)
- **Tablet breakpoint fix** — `use-mobile.ts` now treats viewport width
  `<= 768` as mobile (was `< 768`). The exactly-768px case (common
  tablet-portrait width) now activates the mobile sidebar overlay drawer
  instead of the desktop sidebar, fixing ~130px horizontal overflow at
  768x1024. (`src/hooks/use-mobile.ts`)
- **Login dev credentials gated** — Demo credentials on the login screen
  now only render when `NODE_ENV !== 'production'`. A note was added
  that production deployments must replace the default passwords before
  going live. (`src/components/auth/login-screen.tsx`)

#### Dead-code cleanup

- Removed the unauthenticated `src/app/api/route.ts` ("Hello, world!")
  demo endpoint from the original scaffold. The endpoint inventory in
  `API.md` and `ARCHITECTURE.md` was updated to reflect its removal.
- Removed a redundant self-deletion check in `DELETE /api/users/[id]`
  (the second `if` was unreachable because the first `if` already
  caught both MD and non-MD self-deletions).

#### RBAC verification

A scripted RBAC probe was run after the hardening pass: one test user
per system role (`md`, `administrator`, `finance_manager`,
`operations_manager`, `hr_manager`, `project_manager`, `employee`), each
logged in via the NextAuth credentials flow, probed against 9 protected
endpoints + 2 privilege-escalation attempts + 3 unauthenticated attempts.
**Result: 14/14 PASS, 0 FAIL.** Key confirmations:

- All 7 roles can access `/api/dashboard` (200) — correct, every role
  has `dashboard:view`.
- Only `md` + `administrator` can list/create users; all other roles
  get 403.
- Only `md` + `administrator` can list roles; others 403.
- Only `md` + `administrator` + `hr_manager` can list departments;
  others 403.
- Only `md` + `administrator` can view company settings / audit; others
  403.
- All roles can view their own notifications (200) — correct, scoped to
  own `userId`.
- Privilege escalation: an `administrator` attempting to assign the MD
  role via `PUT /api/users/:id/roles` → **403 BLOCKED**. The same
  administrator attempting to create a user with the MD role via
  `POST /api/users` → **403 BLOCKED**.
- Unauthenticated access to dashboard / users / departments → **401**
  for all three.

#### Deferred items (acceptable for Phase 1; targeted for Phase 10)

- **JWT revocation latency** — permissions are loaded into the JWT at
  sign-in and live for 8 hours. A suspended or revoked user retains
  access until token expiry or re-login. Acceptable for Phase 1;
  Phase 10 may add shorter `maxAge` or DB-backed session validation.
- **bcrypt cost 10** — acceptable for Phase 1. Production deployments
  could bump to cost 12 (a one-line change in `src/lib/auth.ts`); the
  trade-off is ~2× per-login CPU.
- **Roles hard-delete** — `DELETE /api/roles/[id]` hard-deletes (with
  guards: blocks system roles + blocks roles with assigned users).
  Intentional because `UserRole`/`RolePermission` cascade-clean.
  Documented as a deliberate design choice in `DATABASE.md` §2.8.
- **Departments/positions manual validation** — uses manual validation
  instead of Zod. Works correctly; lower consistency priority. May
  migrate to Zod in a later cleanup pass.
- **Small-list endpoints without pagination envelope** — `/api/roles`,
  `/api/departments`, `/api/positions`, `/api/notifications` return
  simple arrays/objects without the full `{items,total,page,pageSize}`
  envelope. Acceptable because these lists are small and bounded
  (7 roles, 7 departments, 18 positions, 30 notifications).

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
