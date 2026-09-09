# Architecture

This document describes the runtime architecture of LBMS as shipped in
Phase 1. It is intended for maintainers and for downstream subagents that
need to extend the system in later phases.

---

## 1. High-level topology

```
+-----------------------------------------------------------+
|                       Browser (PWA-ready, Phase 10)        |
|  /  (single user-visible route)                            |
|     ?view=dashboard | users | roles | departments | ...   |
+----------------------------+------------------------------+
                             |
                             v
+-----------------------------------------------------------+
| Next.js 16 App Router (Node/Bun runtime)                  |
|                                                           |
|  src/app/page.tsx          (Server Component)             |
|    - getServerSession()                                    |
|    - if no session -> <LoginScreen/>                       |
|    - if session    -> <AppShell><ViewRouter/></AppShell>   |
+----------------------------+------------------------------+
                             |
        +--------------------+--------------------+
        |                    |                    |
        v                    v                    v
+-----------------+  +-----------------+  +-----------------+
| AppShell        |  | ViewRouter      |  | API Route       |
| (layout)        |  | (?view=...)     |  | Handlers        |
|  - sidebar       |  |  - dashboard   |  | src/app/api/*   |
|  - topbar        |  |  - users       |  |                  |
|  - footer        |  |  - roles       |  |  authorize()    |
|  - notifications |  |  - departments |  |  + Prisma       |
+-----------------+  |  - settings    |  |  + audit         |
                     |  - audit       |  |                  |
                     |  - coming-soon |  |                  |
                     +-----------------+  +-----------------+
                                                     |
                                                     v
                                             +----------------+
                                             | Prisma Client  |
                                             | (src/lib/db.ts)|
                                             +-------+--------+
                                                     |
                                                     v
                                             +----------------+
                                             | SQLite         |
                                             | db/custom.db   |
                                             | (MySQL-ready)  |
                                             +----------------+
```

---

## 2. App Router structure

LBMS uses the Next.js **App Router**. The actual route table is intentionally
minimal — Phase 1 exposes only `/` to the user. Everything else is a
client-side view swap driven by the `?view=` query parameter.

```
src/app/
  layout.tsx                Root layout (html, body, fonts, AppProviders)
  page.tsx                  Server component — auth gate + shell
  globals.css               Tailwind 4 entrypoint + theme tokens
  api/
    auth/
      [...nextauth]/route.ts   NextAuth route handler
    dashboard/route.ts
    notifications/
      route.ts
      read-all/route.ts
    users/
      route.ts
      [id]/route.ts
      [id]/roles/route.ts
      [id]/reset-password/route.ts
      employees/route.ts    (picker for the user form)
      roles/route.ts        (picker for the user form)
    roles/
      route.ts
      [id]/route.ts
      [id]/permissions/route.ts
    permissions/route.ts    (catalogue)
    departments/
      route.ts
      [id]/route.ts
    positions/
      route.ts
      [id]/route.ts
    company-settings/route.ts
    audit/
      route.ts
      stats/route.ts
```

> **Removed in Phase 1 audit hardening pass**: the legacy
> `src/app/api/route.ts` ("Hello, world!" health-check) inherited from
> the original scaffold has been deleted. It was unauthenticated,
> carried no business value, and was not consumed by the LBMS UI.
> The Phase 1 surface is now exactly the route tree shown above.

Each Route Handler is a thin layer that:

1. calls `authorize(module, action)` to authenticate + check permission,
2. validates the body with Zod (for mutations),
3. performs the Prisma read/write inside a transaction where needed,
4. calls `auditFromCtx()` to record the mutation in the audit trail,
5. returns a typed JSON response via `ok()` / `badRequest()` / `notFound()`
   / `unauthorized()` / `forbidden()`.

---

## 3. Single-route architecture (`/` + `?view=`)

LBMS does **not** use one URL per module. There is exactly one user-visible
URL: `/`. The active module is selected by the `?view=` query parameter.

### Server-side flow (`src/app/page.tsx`)

```ts
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return <LoginScreen />;
  return (
    <AppShell>
      <ViewRouter />
    </AppShell>
  );
}
```

`force-dynamic` ensures the session is evaluated on every request — there is
no static caching of the auth gate.

### Client-side flow (`src/components/views/view-router.tsx`)

The `ViewRouter` reads `useSearchParams().get("view") ?? "dashboard"` and
renders one of:

| `?view=` | Component | Phase |
| --- | --- | --- |
| `dashboard` (default) | `DashboardView` | 1 |
| `users` | `UsersView` | 1 |
| `roles` | `RolesView` | 1 |
| `departments` | `DepartmentsView` | 1 |
| `settings` | `SettingsView` | 1 |
| `audit` | `AuditView` | 1 |
| any other known key | `ComingSoonView` | 2-10 |
| unknown key | falls back to `DashboardView` | — |

The set of "known" keys is derived from `NAV_ITEM_BY_VIEW` in
`src/lib/navigation.ts`, which prevents arbitrary `?view=` injection from
rendering unexpected components.

### Rationale

- A single route keeps the sidebar / topbar / footer chrome mounted across
  every module; only the content pane swaps. This avoids remounting the
  sidebar on every navigation and keeps notifications, theme, and search
  state alive.
- Bookmarking and the browser back button still work because the active
  module is encoded in the URL query string.
- The shell is server-rendered (so the auth gate runs on the server) but the
  view swap is client-side, so module-to-module navigation is instant.

---

## 4. AppShell (`src/components/layout/`)

The `AppShell` is the authenticated application frame:

| Component | Responsibility |
| --- | --- |
| `app-shell.tsx` | Top-level wrapper; mounts sidebar + topbar + content + footer |
| `app-sidebar.tsx` | Collapsible sidebar built from `NAV_GROUPS`. Filters items by the user's permissions via `useAuth().can(module, action)`. MD sees everything. |
| `app-topbar.tsx` | Search input, mobile sidebar trigger, notifications bell, theme toggle, user menu |
| `notifications-menu.tsx` | Popover listing the last 30 notifications from `/api/notifications`, "mark all read" button (POST `/api/notifications/read-all`) |
| `user-menu.tsx` | Avatar + dropdown with email, role list, "Sign out" (NextAuth `signOut()`) |
| `theme-toggle.tsx` | Light/dark/system toggle via `next-themes` |
| `app-footer.tsx` | Sticky footer with company + phase info |

The theme tokens (emerald primary, deep slate-teal sidebar, custom scrollbar)
live in `src/app/globals.css` and `tailwind.config.ts`.

---

## 5. ViewRouter pattern

`ViewRouter` is wrapped in `<Suspense>` because `useSearchParams()` must be
inside a Suspense boundary in the App Router. While the params are resolving,
a small "Loading…" placeholder is shown.

The pattern intentionally does **not** use `next/navigation`'s `router.push`
for view swaps — every internal link is a plain `<Link href="/?view=...">`,
so navigation goes through the normal browser history. This keeps deep links
shareable and the back button predictable.

---

## 6. API route layer (`src/app/api/*`)

Every Route Handler follows the same shape:

```ts
export async function GET(req: NextRequest) {
  const auth = await authorize("users", "view");        // 1. auth
  if (!auth.ok) return auth.response;                    //    401/403

  const sp = req.nextUrl.searchParams;
  const { page, pageSize, skip } = pagination(sp);       // 2. parse inputs

  const [total, rows] = await Promise.all([...]);        // 3. Prisma read
  return ok({ items: rows, total, page, pageSize });     // 4. typed response
}
```

For mutations the same shape adds a Zod schema and an audit step:

```ts
export async function POST(req: NextRequest) {
  const auth = await authorize("users", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON."); }
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message, parsed.error.issues);

  // ... uniqueness, validation, transaction ...

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "users",
    recordId: created.id,
    recordType: "User",
    description: `Created user ${created.username}`,
    newValue: serialize(created),
  });

  return ok(serialize(created), 201);
}
```

Dynamic-route handlers (`[id]/route.ts`) follow Next.js 16's async-params
convention: `{ params }: { params: Promise<{ id: string }> }`, awaited
inside each handler.

---

## 7. Lib layer (`src/lib/`)

| Module | Purpose |
| --- | --- |
| `db.ts` | Prisma client singleton (one connection pool per process) |
| `auth.ts` | NextAuth options — Credentials provider, JWT session (8h), bcrypt verify, 5-attempt lockout, login/logout audit hooks |
| `permissions.ts` | `PERMISSION_MODULES` (25 modules), `PERMISSION_ACTIONS` (6 actions), `requirePermission()`, `hasPermission()`, `loadUserAuthData()`, `AuthorizationError`, `AuthenticationError` |
| `audit.ts` | `AuditAction` union, `AuditEntry`, `recordAudit()` (the only writer to `AuditLog`) |
| `api-helpers.ts` | `authorize()`, `auditFromCtx()`, `pagination()`, `notDeleted()`, `ok/badRequest/unauthorized/forbidden/notFound` responses, `AuthContext` type |
| `navigation.ts` | `NAV_GROUPS` sidebar config + `NAV_ITEM_BY_VIEW` lookup, each item carries `module`, `view`, `phase` |
| `utils.ts` | `cn()` class merge helper |

### Type augmentation (`src/types/next-auth.d.ts`)

The default NextAuth session is augmented to carry:

- `session.user.id: string`
- `session.user.username: string`
- `session.user.roles: string[]` (role names)
- `session.user.permissions: string[]` (flattened `["module:action", ...]`)
- `session.user.isMD: boolean`

The JWT callback populates these from `loadUserAuthData()` at sign-in, and
the session callback copies them from the JWT onto `session.user`. This
means **every server-side permission check is O(1)** — no DB hit per
request.

---

## 8. Data layer (Prisma + SQLite)

The datasource is SQLite in Phase 1 (`db/custom.db`) but the schema is
deliberately written so that a switch to MySQL is a one-line change in
`prisma/schema.prisma` plus a `prisma migrate` run. No application code
depends on SQLite-specific semantics.

Money fields (Decimal) are deferred to Phase 2 — see `DATABASE.md` for the
rationale. Enum-like fields are stored as `String` and validated at the
application layer (Zod in route handlers, plus the `STATUS_VALUES` set in
`[id]/route.ts` files), because SQLite has no native ENUM type. A future
MySQL migration can promote these to native enums without breaking the
Prisma client API.

---

## 9. Authentication flow

```
Browser                       Next.js                Prisma (SQLite)
   |                              |                        |
   |  POST /api/auth/callback/   |                        |
   |  credentials (email, pass)  |                        |
   |---------------------------->|                        |
   |                             |  findUnique(User.email) |
   |                             |----------------------->|
   |                             |<-----------------------|
   |                             |                        |
   |                             | bcrypt.compare(pass,   |
   |                             |   user.passwordHash)   |
   |                             |                        |
   |                             | if (locked || !active) |
   |                             |   audit login_failed   |
   |                             |   return null          |
   |                             |                        |
   |                             | if (!valid)            |
   |                             |   failedLoginAttempts++ |
   |                             |   if (>=5) lockedUntil |
   |                             |   audit login_failed   |
   |                             |   return null          |
   |                             |                        |
   |                             | reset counters, last   |
   |                             | loginAt = now          |
   |                             |                        |
   |                             | loadUserAuthData(uid)  |
   |                             |   -> roles, perms, MD  |
   |                             |                        |
   |                             | audit login            |
   |                             |                        |
   |                             | JWT (8h)               |
   |                             |  - userId              |
   |                             |  - roles               |
   |                             |  - permissions         |
   |                             |  - isMD                |
   |<----------------------------|                        |
   |  Set-Cookie: next-auth.    |                        |
   |  session-token=...          |                        |
```

### Lockout policy

- After **5** consecutive failed attempts the account is locked for **15**
  minutes (`lockedUntil = now + 15min`). Subsequent attempts within the
  lockout window are rejected before the bcrypt compare.
- A successful login resets `failedLoginAttempts` to 0 and clears
  `lockedUntil`.
- An administrator can also clear the lockout via the
  "Reset password" action in the Users view (which sets
  `failedLoginAttempts=0`, `lockedUntil=null`, `mustChangePassword=false`).

### Session lifetime

- JWT strategy, `maxAge = 60 * 60 * 8` (8 hours).
- On sign-out NextAuth's `events.signOut` callback writes a `logout`
  audit entry (best-effort — the JWT may not always carry `userId`).

---

## 10. RBAC model

```
   +----------+  userId    +----------+  roleId      +----------+
   |   User   |<---------->| UserRole  |<------------>|   Role   |
   +----------+  (M:N)     +----------+  (M:N)       +----------+
        |                                                  |
        |                                                  | roleId
        |                                                  v
        |                                          +---------------+
        |                                          | RolePermission|
        |                                          +---------------+
        |                                                  | permissionId
        |                                                  v
        |                                  +--------------+  (module, action)
        |                                  |  Permission  |
        |                                  +--------------+
        |                                                  ^
        |__________________________________________________|
                            |
                            v
                  session.user.permissions[]
                  = [ "users:view", "finance:edit", ... ]
```

- A `User` has many `UserRole` rows; each links to one `Role`.
- A `Role` has many `RolePermission` rows; each links to one `Permission`.
- `Permission` rows are canonical: `(module, action)` pairs from
  `PERMISSION_MODULES × PERMISSION_ACTIONS` (25 × 6 = 150).
- At sign-in, `loadUserAuthData()` flattens the user's roles into a single
  `permissions: string[]` array of `"module:action"` keys, stored in the
  JWT and on `session.user`.
- `requirePermission(module, action)` and `authorize(module, action)` both
  short-circuit when `session.user.isMD === true`.
- The MD role is detected via `roles.includes("md")` in
  `loadUserAuthData()`; the user-role link is also re-checked in the DB
  for the "last MD" guard in Users DELETE/PATCH, so the guard works even
  if the acting user is not the MD themselves.
- **MD-role assignment / revocation guard** (added in Phase 1 audit
  hardening pass): `POST /api/users` and `PUT /api/users/:id/roles`
  fetch the candidate roles' `name` field and reject the request with
  HTTP 403 if any candidate is the `md` role and the acting user is
  not MD. The PUT handler also blocks a non-MD caller from removing
  the MD role from any user, and blocks stripping MD from the last
  remaining MD user regardless of caller. This is the only place in
  the RBAC layer where a permission check is not sufficient — the
  underlying `users:create` / `users:edit` permission permits the
  write, but the specific MD role is gated by an additional
  `ctx.isMD` inspection inside the handler. See `SECURITY.md` §2
  "Privilege escalation prevention" for the full rationale.

### Permission catalogue

Modules (25): `dashboard, finance, accounts, budgets, receivables,
payables, staff, departments, tasks, customers, suppliers, projects,
pipeline, operations, decisions, approvals, assets, documents, reports,
settings, users, roles, audit, notifications, backup`.

Actions (6): `view, create, edit, delete, approve, export`.

Total: 150 permission rows seeded in Phase 1.

### Role matrix (seeded)

| Role | Policy |
| --- | --- |
| `md` | All 150 permissions (MD bypass also short-circuits server checks) |
| `administrator` | Dashboard view/export, settings, users, roles, departments, staff, audit, backup, documents, assets |
| `finance_manager` | Dashboard, finance, accounts, budgets, receivables, payables, reports, approvals |
| `operations_manager` | Dashboard, operations, projects, pipeline, tasks, staff (view), customers, suppliers, approvals |
| `hr_manager` | Dashboard, staff, departments, tasks, reports |
| `project_manager` | Dashboard, projects, pipeline, tasks, customers, reports |
| `employee` | Dashboard (view), tasks (view), documents (view), notifications |

Full per-role permission assignments are in `prisma/seed.ts`.

---

## 11. Audit trail

The `AuditLog` table is **append-only at the application layer**. The only
writer is `recordAudit()` in `src/lib/audit.ts`, which is invoked via:

- `auditFromCtx(ctx, entry)` in every mutation route handler,
- directly in `src/lib/auth.ts` for `login`, `login_failed`, `logout`,
- directly in `src/app/api/notifications/read-all/route.ts` for bulk-mark-read.

There are **no** `POST`/`PATCH`/`DELETE` endpoints on `/api/audit/*`. The
only endpoints are:

- `GET /api/audit?page&pageSize&search&module&action&userId&from&to`
- `GET /api/audit/stats`

Audit entries capture: `userId`, `action` (login/logout/login_failed/create/
update/delete/approve/reject/view_sensitive/export/system), `module`,
`recordId`, `recordType`, `description`, `ipAddress`, `userAgent`,
`previousValue` (JSON string), `newValue` (JSON string), `createdAt`.

`recordAudit()` swallows errors and logs them to stderr — audit failure
must never break the primary operation.

---

## 12. Notification model

`Notification` is a simple in-app message queue keyed to a single `userId`.

- Schema fields: `title`, `message`, `type` (info/warning/error/success),
  `category` (approval/task/invoice/payment/deadline/system/...),
  `linkUrl`, `isRead`, `readAt`, `createdAt`.
- The topbar `notifications-menu.tsx` polls `/api/notifications` (last 30)
  and renders them; "Mark all read" calls `POST /api/notifications/read-all`.
- Phase 1 only seeds two welcome notifications (one for the MD, one for the
  admin). Later phases will write notification rows from approval flows,
  task assignments, invoice due dates, etc.

---

## 13. 10-phase delivery roadmap

| Phase | Modules | Key deliverables |
| --- | --- | --- |
| 1 — Foundation (shipped) | dashboard, users, roles, departments, settings, audit, notifications | Auth, RBAC, audit trail, dashboard shell, 5 admin views |
| 2 — Finance Foundation | finance (income/expenses), accounts, finance categories | Decimal money fields land here (MySQL-ready) |
| 3 — Budgets & AR/AP | budgets, receivables, payables, approvals | Approval workflow; multi-currency on top of `CompanySetting` |
| 4 — People | staff, tasks | Employee CRUD, task assignment, leave |
| 5 — CRM | customers, suppliers | Customer/supplier master data, contacts |
| 6 — Projects | projects, pipeline | Project profitability, pipeline kanban |
| 7 — Operations & Decisions | operations, decisions | Daily ops log, MD decision log |
| 8 — Assets & Documents | assets, documents | File upload validation, asset register |
| 9 — Intelligence | reports | Cross-module reports (P&L, balance sheet, project P&L) |
| 10 — Hardening | backup, PWA, rate-limit | Backup/restore UI, PWA manifest, rate-limit middleware |

---

## 14. Module-dependency diagram

The full LBMS domain model is built around a `Project` hub: every project
brings together a customer, a budget, expenses, income, assigned staff and
tasks, and ultimately rolls up into a profitability number that feeds the
executive dashboard.

```
                       +---------------+
                       |   Customer    |
                       |   (Phase 5)   |
                       +-------+-------+
                               |
                               |  customerId
                               v
+-----------+          +---------------+          +-----------+
|  Budget   |--------->|    Project    |<---------| Income    |
| (Phase 3) |  budgetId|   (Phase 6)   | projectId | (Phase 2)|
+-----------+          +-------+-------+          +-----------+
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
      +---------------+ +--------------+ +-----------+
      |   Expenses    | |    Staff     | |   Tasks   |
      |   (Phase 2)   | |  assignments | | (Phase 4) |
      +---------------+ |   (Phase 4)   | +-----------+
                        +------+-------+
                               |
                               | departmentId / positionId
                               v
                       +---------------+        +-----------+
                       |  Department   |<-------| Position  |
                       |   (Phase 1)   |        | (Phase 1) |
                       +---------------+        +-----------+
                               ^
                               | employeeId
                               |
                       +---------------+
                       |   Employee    |<---+ User (Phase 1)
                       |   (Phase 1)   |
                       +---------------+

         Project -> { budget, expenses[], income[], staff[], tasks[] }
                                |
                                v
                       +---------------+
                       | Profitability |  = sum(income) - sum(expenses) - budget.variance
                       |  (Phase 6)    |
                       +-------+-------+
                               |
                               v
                       +---------------+
                       |   Dashboard   |
                       |  (Phase 1)    |
                       +---------------+
```

Phase 1 ships the bottom-left quadrant of this diagram (Departments,
Positions, Employees, Users) plus the dashboard scaffold and the
administrative spine (roles, permissions, audit, settings, notifications).
Phases 2-10 layer on the modules above the dashed "Phase 1" line.

---

## 15. Cross-cutting concerns

### Theming

- Tailwind 4 + CSS variables; emerald primary, deep slate-teal sidebar
  (deliberately avoiding indigo/blue as primary brand colour per spec).
- Light/dark/system via `next-themes` in `AppProviders`.
- Custom scrollbar styles; sticky footer; mobile-first responsive layout.

### Forms

- `react-hook-form` + `@hookform/resolvers/zod` on the client.
- Mirrored Zod schemas on the server (Route Handlers) so client-side
  validation can never bypass server-side enforcement.

### Toasts

- `sonner` is the only toast system used in views. The legacy
  `src/components/ui/toast.tsx` + `use-toast.ts` from the scaffold is
  retained but not consumed by Phase 1 views.

### Internationalisation

- `next-intl` is in dependencies but Phase 1 is English-only. The
  architecture is ready to add locales in Phase 10 if required.

### Files & uploads

- Phase 1 has no file-upload endpoints. The company-settings view shows a
  disabled "Upload" button for the logo (Phase 10). The `logoUrl` field on
  `CompanySetting` accepts a URL as a Phase 1 fallback.
- File-upload validation (magic-byte check, size limit, MIME whitelist) is
  deferred to Phase 8 (assets & documents) and Phase 10 (logo upload).

---

## 16. Technology decision & production database strategy

This section records the architecture decision that came out of the
Phase 1 audit (audit §8) regarding the technology stack and the
production database choice.

### 16.1 Why the current stack is retained

The deployed stack is **Next.js 16 (App Router) + TypeScript 5 + Prisma 6
+ SQLite + NextAuth v4 + Tailwind CSS 4 + shadcn/ui**, running on Bun (or
Node.js 20+). This stack is **non-negotiable for the deployment
environment** — the runtime is locked to Node/Bun, and PHP / CodeIgniter 3
is not available in the target environment.

The current stack delivers the same modular, secure, auditable
architecture that the original specification requires:

- **Modularity**: the App Router's `src/app/api/*` per-module folder
  structure plus the `?view=` client-side router cleanly separates
  modules. Each later phase adds a new folder under `src/app/api/` and a
  new entry in `src/lib/navigation.ts`.
- **Security**: bcrypt password hashing, NextAuth JWT sessions, server-
  side `authorize()` on every route, append-only audit trail, MD bypass,
  privilege-escalation guards (see §10 above and `SECURITY.md` §2).
- **Auditability**: every mutation writes a `previousValue` + `newValue`
  snapshot to `AuditLog`. Type-safe Prisma queries; no raw SQL anywhere.
- **Type safety end-to-end**: Prisma generates TypeScript types from
  `schema.prisma`; Zod schemas mirror the Prisma types on the request
  side; the NextAuth session is augmented to carry `roles`,
  `permissions`, and `isMD` as typed fields.

### 16.2 SQLite is development-only

SQLite is used for local development and the Phase 1–9 build-out. It is
**not suitable for production multi-user financial workloads** because:

- **Single-writer concurrency**: SQLite serialises writes at the database
  level (one writer at a time). This is fine for an admin system with
  modest write load, but a finance module with concurrent balance
  updates would queue every write.
- **No Decimal precision enforcement**: Prisma's `Decimal` type maps to
  SQLite `TEXT` (the value is stored as a string and parsed by the
  Prisma client at read time). The DB does not reject `123.456789` as
  out-of-precision — it accepts any string. Money math is therefore
  only as precise as the application layer enforces.
- **No row-level locking**: SQLite has no `SELECT ... FOR UPDATE`.
  Concurrent balance updates are serialised at the DB level (correct
  but slow) rather than protected by row locks.

### 16.3 Recommended production databases

The two recommended production databases, in order of preference:

1. **PostgreSQL 16+ (preferred)**:
   - Best-in-class Prisma compatibility.
   - Native `DECIMAL(p,s)` / `numeric` type with DB-level precision
     enforcement.
   - Row-level locking (`SELECT ... FOR UPDATE`) for safe concurrent
     balance updates.
   - JSON column support (useful for structured audit snapshots).
   - Same Prisma client API; only the `datasource` provider changes.

2. **MySQL 8+ (matches the original spec's DB choice)**:
   - Matches the original Lightworld specification's MySQL decision.
   - Native `DECIMAL(p,s)` type.
   - Row-level locking via `SELECT ... FOR UPDATE` (InnoDB).
   - Well-supported by Prisma; widely deployed in production.
   - Native `ENUM` type — the schema's enum-like `String` columns
     (`User.status`, `Department.status`, etc.) can be promoted to
     native MySQL enums during the migration.

Both migrate cleanly from the current Prisma schema. See §16.4 below.

### 16.4 Prisma schema migration cleanliness

The Phase 1 schema uses only **portable Prisma types**: `String`,
`Int`, `Boolean`, `DateTime`, and `@default(cuid())` IDs. No SQLite-
specific features are used (`@db.Text`, `@db.VarChar`, native enums,
composite indexes with native collations — none of these appear).

The `datasource` provider can be switched from `sqlite` to
`postgresql` or `mysql` with **zero schema changes** for the Phase 1
tables. The migration is therefore:

1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"   // or "mysql"
     url      = env("DATABASE_URL")
   }
   ```
2. Run `bun run db:migrate` (creates a migration in
   `prisma/migrations/`).
3. Run `bun run db:seed` against the new database.
4. Re-run `bunx prisma generate`.

No application code changes are required. The Prisma client API is
identical for all three providers.

**Phase 2 caveat**: the finance tables will introduce
`Decimal @db.Decimal(18,2)` for money columns. This native-type
extension requires the `mysql` or `postgresql` provider — it will not
work on `sqlite`. This is the explicit reason money fields are deferred
to Phase 2 (so they land with proper DB-level precision from day one).

### 16.5 SQLite-specific migration risks

When the Phase 2 migration to MySQL/Postgres happens, the following
SQLite-specific behaviours must be considered:

- **`Decimal` type**: Prisma maps `Decimal` to `TEXT` in SQLite (no
  precision enforcement) but to `DECIMAL(p,s)` in MySQL/Postgres. In
  dev the app layer must validate precision; in production the DB
  enforces it natively. Any existing dev data with out-of-precision
  Decimals would fail the migration.
- **No native enums**: the schema uses `String` + app-layer validation
  (Zod `z.enum(...)` in mutation routes, `STATUS_VALUES` Set in
  `[id]/route.ts` files). Prisma `enum` types are available on
  MySQL/Postgres; a future migration could promote status/action fields
  to native enums (optional, not blocking).
- **No row-level locking**: concurrent balance updates in SQLite are
  serialised at the DB level (correct but slow). Production must use
  MySQL/Postgres with `$transaction` + appropriate isolation
  (`SERIALIZABLE` or `SELECT ... FOR UPDATE`).
- **No `@db.Decimal`, `@db.VarChar` native type extensions** in SQLite.
  Any such annotations added in Phase 2 will silently not apply on
  SQLite, so dev with SQLite would not catch precision violations. The
  recommendation is to migrate to MySQL/Postgres **before** Phase 2
  lands.

---

## 17. Financial architecture readiness

The current Phase 1 architecture supports the future financial system
**without redesign**. This section documents how the existing schema and
service layer will host the Phase 2 finance modules.

### 17.1 Stable tables (no changes in Phase 2+)

The following Phase 1 tables are referenced by the future finance system
and will **not** be modified:

- `User` — every financial transaction is created by and audited against
  a `User`. The `createdById` self-relation pattern is reused for
  finance records.
- `Department` — finance reports group by department; project expenses
  may reference a department.
- `AuditLog` — every financial mutation writes a `previousValue` +
  `newValue` snapshot. `recordAudit()` is the only writer.
- `CompanySetting` — currency, invoice prefix, financial year start.
  Phase 2 reads but does not modify this row.
- `Notification` — approval flows, invoice due dates, and payment
  reminders write rows here.

### 17.2 New tables added in Phase 2

Phase 2 will **add** the following tables (none requires modifying
existing tables):

- `Account` — cash & bank accounts. Has `openingBalance` (Decimal),
  `currency`, `type` (cash/bank/mobile_money). All financial
  transactions reference an Account.
- `Category` — income categories and expense categories. Used to
  classify transactions for reporting.
- `Customer` (Phase 5) and `Supplier` (Phase 5) — master data for AR/AP.
- `Project` (Phase 6) — projects that income/expenses can be attributed
  to for profitability analysis.
- `Transaction` — the ledger row. Polymorphic-ish: `type` field
  (`income | expense | transfer | adjustment`), `amount` (Decimal),
  `accountId` (FK), `categoryId` (FK), `createdById` (FK to User),
  optional `customerId`, `supplierId`, `projectId`, `departmentId`.

The `cuid()` ID strategy used throughout Phase 1 is suitable for the
ledger — ledger rows are immutable once written and never need
sequential IDs.

### 17.3 The balance-derivation principle (key invariant)

**Account balances MUST be derived, never stored as a mutable field
updated by writes.** The displayed balance of an Account at any time T
is:

```
balance(T) = openingBalance
           + sum(amount for transactions where type = 'income'  and createdAt <= T)
           - sum(amount for transactions where type = 'expense' and createdAt <= T)
```

This principle preserves financial integrity and auditability:

- The balance is always recomputable from immutable history. An
  attacker who modifies the balance column cannot hide the discrepancy —
  the derived total will diverge from the stored total.
- The audit trail's `previousValue`/`newValue` snapshots capture every
  transaction; the running balance is a pure function of the audit
  trail.
- Period-close operations can freeze a balance snapshot (cache the
  derived value at close time) without ever writing the balance back
  to the Account row as a "current" field.

Phase 2 may add a cached `currentBalance` field on `Account` for
dashboard performance, but it MUST be a derived read-model updated by
the same transaction that writes the Transaction row — never directly
writable by the API.

### 17.4 Transaction-wrapping requirement

Every financial mutation that affects a balance MUST:

1. Run inside a `db.$transaction([...])` call. The Phase 1 codebase
   already establishes this pattern — `POST /api/users` (user + role
   assignments) and `PUT /api/users/:id/roles` (delete-many + create-
   many) both wrap their multi-step writes in `$transaction`.
2. Reference `Account`, `Category`, and `User` (the creator). Optional
   references: `Customer`, `Supplier`, `Project`, `Department`.
3. Write an `AuditLog` entry via `auditFromCtx()` with `previousValue`
   (the prior account state) and `newValue` (the post-transaction
   state). Phase 1's `auditFromCtx()` helper already serialises
   `previousValue` and `newValue` as JSON strings and is the canonical
   way to capture this.
4. Use `Decimal` math via Prisma (which serialises correctly to MySQL
   `DECIMAL(p,s)` / Postgres `numeric`). Never use floating-point
   (`Number` in TypeScript, `REAL` in SQLite) for money math.

### 17.5 Concurrency

Prisma `$transaction` is already established in Phase 1 (used in user
creation and role replacement). Finance will use it for all balance-
affecting operations. On MySQL/Postgres, the transaction isolation
level should be `SERIALIZABLE` for balance-affecting writes, or the
transaction should `SELECT ... FOR UPDATE` on the affected `Account`
row before writing the `Transaction` row. SQLite's serialised writes
already provide this guarantee in dev, but at the cost of throughput.

---

## 18. Phase 2 — Finance Foundation Architecture

Phase 2 ships the LBMS finance core as a journal/ledger double-entry
system. This section documents the runtime architecture of the finance
modules: the data model, the posting engine, the reporting service,
and the cross-cutting accounting decisions.

### 18.1 Data model — journal/ledger double-entry

```
FinancialAccount      LedgerAccount
(cash / bank / momo)  (income/expense/asset/liability/equity)
        |                     |
        v                     v
        +-------> Journal <---+
                     |  (one financial event; header)
                     v
                JournalEntry[]   (>= 2 lines; Σ(debit) = Σ(credit))
                     |
                     v
               Reporting Service  (single source of truth)
                     |
                     v
        Dashboard / Reports / Exports
```

A `Journal` is ONE financial event (an income receipt, an expense
payment, a transfer, an opening balance, or an adjustment). Each
journal owns two or more `JournalEntry` rows. Each entry has exactly
one non-zero side (debit OR credit) — the other is zero. The journal
is balanced when the sum of debits equals the sum of credits across
all its entries.

`JournalEntry.financialAccountId` is OPTIONAL. Only entries that move
money in/out of a cash/bank/momo account reference a `FinancialAccount`.
The counter-side (an income category credit, or an expense category
debit) references only a `LedgerAccount`. This mirrors real accounting
where income/expense categories are not "accounts you hold money in"
— they are reporting buckets, not cash pools.

### 18.2 The posting engine (`src/lib/finance/posting-engine.ts`)

The posting engine is THE single authoritative poster. There is
exactly one function in the codebase that creates `Journal` +
`JournalEntry` rows: `postJournal()`. All income/expense/transfer API
routes delegate to it. The operation is atomic — either the whole
journal posts or nothing does.

Posting flow:

1. Validate `transactionType` against `TRANSACTION_TYPES`.
2. Validate `transactionDate` (reject NaN + > 1 year in the future).
3. Normalize the entries: every entry must have exactly one non-zero
   side (debit XOR credit); both-zero and both-non-zero are rejected;
   negatives are rejected; amounts rounded to 2 dp.
4. Verify the entries balance: Σ(debit) = Σ(credit); a zero-total
   journal is rejected.
5. Open a `db.$transaction`. Inside it:
   a. Validate every referenced `FinancialAccount` exists, is not
      soft-deleted, has `status = "active"`, and all referenced
      accounts share one currency (Phase 2 does not support cross-
      currency journals).
   b. Validate every referenced `LedgerAccount` exists + is active.
   c. Generate the next reference number from `FinanceRefCounter`
      (incremented inside the same transaction so concurrent inserts
      cannot collide).
   d. Create the `Journal` row + nested `JournalEntry` rows in one
      Prisma write. Set `postedAt = now()` for posted journals.
6. Write an `AuditLog` entry via `recordAudit()` AFTER the transaction
   commits (audit failure never rolls back the posting — the posting
   is the source of truth; audit is best-effort per `recordAudit`).

Convenience builders wrap `postJournal`:

- `postIncome(amount, financialAccount, ledgerAccount, ...)` — debits
  the financial account (asset up), credits the income ledger. The
  credit-side entry has NO `financialAccountId` (income is a reporting
  bucket, not cash).
- `postExpense(amount, financialAccount, ledgerAccount, ...)` — debits
  the expense ledger, credits the financial account (asset down). The
  debit-side entry has NO `financialAccountId`.
- `postTransfer(amount, fromAccount, toAccount, ...)` — debits the
  to-account, credits the from-account. Both entries reference a
  financial account. Neither income nor expense is affected.

### 18.3 The reporting service (`src/lib/finance/reporting.ts`)

The reporting service is THE single source of truth for balances and
summaries. The dashboard, the finance overview, the reports view, and
CSV exports ALL consume these functions. No separate calculation logic
exists anywhere else — there is no parallel "dashboard balance" path.

Key exports:

- `getAccountBalance(accountId)` — the derived balance of one
  FinancialAccount.
- `listAccountBalances()` — derived balances for all accounts (one
  aggregated query, no N+1).
- `getTotalCashPosition()` — sum of all account balances.
- `getFinanceSummary(range)` — `totalIncome`, `totalExpenses`,
  `netMovement`, `cashPosition`, `incomeByType[]`, `expenseByType[]`,
  `transactionCount` for a date range.
- `getCashFlowSeries(months)` — monthly income vs expense for charts.
- `listTransactions(filters)` — paginated, filtered journal list.
- `getTransactionDetail(id)` — one journal with its full entry
  breakdown + reversal links.
- `runReconciliation()` — verifies every posted journal still balances
  (a diagnostic; in a healthy system it returns zero issues).

### 18.4 Balance derivation formula

Account balances are DERIVED from posted `JournalEntry` rows — there
is no mutable `currentBalance` field. For an asset account
(debit-normal) the balance is:

```
balance(accountId) = Σ(debit)  -  Σ(credit)
                    for JournalEntry rows where
                      journalId IN (journals with status 'posted' OR 'reversed')
                      AND financialAccountId = accountId
```

The opening balance is posted as an `OPENING_BALANCE` journal entry
(the account-creation POST atomically creates the account + the
opening journal), so it is already in the debit/credit totals. The
`openingBalance` field on `FinancialAccount` is metadata — the seed
value used to generate the opening journal. The reporting functions
do NOT add `openingBalance` again to the derived total (that would
double-count).

### 18.5 Reversal semantics

Posted journals CANNOT be deleted. The `reverseJournal()` function
in the posting engine:

1. Loads the original journal + its entries inside `db.$transaction`.
2. Rejects if the original's status is not `posted`.
3. Rejects if a reversal already exists (one reversal per original).
4. Mirrors the entries: every `debit` becomes a `credit` and vice
   versa.
5. Creates a new `Journal` with `transactionType` matching the
   original, `status = "posted"`, `reversesId = original.id`,
   `reversalReason = args.reason`, `transactionDate = now`.
6. Updates the original: `status = "reversed"` and connects
   `reversedBy` to the new reversal (the `reversedBy` inverse relation
   is virtual — it carries no fields).

The original journal is preserved. Both the original and the reversal
participate in balance derivation (they net to zero, which is the
correct accounting outcome). The reversal reason is captured for the
audit trail; the reversal reason is also stored on the reversal
journal's `notes` field for display.

### 18.5.A Void semantics (Phase 2A)

Phase 2A adds the `void` status transition alongside `reverse`. The
`voidJournal()` function in the posting engine:

1. Loads the journal inside `db.$transaction`.
2. Rejects if the journal's status is not `posted` (`DRAFT`,
   `VOIDED`, and `REVERSED` journals cannot be voided).
3. Updates the original in place: `status = "voided"`,
   `voidedAt = now`, `voidedById = args.createdById`. The void
   reason is captured in the existing `notes` field for display.

Unlike reversal, void does NOT create a mirrored counter-journal. It
nullifies the original in place: the journal's rows remain for audit
but are excluded from balance derivation (the reporting service's
`POSTED_WHERE` filter accepts only `posted` and `reversed` statuses,
so `voided` journals are ignored). This makes void suitable for
duplicate/mistaken postings that have not yet been reconciled, where
a mirrored counter-entry would be noise. Reversal remains the
correct tool for posted transactions that need a traceable
counter-entry (e.g. an accounting correction that should be visible
in the journal stream).

The endpoint `POST /api/finance/transactions/[id]/void` requires the
`finance:void` permission and a `reason` (min 3 chars, Zod-validated)
and includes idempotency (see §18.5.B below).

### 18.5.B Idempotency protocol (Phase 2A)

Phase 2A wires the `FinanceIdempotencyLog` table (which shipped empty
in Phase 2) into every mutating finance endpoint. The helper module
`src/lib/finance/idempotency.ts` exposes `checkIdempotency()`,
`cacheIdempotencyResponse()`, and `pruneExpiredIdempotencyRecords()`.

**Header**: optional `Idempotency-Key` on the request. When absent
the request proceeds normally with no idempotency protection (the
header is optional but recommended for every mutating finance call).

**Claim-then-execute pattern** (rather than wrapping the financial
mutation in the same DB transaction as the idempotency record):

1. `checkIdempotency(req, userId, body)` runs BEFORE the mutation.
   The key is read from the `Idempotency-Key` header. The body is
   SHA-256 hashed together with `userId` to form `responseHash`.
2. A `FinanceIdempotencyLog` row is inserted with `key`, `userId`,
   `responseHash`, an empty `responseBody`, `statusCode = 0` (sentinel
   for "pending"), and `expiresAt = now + 24h`.
3. If the insert succeeds (unique constraint on `key` not violated),
   this request owns the key. Proceed to execute the mutation.
4. If the insert fails with a unique-constraint violation, a previous
   request has already claimed this key. The existing row is loaded:
   - If `responseHash` differs from the current request → HTTP 409
     Conflict with `code = "IDEMPOTENCY_CONFLICT"` (same key,
     different payload — client should use a new key for a different
     request).
   - If `statusCode = 0` (the original is still in-flight) → HTTP 409
     Conflict with `code = "IDEMPOTENCY_PENDING"` (true concurrency;
     client should retry shortly).
   - Otherwise → replay the cached `responseBody` with the original
     `statusCode`. No new journal is created.
5. After the mutation completes (success OR client-side error),
   `cacheIdempotencyResponse(key, statusCode, body)` updates the row
   with the final response. Caching client-side errors (4xx) is
   intentional: a retry with the same key returns the same error,
   which is the desired behaviour (the client should use a new key
   for a genuine retry after fixing the input).
6. `pruneExpiredIdempotencyRecords()` deletes rows where
   `expiresAt < now`. It is defined but not yet scheduled by a cron
   in Phase 2A (expired rows are also filtered out at lookup time so
   this is hygiene, not correctness).

**TTL**: 24 hours from the claim time. After expiry the row is
eligible for pruning; a request that arrives with an expired key is
treated as if the row does not exist (the request re-executes).

**Endpoints covered** (all 5 mutating finance endpoints): income
POST, expenses POST, transfers POST, accounts POST (opening balance),
transactions/[id]/reverse POST, transactions/[id]/void POST.

**Why claim-then-execute and not "same transaction"**: the posting
engine manages its own `db.$transaction` for atomicity of the
journal+entries. Wrapping the idempotency claim inside that
transaction would require the engine to accept an external
transaction handle, coupling it to the HTTP layer. The claim-then-
execute pattern keeps the posting engine HTTP-agnostic while still
guaranteeing that under concurrent duplicate requests exactly one
request wins the claim and the others receive either a cached
response or a 409.

### 18.5.C Opening-balance routing through the engine (Phase 2A)

Phase 2 shipped the account-creation POST with an inline
`db.$transaction` that created the `OPENING_BALANCE` journal directly.
This bypassed the posting engine — meaning opening balances were not
subject to the same validation, reference generation, and audit
pipeline as every other posting.

Phase 2A closes this gap. The new `postOpeningBalance()` function in
the posting engine is now the single entry point for opening-balance
journals. The accounts POST route calls it after creating the
`FinancialAccount` row. `postOpeningBalance()` is a thin convenience
wrapper around `postJournal()`: it accepts `amount`,
`financialAccountId` (the account being opened), `ledgerAccountId`
(the equity ledger account — typically `EQT-OWNER`), an optional
`assetLedgerAccountId` (typically `AST-CASH`, attached to the debit
side so the entry has a ledger attribution), and constructs the
two-entry balanced journal (debit the new account, credit equity).

As a result, ALL financial posting — income, expense, transfer,
opening balance — flows through `postJournal()`. Validation, the
Σ(debit) = Σ(credit) check, concurrency-safe reference generation,
`db.$transaction` atomicity, and `recordAudit()` logging are now
identical for every posting type.

### 18.5.D OPB reference counter sync in the seed (Phase 2A)

The seed posts opening-balance journals directly during seeding
(before the posting engine existed). With Phase 2A's rewiring, the
engine's first runtime-generated `OPB-<YEAR>-<SEQ>` reference would
collide with the seeded references — the engine increments
`FinanceRefCounter.nextNumber` inside its transaction, but the seed
was writing OPB journals without touching that counter.

Phase 2A fixes `prisma/seed.ts` to upsert the `OPB` row of
`FinanceRefCounter` to `openingCount + 1` (where `openingCount` is
the number of seeded opening-balance journals) at the end of the
seed. This brings the counter into sync with the seeded journals,
so the engine's first runtime OPB reference is the next free
sequence.

The reset/reseed procedure for the dev database is now:

```bash
rm -f db/custom.db && bun run db:push && bun run db:seed
```

This is documented as part of the Phase 2A clean-baseline reset.

### 18.6 Money precision strategy

- All money is `Prisma.Decimal` (decimal.js under the hood) on the
  server. Never `Number` (float).
- `toMoney()` parses strings/numbers/Decimals into a `Decimal`,
  rejecting NaN and non-numeric input via `MoneyError`.
- `toPositiveMoney()` requires `> 0` and rounds to 2 dp.
- `roundMoney()` rounds to 2 dp with `ROUND_HALF_UP`.
- `serializeMoney()` returns a STRING ("5000.00") for JSON transport.
  The client receives exact precision; no `5000.000000000001` style
  float corruption is possible.
- `formatMoney(value, currency)` returns "GHS 5,000.00" for human
  display. The client uses this for display only — never parses for
  calculation.

On SQLite, Prisma `Decimal` is stored as TEXT — the DB does not enforce
precision, so the app layer is the source of truth. On PostgreSQL/
MySQL the same column migrates to `DECIMAL(18,2)` natively. The
`@db.Decimal(18,2)` annotation is intentionally omitted from the
schema so the same `schema.prisma` works on both providers without
modification.

### 18.7 Currency strategy

- GHS is the default currency (`CompanySetting.currency`).
- Every `FinancialAccount` and `LedgerAccount` carries a `currency`
  field (3-letter ISO code, default `"GHS"`).
- The posting engine rejects journals whose entries reference financial
  accounts with mismatched currencies (cross-currency not supported in
  Phase 2).
- Every `JournalEntry` carries a `currency` field (mirrors the
  journal's currency).
- Currency is configurable via `CompanySetting`. A future Phase 3 may
  add multi-currency conversion support.

### 18.8 Concurrency-safe reference numbering

Every journal gets a human-readable reference of the form
`<PREFIX>-<YEAR>-<6-digit-sequence>` (e.g. `INC-2026-000001`). The
prefix is derived from `transactionType` via `REF_PREFIXES`
(`income=INC`, `expense=EXP`, `transfer=TRF`,
`opening_balance=OPB`, `adjustment=ADJ`).

The `FinanceRefCounter` table holds one row per `(prefix, year)`. The
posting engine increments `nextNumber` via Prisma's `upsert` with
`{ increment: 1 }` **inside the same `db.$transaction` that creates
the journal**. SQLite serialises writes so this is safe in dev; on
PostgreSQL/MySQL the same code path benefits from row-level locking
automatically (the `upsert` acquires an exclusive lock on the
counter row).

### 18.9 Customer / Supplier / Project integration points

The `Journal` model carries nullable stub fields for future Phase 5
(Customer/Supplier) and Phase 6 (Project) integration:

- `partyType` (`customer` | `supplier` | `null`)
- `partyRef` (String; future FK to `Customer.id` / `Supplier.id`)
- `projectRef` (String; future FK to `Project.id`)

These fields are NULL by default in Phase 2. When Phase 5 / 6 ship,
the new entities populate `partyRef` / `projectRef` and `partyType`
without any schema migration on `Journal`. The income and expense
API routes already accept an optional `partyRef` / `projectRef` in
their request bodies (typed as `string` for now; validation will be
tightened in Phase 5/6).

### 18.10 Phase 2 impact on the technology decision

The Phase 1 audit (§16 above) recommended migrating to PostgreSQL/MySQL
**before** Phase 2 so that money precision lands correctly. Phase 2
was built on SQLite anyway because the deployment environment does
not provide PostgreSQL or MySQL. The decision and its trade-offs:

- **SQLite remains the dev database** (environment constraint).
- **Prisma `Decimal` is used for all money** without the
  `@db.Decimal(18,2)` annotation. The schema works on both SQLite
  (stored as TEXT, validated at the app layer) and PostgreSQL/MySQL
  (stored as `DECIMAL(18,2)`, enforced at the DB layer) with no
  modification.
- **App-layer validation** (`toMoney`, `toPositiveMoney`,
  `roundMoney`) enforces precision in dev so out-of-precision values
  never reach the wire format.
- **Production MUST use PostgreSQL 16+ or MySQL 8+** for: row-level
  locking on concurrent balance updates, DB-level Decimal precision
  enforcement, and proper transaction isolation. The schema is
  migration-ready: switch `provider = "postgresql"` (or `"mysql"`)
  and run `prisma migrate` — no schema changes needed.
- The §16.5 "Phase 2 caveat" that recommended migrating **before**
  Phase 2 is now superseded — Phase 2 deliberately accepted the
  SQLite risk because the deployment environment requires it, and
  mitigated it with app-layer validation and a portable schema.
