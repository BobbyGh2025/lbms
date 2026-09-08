# LBMS — Lightworld Business Management System

LBMS is an internal, role-based, audit-traceable business management platform
for Lightworld Tech. It consolidates finance, people, customers/suppliers,
projects, operations, assets and reporting into one web application, governed by
a strict role-based access control (RBAC) model and an append-only audit trail.

This repository currently ships **Phase 1 — Foundation**: authentication,
RBAC, organisation structure (departments & positions), company settings,
notifications, the executive dashboard shell, and five administration modules
(Users, Roles & Permissions, Departments & Positions, Company Settings, Audit
Trail). Subsequent phases extend the system to cover the full 10-phase
roadmap described below.

---

## Documented assumption (per spec §50)

The original Lightworld specification called for a PHP / CodeIgniter 3 /
MySQL implementation. After architecture review the team standardised on a
single TypeScript stack — **Next.js 16 (App Router) + Prisma + SQLite +
NextAuth v4 + Tailwind CSS 4 + shadcn/ui**. This is recorded as a documented
assumption per §50 of the specification:

- The data model in `prisma/schema.prisma` is provider-agnostic; switching the
  Prisma datasource from SQLite to MySQL later requires only a `provider`
  change and a `prisma migrate` run. No application code depends on
  SQLite-specific behaviour.
- The Phase 1 money fields (finance, budgets, receivables, payables) are
  deferred to Phase 2 precisely so that Decimal precision lands in a
  MySQL-compatible database from day one of the finance modules.
- All other functional requirements of the spec (RBAC, audit trail, MD bypass,
  singleton company settings, soft-delete, 5-attempt lockout, 8-hour JWT
  session, etc.) are honoured faithfully by this implementation.

---

## Tech stack (as shipped)

| Layer | Technology |
| --- | --- |
| Runtime | Node.js / Bun |
| Framework | Next.js 16 (App Router, React Server Components) |
| Language | TypeScript 5 |
| ORM | Prisma 6 |
| Database (Phase 1) | SQLite (`db/custom.db`); MySQL-ready schema |
| Authentication | NextAuth v4 (Credentials provider, JWT strategy, 8-hour sessions) |
| Password hashing | bcryptjs (cost factor 10) |
| Validation | Zod 4 |
| UI primitives | shadcn/ui (New York style), Radix UI |
| Styling | Tailwind CSS 4 (emerald primary, slate-teal sidebar) |
| Charts | Recharts 2 |
| Forms | React Hook Form + `@hookform/resolvers` |
| Notifications (UI) | Sonner 2 |
| Icons | Lucide React |
| Themes | next-themes (light/dark) |

---

## 10-phase roadmap

| Phase | Name | Status |
| --- | --- | --- |
| 1 | Foundation — auth, RBAC, org structure, settings, audit, notifications, dashboard shell | **Shipped** |
| 2 | Finance Foundation — income, expenditure, cash & bank, finance categories | Planned |
| 3 | Budgets, Receivables, Payables, Approvals | Planned |
| 4 | Staff management, Staff Tasks | Planned |
| 5 | Customers (CRM), Suppliers | Planned |
| 6 | Projects, Project Pipeline | Planned |
| 7 | Operations, MD Decision Log | Planned |
| 8 | Asset management, Document management (with file-upload validation) | Planned |
| 9 | Reports | Planned |
| 10 | Backup & Restore, PWA, rate-limit hardening, production hardening | Planned |

---

## Quick start

### Prerequisites

- Bun (preferred) or Node.js 20+
- SQLite (bundled; no server install required for Phase 1)

### Environment variables

Create `.env` in the project root (a `.env.example` is intentionally not
committed). The three required variables are:

```bash
DATABASE_URL="file:./db/custom.db"
NEXTAUTH_SECRET="replace-with-a-long-random-string"
NEXTAUTH_URL="http://localhost:3000"
```

### Install, push schema, seed, run

```bash
bun install
bun run db:push      # create / sync the SQLite schema
bun run db:seed      # seed permissions, roles, departments, settings, default users
bun run dev          # start the dev server on http://localhost:3000
```

If the Caddy gateway is enabled in this environment, the app is reachable
through `http://localhost:81/` (see `DEPLOYMENT.md`).

### Default credentials

Two users are seeded in Phase 1. Both passwords are placeholders and **must
be changed after first login**.

| Role | Email | Password |
| --- | --- | --- |
| Managing Director (MD) | `md@lightworld.tech` | `Lightworld@2025` |
| Administrator | `admin@lightworld.tech` | `Admin@2025` |

---

## Architecture in one paragraph

LBMS uses a **single user-visible route** (`/`). A server-side check on
`/` renders the `LoginScreen` when there is no NextAuth session, and renders
the `AppShell` (sidebar + topbar + footer + content) when authenticated.
Inside the shell, a client `ViewRouter` reads the `?view=` query parameter
and renders the matching module view — Phase 1 ships `dashboard`, `users`,
`roles`, `departments`, `settings`, `audit`; Phase 2+ views render a
"Coming soon" placeholder. All data flows through typed Next.js Route
Handlers under `src/app/api/*`, each guarded server-side by the
`authorize(module, action)` helper from `src/lib/api-helpers.ts`.

See `ARCHITECTURE.md` for the full system architecture, `API.md` for the
endpoint reference, `DATABASE.md` for the data dictionary, `SECURITY.md` for
the security posture, `DEPLOYMENT.md` for deployment, `TESTING.md` for the
test plan, `CHANGELOG.md` for changes, and `WORKLOG.md` for the formal
phase-1 worklog deliverable.

---

## Project layout

```
prisma/
  schema.prisma        Data model (User, Role, Permission, RolePermission,
                       UserRole, Department, Position, Employee,
                       CompanySetting, AuditLog, Notification)
  seed.ts              Phase 1 seed script (150 perms, 7 roles, 7 depts,
                       18 positions, 2 users, settings, welcome notifications)
src/
  app/
    page.tsx           Server component: LoginScreen OR AppShell+ViewRouter
    layout.tsx         Root layout (fonts, theme provider, sonner toaster)
    api/               Route Handlers (see API.md)
  components/
    layout/            AppShell, AppSidebar, AppTopbar, AppFooter, UserMenu,
                       NotificationsMenu, ThemeToggle
    views/             Dashboard, Users, Roles, Departments, Settings,
                       Audit, ComingSoon, plus the ViewRouter
    auth/              LoginScreen
    common/            PageHeader, EmptyState, ConfirmDialog, KpiCard
    ui/                shadcn/ui component library
    providers/         AppProviders (theme + session)
  lib/
    auth.ts            NextAuth options (Credentials, JWT, lockout)
    permissions.ts     Permission catalogue + requirePermission/hasPermission
    audit.ts           recordAudit() append-only helper
    api-helpers.ts     authorize(), pagination, ok/error responses
    navigation.ts      Sidebar nav config (single source of truth)
    db.ts              Prisma client singleton
  hooks/               use-auth, use-toast, use-mobile
  types/               next-auth.d.ts (session augmentation)
```

---

## Conventions

- **Authorization enforced server-side, not just in the UI.** Every API route
  calls `authorize(module, action)` before any database write. UI buttons
  hidden by missing permissions are a UX nicety, not a security boundary.
- **MD bypasses all permission checks.** The `md` role is detected on every
  request via `session.user.isMD` and the server short-circuits the check.
- **Soft-delete convention.** All deletable models carry a nullable
  `deletedAt`. Reads filter `deletedAt: null` via the `notDeleted()` helper.
  Hard delete is reserved for roles with no users assigned (cascade-safe).
- **Audit trail is append-only.** No `PATCH`/`DELETE` endpoints exist on the
  audit resource; the `recordAudit()` helper is the only writer.
- **No plain-text passwords.** bcryptjs with cost factor 10; `passwordHash`
  is excluded from every API response via Prisma `select` projections.
- **Money deferred to Phase 2.** Decimal money fields land with the finance
  modules in a MySQL-compatible database.

---

## Documentation index

| File | Purpose |
| --- | --- |
| `README.md` | This overview |
| `ARCHITECTURE.md` | System architecture, App Router layout, RBAC, audit, roadmap |
| `DATABASE.md` | Prisma data dictionary, seed data, conventions |
| `SECURITY.md` | Security posture and controls |
| `API.md` | API endpoint reference (every route) |
| `DEPLOYMENT.md` | Local dev, Caddy gateway, build/backup/restore |
| `TESTING.md` | Phase 1 test matrix and test strategy |
| `CHANGELOG.md` | Keep-a-Changelog entry for Phase 1 |
| `WORKLOG.md` | Formal Phase 1 worklog deliverable (per spec §41) |

---

## Licence

Proprietary — internal use by Lightworld Tech.
