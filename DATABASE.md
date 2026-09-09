# Database

This is the Phase 1 data dictionary for LBMS. The schema is defined in
`prisma/schema.prisma` and uses SQLite as the active datasource (with a
MySQL-compatible schema — see §10 below).

---

## 1. Datasource

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

- `DATABASE_URL` is set in `.env` to `file:./db/custom.db`.
- The Prisma client is generated into `node_modules/.prisma/client` and
  re-exported from `src/lib/db.ts` as a singleton.
- Schema is applied via `bun run db:push` (`prisma db push --accept-data-loss`)
  in development. See `DEPLOYMENT.md` for migration procedures.

---

## 2. Models (alphabetical)

### 2.1 `AuditLog`

Immutable record of important actions. Append-only at the application layer.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `userId` | String? | nullable; FK to `User.id` (`onDelete: SetNull`) |
| `user` | User? | relation back to User |
| `action` | String | one of `login | logout | login_failed | create | update | delete | approve | reject | view_sensitive | export | system` |
| `module` | String | `auth | users | roles | settings | departments | positions | employees | notifications | system | ...` |
| `recordId` | String? | nullable |
| `recordType` | String? | nullable; e.g. `User`, `Role`, `Department`, `Position`, `CompanySetting`, `RolePermission`, `seed` |
| `description` | String? | human-readable summary |
| `ipAddress` | String? | from `x-forwarded-for` / `x-real-ip` |
| `userAgent` | String? | from `user-agent` header |
| `previousValue` | String? | JSON string of prior state |
| `newValue` | String? | JSON string of new state |
| `createdAt` | DateTime | `@default(now())` |

**Indexes**: `@@index([userId])`, `@@index([module])`, `@@index([createdAt])`.

**Immutability convention**: there is **no** Prisma `update` or `delete`
call against `AuditLog` anywhere in the codebase. The only writer is
`recordAudit()` in `src/lib/audit.ts`, which is invoked from `auditFromCtx()`
in route handlers and directly in `src/lib/auth.ts`. There are also no
`POST`/`PATCH`/`DELETE` HTTP endpoints on `/api/audit`.

### 2.2 `CompanySetting`

Single-row configuration table (singleton pattern).

| Field | Type | Default |
| --- | --- | --- |
| `id` | String | `@default("singleton")` — the row always has `id = "singleton"` |
| `companyName` | String | `@default("Lightworld Tech")` |
| `legalName` | String? | |
| `logoUrl` | String? | |
| `address` | String? | |
| `city` | String? | |
| `region` | String? | |
| `country` | String | `@default("Ghana")` |
| `phone` | String? | |
| `email` | String? | |
| `website` | String? | |
| `currency` | String | `@default("GHS")` — 3-letter ISO code, uppercased |
| `currencySymbol` | String | `@default("GH₵")` |
| `financialYearStart` | String? | `MM-DD` format (e.g. `"01-01"`) |
| `invoicePrefix` | String | `@default("INV-")` |
| `invoiceStart` | Int | `@default(1)` |
| `taxIdNumber` | String? | |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |

**Singleton convention**: the row with `id = "singleton"` is the only row.
`GET /api/company-settings` creates it with defaults if it is missing
(defensive — the seed already creates it). `PUT /api/company-settings`
upserts onto the singleton key. There is no list endpoint and no `id`
parameter — the singleton id is hard-coded.

### 2.3 `Department`

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `name` | String | `@unique` |
| `code` | String? | `@unique`; uppercased on write |
| `description` | String? | |
| `headEmployeeId` | String? | nullable — reserved for Phase 4 staff module |
| `status` | String | `@default("active")` — `active | inactive` |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `employees Employee[]`, `positions Position[]`.

**Soft-delete**: DELETE sets `deletedAt = now()` and `status = "inactive"`.
DELETE is blocked when active employees or positions are attached.

### 2.4 `Employee`

Phase 1 creates exactly one Employee row (the MD's employee profile) via
the seed. Full CRUD lands in Phase 4.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `employeeId` | String | `@unique` — human-readable, e.g. `LT-EMP-0001` |
| `fullName` | String | |
| `gender` | String? | `male | female | other` |
| `phone` | String? | |
| `email` | String? | `@unique` |
| `address` | String? | |
| `departmentId` | String? | FK to `Department.id` (`onDelete: SetNull`) |
| `department` | Department? | relation |
| `positionId` | String? | FK to `Position.id` (`onDelete: SetNull`) |
| `position` | Position? | relation |
| `employmentDate` | DateTime? | |
| `employmentType` | String? | `full_time | part_time | contract | intern` |
| `status` | String | `@default("active")` — `active | on_leave | suspended | resigned | terminated | inactive` |
| `notes` | String? | |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `user User?` (one-to-one — the linked User account, if any).

**Indexes**: `@@index([departmentId])`, `@@index([status])`.

### 2.5 `Notification`

In-app notification queue.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `userId` | String | FK to `User.id` (`onDelete: Cascade`) |
| `user` | User | relation |
| `title` | String | |
| `message` | String | |
| `type` | String | `@default("info")` — `info | warning | error | success` |
| `category` | String? | `approval | task | invoice | payment | deadline | system | ...` |
| `linkUrl` | String? | optional deep link |
| `isRead` | Boolean | `@default(false)` |
| `readAt` | DateTime? | |
| `createdAt` | DateTime | `@default(now())` |

**Indexes**: `@@index([userId, isRead])`, `@@index([createdAt])`.

### 2.6 `Permission`

Canonical catalogue of `(module, action)` pairs.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `module` | String | one of `PERMISSION_MODULES` (25 values) |
| `action` | String | one of `PERMISSION_ACTIONS` (6 values) |
| `description` | String? | human-readable, set by the seed |

**Constraints**: `@@unique([module, action])`, `@@index([module])`.

The seed creates exactly `25 × 6 = 150` rows. There is no API to mutate this
table — the catalogue is canonical and only changes when `PERMISSION_MODULES`
or `PERMISSION_ACTIONS` change in `src/lib/permissions.ts`.

### 2.7 `Position`

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `title` | String | `@unique` |
| `departmentId` | String? | FK to `Department.id` (`onDelete: SetNull`) |
| `department` | Department? | relation |
| `description` | String? | |
| `status` | String | `@default("active")` — `active | inactive` |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `employees Employee[]`.

**Soft-delete**: DELETE sets `deletedAt = now()` and `status = "inactive"`.
Blocked when active employees are attached.

### 2.8 `Role`

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `name` | String | `@unique`; regex `^[a-z][a-z0-9_]*$` |
| `displayName` | String | human-readable, e.g. "Managing Director" |
| `description` | String? | |
| `isSystem` | Boolean | `@default(false)` — system roles cannot be deleted |
| `createdById` | String? | FK to `User.id` (`onDelete: SetNull`) |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; **not used for soft-delete** (see below) |

**Relations**: `permissions RolePermission[]`, `users UserRole[]`.

**Delete convention**: roles are **hard-deleted** (not soft-deleted). DELETE
is blocked when `isSystem = true` or when the role has any users assigned.
The cascade in the schema removes `RolePermission` and `UserRole` rows
automatically. The `deletedAt` column is retained so the create endpoint
can restore a previously soft-deleted role name without colliding with the
`@unique` constraint — but in practice the seed and the create endpoint
never set `deletedAt` on a Role.

### 2.9 `RolePermission`

Join table between `Role` and `Permission`.

| Field | Type | Constraints |
| --- | --- | --- |
| `roleId` | String | FK to `Role.id` (`onDelete: Cascade`) |
| `permissionId` | String | FK to `Permission.id` (`onDelete: Cascade`) |
| `role` | Role | relation |
| `permission` | Permission | relation |
| `assignedAt` | DateTime | `@default(now())` |
| `assignedById` | String? | FK to `User.id` (no relation defined — informational) |

**Primary key**: `@@id([roleId, permissionId])` — composite.

### 2.10 `User`

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `email` | String | `@unique`; lowercased on write |
| `username` | String | `@unique` |
| `passwordHash` | String | bcrypt hash (cost 10); **never returned by any API** |
| `employeeId` | String? | `@unique`; FK to `Employee.id` (`onDelete: SetNull`) |
| `employee` | Employee? | relation |
| `status` | String | `@default("active")` — `active | inactive | suspended` |
| `lastLoginAt` | DateTime? | |
| `lastLoginIp` | String? | |
| `failedLoginAttempts` | Int | `@default(0)` |
| `lockedUntil` | DateTime? | |
| `mustChangePassword` | Boolean | `@default(false)` |
| `createdById` | String? | FK to `User.id` (`onDelete: SetNull`); self-relation |
| `createdBy` | User? | relation "UserCreatedBy" |
| `usersCreated` | User[] | relation "UserCreatedBy" |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `userRoles UserRole[]`, `auditLogs AuditLog[]`,
`notifications Notification[]`.

**Indexes**: `@@index([status])`, `@@index([createdById])`.

**Soft-delete convention**: DELETE sets `deletedAt = now()`,
`status = "inactive"`, and `employeeId = null` (so the linked Employee
becomes free to re-link to a new user — SQLite's `@unique` on
`User.employeeId` would otherwise trap the Employee record). The audit log
captures the prior `employeeId` link via `previousValue`.

### 2.11 `UserRole`

Join table between `User` and `Role`.

| Field | Type | Constraints |
| --- | --- | --- |
| `userId` | String | FK to `User.id` (`onDelete: Cascade`) |
| `roleId` | String | FK to `Role.id` (`onDelete: Cascade`) |
| `user` | User | relation |
| `role` | Role | relation |
| `assignedAt` | DateTime | `@default(now())` |
| `assignedById` | String? | FK to `User.id` (informational) |

**Primary key**: `@@id([userId, roleId])` — composite.

---

## 3. Entity-relationship description

```
User ─< UserRole >─ Role ─< RolePermission >─ Permission
  |                                                    |
  |  employeeId (1:1)                                  |
  v                                                    |
Employee >── Department ───< Position                  |
  |            |             |                          |
  |            |  positions |                          |
  |            v            v                          |
  |     Department ─< Position ─< Employee             |
  |                                                    |
  |<──── Notification                                  |
  |                                                    |
  └──── AuditLog (FK userId, onDelete: SetNull) ───────┘

CompanySetting (singleton, no FKs)
```

Key cardinalities:

- `User ↔ Role` is many-to-many through `UserRole`.
- `Role ↔ Permission` is many-to-many through `RolePermission`.
- `User ↔ Employee` is one-to-one (`User.employeeId` is `@unique`).
- `Department → Position → Employee` is a hierarchy; `Department.headEmployeeId`
  is reserved for Phase 4 (no FK relation defined yet).
- `Employee → Department` and `Employee → Position` are nullable
  (`onDelete: SetNull`).
- `AuditLog → User` is nullable (`onDelete: SetNull`) so audit entries
  survive user deletion.
- `Notification → User` is non-nullable with `onDelete: Cascade` so
  notifications are cleaned up when a user is hard-deleted (soft-deleted
  users keep their notifications).

---

## 4. Seed data (`prisma/seed.ts`)

The seed is idempotent — every record is created with `upsert`. Re-running
`bun run db:seed` is safe and will not duplicate rows.

### 4.1 Permissions — 150 rows

25 modules × 6 actions = 150 canonical `Permission` rows.

Modules (in canonical order from `PERMISSION_MODULES`):

```
dashboard, finance, accounts, budgets, receivables, payables, staff,
departments, tasks, customers, suppliers, projects, pipeline, operations,
decisions, approvals, assets, documents, reports, settings, users, roles,
audit, notifications, backup
```

Actions: `view, create, edit, delete, approve, export`.

### 4.2 Roles — 7 system roles

All seven are seeded with `isSystem = true`. The MD role has the wildcard
policy (`"*"`); the others have an explicit per-module policy.

| Role name | Display name | Description |
| --- | --- | --- |
| `md` | Managing Director | Full access to every module and all data. |
| `administrator` | Administrator | System administration: users, roles, settings, backup. Restricted financial authoring. |
| `finance_manager` | Finance Manager | Finance, budgets, receivables, payables and financial reports. |
| `operations_manager` | Operations Manager | Operations, projects, tasks and operational reports. |
| `hr_manager` | HR / Staff Manager | Staff, departments, positions and HR reports. |
| `project_manager` | Project Manager | Projects, project finances and project reports. |
| `employee` | Employee | Limited access: own tasks, documents and notifications only. |

Per-role permission policies are defined in `prisma/seed.ts`. The MD
(`"*"`) gets all 150 permissions; the others get a curated subset.

### 4.3 Departments — 7

| Name | Code | Positions |
| --- | --- | --- |
| Management | `MGMT` | Managing Director, Executive Assistant |
| Finance | `FIN` | Finance Manager, Accountant, Finance Officer |
| Operations | `OPS` | Operations Manager, Operations Officer, Field Technician |
| Sales | `SAL` | Sales Manager, Sales Executive |
| Marketing | `MKT` | Marketing Manager, Marketing Officer |
| Technical | `TECH` | Technical Lead, Engineer, Technician |
| Administration | `ADMIN` | Administrator, Receptionist, Office Assistant |

### 4.4 Positions — 18

Sum of the position counts in the table above (2+3+3+2+2+3+3 = 18). Each is
created with `status = "active"` and linked to its department.

### 4.5 Company settings — singleton

```json
{
  "id": "singleton",
  "companyName": "Lightworld Tech",
  "legalName": "Lightworld Tech Ltd",
  "address": "Accra",
  "city": "Accra",
  "region": "Greater Accra",
  "country": "Ghana",
  "phone": "+233 000 000 000",
  "email": "info@lightworld.tech",
  "currency": "GHS",
  "currencySymbol": "GH₵",
  "invoicePrefix": "INV-",
  "invoiceStart": 1
}
```

### 4.6 Default users — 2

| Email | Username | Password (seeded) | Employee | Role |
| --- | --- | --- | --- | --- |
| `md@lightworld.tech` | `md` | `Lightworld@2025` | `LT-EMP-0001` (Lightworld Managing Director) | `md` |
| `admin@lightworld.tech` | `admin` | `Admin@2025` | — (no employee record) | `administrator` |

Both passwords are bcrypt-hashed at cost 10 before being written to the DB.

### 4.7 Notifications — 2 welcome notifications

Both default users receive one "Welcome to Lightworld Business Management
System" success notification (`category: "system"`).

### 4.8 Seed audit entry — 1

A single `AuditLog` entry is written at the end of the seed with
`action: "create"`, `module: "system"`, `recordType: "seed"`, describing
the Phase 1 foundation data being seeded.

---

## 5. Soft-delete convention

Models that support soft-delete carry a nullable `deletedAt: DateTime?`
column:

- `User.deletedAt`
- `Role.deletedAt` (retained for create-restore logic; roles are hard-deleted)
- `Department.deletedAt`
- `Position.deletedAt`
- `Employee.deletedAt`

The read paths in every API route filter `deletedAt: null` via the
`notDeleted()` helper in `src/lib/api-helpers.ts`:

```ts
export function notDeleted() {
  return { deletedAt: null };
}
```

`CompanySetting`, `Permission`, `RolePermission`, `UserRole`, `AuditLog`
and `Notification` do **not** support soft-delete.

---

## 6. Singleton `CompanySetting` pattern

`CompanySetting` is a single-row table. The primary key is
`@default("singleton")` so the row always has `id = "singleton"`. This
gives us:

- A single source of truth for currency, address, invoice prefix etc.
- No need for a `WHERE` clause on `findUnique` — the singleton id is
  hard-coded in `src/app/api/company-settings/route.ts`.
- Defensive create-on-read: if the row is somehow missing, the GET
  handler creates it with Prisma defaults.

There is no list endpoint and no `id` parameter on the route. The PUT
upserts onto the singleton key, capturing `previousValue` + `newValue` for
the audit trail.

---

## 7. Audit log immutability convention

`AuditLog` is **append-only**. There is no `prisma.auditLog.update()` or
`prisma.auditLog.delete()` call anywhere in the codebase. The HTTP surface
only exposes `GET /api/audit` and `GET /api/audit/stats`. The schema
deliberately has no `updatedAt` or `deletedAt` column on `AuditLog` — it
is a write-once, read-many table.

`previousValue` and `newValue` are stored as JSON strings (the schema
column type is `String`). `recordAudit()` serialises them with
`JSON.stringify()` before writing.

---

## 8. SQLite-specific notes

### No native enums

SQLite has no native `ENUM` type, so all "enum-like" fields are stored as
`String` and validated at the application layer:

- Zod schemas in mutation routes enforce the allowed values (e.g.
  `z.enum(["active", "inactive", "suspended"])` in the user PATCH schema).
- A small `STATUS_VALUES = new Set(["active", "inactive"])` constant is
  used in `departments/[id]/route.ts` and `positions/[id]/route.ts`.
- `AuditAction` is a TypeScript union in `src/lib/audit.ts` but is stored
  as a plain `String` column.

### Decimal money fields deferred to Phase 2

SQLite's `Decimal` support is approximate (it stores as `REAL`). The
finance modules in Phase 2 require precise money math, so all money fields
are deferred until the datasource can be switched to MySQL (or PostgreSQL).
Phase 1 has no money columns.

**Production database requirement (added in Phase 1 audit documentation
pass)**: Phase 2 money columns will use Prisma's `Decimal` type with a
native-type extension `@db.Decimal(18,2)`. This extension **requires**
the `mysql` or `postgresql` datasource provider — it silently does not
apply on `sqlite`. The recommendation is therefore to migrate from
SQLite to MySQL/Postgres **before** Phase 2 lands, so that money
precision is enforced at the DB layer from day one.

See `ARCHITECTURE.md` §16 "Technology decision & production database
strategy" for the full migration plan and the list of SQLite-specific
risks (no row-level locking, no native enums, no `@db.Decimal`/`@db.VarChar`
native type extensions). The recommended production databases are
PostgreSQL 16+ (preferred) or MySQL 8+ (matches the original spec's DB
choice). Both migrate cleanly from the current Phase 1 schema with a
single `provider` change in `prisma/schema.prisma`.

### Case-insensitive matching

SQLite's default `contains` filter is case-insensitive for ASCII text.
This is fine for Phase 1's small search surfaces (department / position /
audit search). A MySQL migration may need explicit collation choices for
case-insensitive search.

### `@unique` and soft-delete interaction

Soft-deleted rows still occupy `@unique` constraints in SQLite. The create
endpoints handle this explicitly:

- The roles POST handler checks for a soft-deleted role with the same
  name and "restores" it instead of failing the unique constraint.
- The users POST handler surfaces a friendly message if a soft-deleted
  email or username collides with the requested new user.

---

## 9. Migration path

### Phase 1 (current): `prisma db push`

Development uses `bun run db:push` (`prisma db push --accept-data-loss`).
This is acceptable because Phase 1 is in active development and there is
no production data to preserve. `--accept-data-loss` is used so column
type changes do not block the push.

### Phase 2+ (production): `prisma migrate`

Once Phase 2 ships and real data exists, the project will switch to
`prisma migrate`:

```bash
bun run db:migrate    # creates + applies a migration in dev
# in production:
npx prisma migrate deploy
```

`prisma/migrations/` will start being populated from Phase 2 onward.
Phase 1's `prisma db push` history is intentionally not checked in.

### MySQL migration

To switch from SQLite to MySQL:

1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "mysql"
     url      = env("DATABASE_URL")
   }
   ```
2. Promote enum-like `String` columns to native MySQL `enum(...)` types if
   desired (Prisma will then enforce them at the DB level).
3. Run `prisma migrate reset` against the new MySQL instance and re-seed
   with `bun run db:seed`.

No application code changes are required — the Prisma client API is the
same for both providers.

---

## 10. Index reference

| Model | Index | Purpose |
| --- | --- | --- |
| `User` | `@@index([status])` | filter users by status in list view |
| `User` | `@@index([createdById])` | "created by" lookups |
| `Employee` | `@@index([departmentId])` | department → employee listing |
| `Employee` | `@@index([status])` | filter by employment status |
| `Permission` | `@@unique([module, action])` | canonical composite key |
| `Permission` | `@@index([module])` | group-by-module queries |
| `AuditLog` | `@@index([userId])` | per-user audit history |
| `AuditLog` | `@@index([module])` | module filter in audit view |
| `AuditLog` | `@@index([createdAt])` | time-range queries + ordering |
| `Notification` | `@@index([userId, isRead])` | unread-count query |
| `Notification` | `@@index([createdAt])` | recent-notifications query |

All other `@unique` constraints (`User.email`, `User.username`,
`User.employeeId`, `Employee.employeeId`, `Employee.email`,
`Department.name`, `Department.code`, `Position.title`, `Role.name`,
`CompanySetting.id`) are implemented as SQLite `UNIQUE INDEX` under the
hood by Prisma.

---

## 11. Financial architecture readiness (Phase 1 audit documentation)

The Phase 1 schema is **stable** and will host the Phase 2 finance
modules without modification. This section records the contract between
the Phase 1 schema and the future finance tables.

### 11.1 Stable Phase 1 tables (no changes in Phase 2+)

The following Phase 1 tables are referenced by the future finance
system and will **not** be modified:

- `User` — every financial transaction is created by and audited against
  a `User`. The `createdById` self-relation pattern (already used on
  `User` and `Role`) is reused for finance records.
- `Department` — finance reports group by department; project expenses
  may reference a department.
- `AuditLog` — every financial mutation writes a `previousValue` +
  `newValue` snapshot via `recordAudit()` (the only writer to
  `AuditLog`). Finance transactions use the same audit pipeline.
- `CompanySetting` — currency, invoice prefix, financial year start.
  Phase 2 reads but does not modify this row.
- `Notification` — approval flows, invoice due dates, payment reminders
  all write rows here using the same `Notification` schema (the
  `category` field already reserves values like `invoice`, `payment`,
  `deadline`, `approval`).

### 11.2 New tables added in Phase 2

Phase 2 will **add** the following tables (none requires modifying any
existing table):

- `Account` — cash & bank accounts. Columns: `openingBalance` (Decimal
  `@db.Decimal(18,2)`), `currency` (3-letter ISO code, mirrors
  `CompanySetting.currency`), `type` (`cash | bank | mobile_money`),
  soft-delete columns. All financial transactions reference an
  `Account`.
- `Category` — income categories and expense categories (one table
  with a `type` discriminator, or two tables — TBD in Phase 2 design).
- `Customer` (Phase 5) and `Supplier` (Phase 5) — master data for
  accounts receivable / accounts payable.
- `Project` (Phase 6) — projects that income/expenses can be attributed
  to for profitability analysis.
- `Transaction` — the ledger row. Columns: `type` field
  (`income | expense | transfer | adjustment`), `amount` (Decimal
  `@db.Decimal(18,2)`), `accountId` (FK to `Account`), `categoryId`
  (FK to `Category`), `createdById` (FK to `User`), optional
  `customerId`, `supplierId`, `projectId`, `departmentId`. Timestamps
  via `createdAt`; immutable once written (no `PATCH` on
  `Transaction` — corrections are new rows with `type: "adjustment"`
  referencing the original).

The `cuid()` ID strategy used throughout Phase 1 (every `@id` is
`@default(cuid())`) is suitable for the ledger — ledger rows are
immutable once written and never need sequential IDs.

### 11.3 The balance-derivation principle (key invariant)

**Account balances MUST be derived, never stored as a mutable field
updated by writes.** The displayed balance of an Account at any time T
is:

```
balance(T) = openingBalance
           + sum(amount for transactions where type = 'income'  and createdAt <= T)
           - sum(amount for transactions where type = 'expense' and createdAt <= T)
```

This invariant preserves financial integrity and auditability:

- The balance is always recomputable from immutable history. An
  attacker who modifies a balance column cannot hide the discrepancy —
  the derived total will diverge from the stored total.
- The audit trail's `previousValue`/`newValue` JSON snapshots capture
  every transaction; the running balance is a pure function of the
  audit trail.
- Period-close operations can freeze a balance snapshot (cache the
  derived value at close time) without ever writing the balance back
  to the `Account` row as a "current" field.

Phase 2 may add a cached `currentBalance` column on `Account` for
dashboard performance, but it MUST be a derived read-model updated by
the same `db.$transaction` that writes the `Transaction` row — never
directly writable by the API.

### 11.4 SQLite-specific risk summary for the migration

When the Phase 2 migration to MySQL/Postgres happens, the following
SQLite-specific behaviours must be considered (the same list appears
in `ARCHITECTURE.md` §16.5; it is duplicated here for the
data-dictionary reader):

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
