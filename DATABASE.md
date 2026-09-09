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

## 2.A Phase 2 — Finance models

The following six models were added in Phase 2 — Finance Foundation.
All money values use Prisma `Decimal` (stored as TEXT on SQLite; migrates
to `DECIMAL(18,2)` on PostgreSQL/MySQL with zero schema change — the
`@db.Decimal(18,2)` annotation is intentionally omitted so the schema
works on both providers without modification). All four Phase 2 finance
models that support soft-delete follow the Phase 1 `notDeleted()`
convention.

### 2.A.1 `FinancialAccount`

Where money lives — cash, bank, or mobile-money accounts. Each
account holds money in a single currency; opening balances are
posted as `OPENING_BALANCE` journals (see §2.A.3 below) so the
`openingBalance` column is a seed value, NOT a live mutable balance.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `code` | String | `@unique` — e.g. `"CASH-001"`, `"BANK-001"` |
| `name` | String | `@unique` |
| `accountType` | String | `@default("asset")` — `asset | liability` (financial accounts are typically asset accounts that hold money) |
| `currency` | String | `@default("GHS")` — 3-letter ISO code |
| `openingBalance` | Decimal | `@default(0)` — the seed value used to generate an `OPENING_BALANCE` journal at account creation; never updated by transactions |
| `status` | String | `@default("active")` — `active | inactive` |
| `description` | String? | |
| `bankName` | String? | for bank accounts |
| `accountNumber` | String? | masked/reference only — never store full account numbers in plaintext |
| `createdById` | String? | FK to `User.id` (`onDelete: SetNull`); relation `"FinAccountCreatedBy"` |
| `createdBy` | User? | relation back to User |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `journalEntries JournalEntry[]`, `journals Journal[]`
(the journals where this is the primary financial account).

**Indexes**: `@@index([status])`, `@@index([currency])`.

**Soft-delete convention**: DELETE on `/api/finance/accounts/[id]`
sets `deletedAt = now()` and `status = "inactive"`. The endpoint
returns 403 with a descriptive error if the account has any posted
journal entries — deactivation is the right action once an account
has been used.

**Opening balance mechanism**: when `POST /api/finance/accounts` is
called with `postOpeningBalance = true` (the default) and
`openingBalance > 0`, the handler runs an atomic `db.$transaction`
that creates the `FinancialAccount` AND posts a paired
`OPENING_BALANCE` journal debiting the new account and crediting
the seeded `EQT-OWNER` equity ledger account (falling back to
`AST-CASH` if equity is missing). The reporting service therefore
sees the opening balance as part of the normal entry totals — it
does NOT add `openingBalance` to the derived total again (no
double-counting).

### 2.A.2 `LedgerAccount`

The chart of accounts — one row per income/expense/asset/liability/
equity category. Used to classify transactions for reporting.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `code` | String | `@unique` — e.g. `"INC-SALES"`, `"EXP-FUEL"` |
| `name` | String | `@unique` |
| `accountClass` | String | `asset | liability | equity | income | expense` (one of `ACCOUNT_CLASSES`) |
| `accountType` | String | finer-grained type; defaults to `accountClass` when not provided on create |
| `currency` | String | `@default("GHS")` |
| `status` | String | `@default("active")` — `active | inactive` |
| `description` | String? | |
| `isSystem` | Boolean | `@default(false)` — seeded categories; can be deactivated but not deleted |
| `createdById` | String? | FK to `User.id` (`onDelete: SetNull`); relation `"LedgerAccountCreatedBy"` |
| `createdBy` | User? | relation back to User |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |
| `deletedAt` | DateTime? | nullable; soft-delete marker |

**Relations**: `journals Journal[]`, `journalEntries JournalEntry[]`.

**Indexes**: `@@index([accountClass])`, `@@index([accountType])`,
`@@index([status])`.

**Soft-delete convention**: same `notDeleted()` filter pattern as
the rest of the system.

### 2.A.3 `Journal`

One financial event — an income receipt, an expense payment, a
transfer, an opening balance, or an adjustment. Owns ≥2
`JournalEntry` rows that must balance: Σ(debit) = Σ(credit).

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `reference` | String | `@unique` — e.g. `"INC-2026-000001"`; generated concurrency-safe inside `db.$transaction` via `FinanceRefCounter` |
| `transactionType` | String | `income | expense | transfer | opening_balance | adjustment` (one of `TRANSACTION_TYPES`) |
| `status` | String | `@default("posted")` — `draft | posted | voided | reversed` |
| `transactionDate` | DateTime | the accounting date (NOT `createdAt` — may differ) |
| `description` | String? | human-readable summary |
| `notes` | String? | longer-form notes; also stores the reversal reason on reversal journals |
| `financialAccountId` | String? | FK to `FinancialAccount.id` (`onDelete: Restrict`) — the primary account affected |
| `financialAccount` | FinancialAccount? | relation |
| `ledgerAccountId` | String? | FK to `LedgerAccount.id` (`onDelete: Restrict`) — the primary ledger category |
| `ledgerAccount` | LedgerAccount? | relation |
| `departmentId` | String? | FK to `Department.id` (`onDelete: SetNull`) — existing Phase 1 column |
| `department` | Department? | relation |
| `partyType` | String? | `customer | supplier | null` — Phase 5 stub |
| `partyRef` | String? | future FK to `Customer.id` / `Supplier.id` (Phase 5) |
| `projectRef` | String? | future FK to `Project.id` (Phase 6) |
| `paymentMethod` | String? | `cash | bank_transfer | mobile_money | card | cheque | other` (one of `PAYMENT_METHODS`) |
| `externalRef` | String? | bank slip / cheque / momo transaction id |
| `reversesId` | String? | `@unique`; FK to `Journal.id` (`onDelete: Restrict`); relation `"JournalReversal"` — set on the reversal, points to the original |
| `reverses` | Journal? | relation `"JournalReversal"` — the original this journal reverses |
| `reversedBy` | Journal? | relation `"JournalReversal"` (inverse, no fields) — set on the original, points to its reversal |
| `reversalReason` | String? | captured from the reverse-API caller |
| `amount` | Decimal | the absolute monetary value of the journal (= Σ(debit) = Σ(credit)) |
| `currency` | String | `@default("GHS")` — must match every referenced account's currency |
| `createdById` | String | required; FK to `User.id` (`onDelete: Restrict`); relation `"JournalCreatedBy"` |
| `createdBy` | User | relation |
| `postedAt` | DateTime? | set when `status = "posted"` |
| `voidedAt` | DateTime? | reserved for the void flow (Phase 2 posts + reverses; void is reserved for a future approval flow) |
| `voidedById` | String? | FK to `User.id` (`onDelete: SetNull`); relation `"JournalVoidedBy"` |
| `voidedBy` | User? | relation |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |

**Relations**: `entries JournalEntry[]`.

**Indexes**: `@@index([transactionType])`, `@@index([status])`,
`@@index([transactionDate])`, `@@index([financialAccountId])`,
`@@index([ledgerAccountId])`, `@@index([departmentId])`,
`@@index([createdById])`, `@@index([reference])`.

**Reversal self-relation**: `reversesId` is `@unique` so each
original can be reversed by at most one reversal journal. The
posting engine's `reverseJournal()` enforces this at the application
layer too (rejects with `FinanceValidationError` if a reversal
already exists). The original journal's `status` is updated to
`"reversed"` when the reversal is created; both the original and
the reversal participate in balance derivation (they net to zero).

**Immutability**: posted journals CANNOT be deleted and CANNOT be
edited. Corrections are made by posting a reversal (mirrored entries)
which nets the original to zero. The original journal is preserved
for audit. The HTTP surface exposes no PATCH on journals — only the
reverse endpoint creates the linked reversal.

### 2.A.4 `JournalEntry`

A single debit OR credit line within a Journal. Exactly one of
(`debit`, `credit`) is non-zero per row; the other is 0.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `journalId` | String | FK to `Journal.id` (`onDelete: Cascade`) |
| `journal` | Journal | relation |
| `financialAccountId` | String? | OPTIONAL — only cash-side entries reference a `FinancialAccount`; income/expense category lines do not |
| `financialAccount` | FinancialAccount? | relation (`onDelete: Restrict`) |
| `ledgerAccountId` | String? | FK to `LedgerAccount.id` (`onDelete: Restrict`) |
| `ledgerAccount` | LedgerAccount? | relation |
| `debit` | Decimal | `@default(0)` — exactly one of (debit, credit) is non-zero |
| `credit` | Decimal | `@default(0)` — exactly one of (debit, credit) is non-zero |
| `currency` | String | `@default("GHS")` — mirrors the journal's currency |
| `description` | String? | per-line description (e.g. "Income received into account", "Reversal of INC-2026-000001") |
| `createdAt` | DateTime | `@default(now())` |

**Indexes**: `@@index([journalId])`, `@@index([financialAccountId])`,
`@@index([ledgerAccountId])`.

**Optional `financialAccountId` rationale**: in real accounting,
income and expense categories are not "accounts you hold money in"
— they are reporting buckets. When income is posted, the cash-side
entry (debit) references the financial account, and the income-side
entry (credit) references only the ledger account. When expense is
posted, the expense-side entry (debit) references only the ledger
account, and the cash-side entry (credit) references the financial
account. This is why the column is nullable.

### 2.A.5 `FinanceRefCounter`

Concurrency-safe reference counter. One row per `(prefix, year)`.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `prefix` | String | `INC | EXP | TRF | OPB | ADJ` (one of `REF_PREFIXES` values) |
| `year` | Int | e.g. `2026` |
| `nextNumber` | Int | `@default(1)` — the next sequence number to assign |

**Constraints**: `@@unique([prefix, year])`.

**Usage**: the posting engine calls `tx.financeRefCounter.upsert({
where: { prefix_year: { prefix, year } },
update: { nextNumber: { increment: 1 } },
create: { prefix, year, nextNumber: 2 },
})` inside the same `db.$transaction` that creates the journal. The
returned `nextNumber - 1` is the sequence used in the reference
(e.g. `INC-2026-000001`). SQLite serialises writes so concurrent
inserts cannot collide; on PostgreSQL/MySQL the same code path
benefits from row-level locking automatically.

### 2.A.6 `FinanceIdempotencyLog`

Optional idempotency-key log for duplicate-submit protection.

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | String | `@id @default(cuid())` |
| `key` | String | `@unique` — the client-supplied idempotency key |
| `userId` | String | the user who submitted the original request |
| `responseHash` | String | hash of the original response body |
| `responseBody` | String | cached response body for replay |
| `statusCode` | Int | the original response status code |
| `createdAt` | DateTime | `@default(now())` |
| `expiresAt` | DateTime | when the cached response is no longer valid |

**Indexes**: `@@index([userId])`, `@@index([expiresAt])`.

**Status**: the table ships in Phase 2 but is NOT yet consumed by the
finance API routes. The intended Phase 3 behaviour: a finance POST
endpoint that receives an `Idempotency-Key` header looks up the log;
on a hit it replays the cached response; on a miss it runs the
request and caches the response. This prevents accidental duplicate
postings when a client retries a request after a network error.

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

### Decimal money fields — landed in Phase 2

Phase 2 ships all money columns as Prisma `Decimal` (decimal.js under
the hood). On SQLite the values are stored as TEXT (no DB-level
precision enforcement); on PostgreSQL/MySQL they migrate to
`DECIMAL(18,2)` natively. The application layer enforces precision in
dev (`toMoney` rejects non-numeric input, `toPositiveMoney` requires
`> 0`, `roundMoney` rounds to 2 dp with `ROUND_HALF_UP`).

**Decision (Phase 2)**: the `@db.Decimal(18,2)` native-type annotation
is **intentionally omitted** from all `Decimal` columns in
`prisma/schema.prisma`. This is deliberate — it lets the same
`schema.prisma` work on SQLite (where the annotation is unsupported)
and PostgreSQL/MySQL (where it would otherwise be required for DB-level
precision enforcement) without modification. Switching
`provider = "postgresql"` (or `"mysql"`) and running `prisma migrate`
requires no schema changes.

**Production requirement**: production deployments MUST use PostgreSQL
16+ or MySQL 8+ for: row-level locking on concurrent balance updates,
DB-level Decimal precision enforcement, and proper transaction
isolation. SQLite is acceptable for local development only.

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

### 10.1 Phase 1 indexes

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

### 10.2 Phase 2 finance indexes

| Model | Index | Purpose |
| --- | --- | --- |
| `FinancialAccount` | `@@index([status])` | filter accounts by status |
| `FinancialAccount` | `@@index([currency])` | filter accounts by currency |
| `LedgerAccount` | `@@index([accountClass])` | group by class for chart-of-accounts view |
| `LedgerAccount` | `@@index([accountType])` | filter by finer-grained type |
| `LedgerAccount` | `@@index([status])` | filter by status |
| `Journal` | `@@index([transactionType])` | filter journals by type |
| `Journal` | `@@index([status])` | filter journals by status (posted/reversed/etc) |
| `Journal` | `@@index([transactionDate])` | date-range queries (reports, list) |
| `Journal` | `@@index([financialAccountId])` | per-account journal listing |
| `Journal` | `@@index([ledgerAccountId])` | per-category journal listing |
| `Journal` | `@@index([departmentId])` | per-department finance reports |
| `Journal` | `@@index([createdById])` | per-creator finance audit |
| `Journal` | `@@index([reference])` | reference-number search (also covered by `@unique`) |
| `JournalEntry` | `@@index([journalId])` | join to parent journal |
| `JournalEntry` | `@@index([financialAccountId])` | balance derivation per account |
| `JournalEntry` | `@@index([ledgerAccountId])` | income/expense aggregation per category |
| `FinanceRefCounter` | `@@unique([prefix, year])` | canonical composite key for counter rows |
| `FinanceIdempotencyLog` | `@@index([userId])` | per-user idempotency lookup |
| `FinanceIdempotencyLog` | `@@index([expiresAt])` | expired-key cleanup |

`FinancialAccount.code`, `FinancialAccount.name`, `LedgerAccount.code`,
`LedgerAccount.name`, `Journal.reference`, and
`FinanceIdempotencyLog.key` are `@unique` columns implemented as
SQLite `UNIQUE INDEX` under the hood by Prisma. `Journal.reversesId`
is also `@unique` so each original can be reversed by at most one
reversal journal.

---

## 11. Financial architecture readiness (Phase 1 audit documentation)

The Phase 1 schema is **stable** and now hosts the Phase 2 finance
modules without modification. Phase 2 has shipped; this section records
the contract between the Phase 1 schema and the now-implemented finance
tables. The Phase 1 audit version of this section anticipated an
`Account`/`Category`/`Transaction` shape; the actual Phase 2
implementation uses a `FinancialAccount`/`LedgerAccount`/`Journal`/
`JournalEntry` double-entry model — see §2.A above for the
authoritative data dictionary.

### 11.1 Stable Phase 1 tables (no changes in Phase 2)

The following Phase 1 tables are referenced by the Phase 2 finance
system and were **not** modified by Phase 2:

- `User` — every financial transaction is created by and audited
  against a `User`. The `createdById` self-relation pattern (already
  used on `User` and `Role`) is reused for finance records
  (`FinAccountCreatedBy`, `LedgerAccountCreatedBy`,
  `JournalCreatedBy`, `JournalVoidedBy`).
- `Department` — finance reports group by department; the
  `Journal.departmentId` FK uses the existing `Department` table.
- `AuditLog` — every financial mutation writes a `previousValue` +
  `newValue` snapshot via `recordAudit()` (the only writer to
  `AuditLog`). Phase 2 finance transactions use the same audit
  pipeline.
- `CompanySetting` — currency, invoice prefix, financial year start.
  Phase 2 reads but does not modify this row.
- `Notification` — approval flows, invoice due dates, payment
  reminders all write rows here using the same `Notification` schema.

### 11.2 New tables added in Phase 2

Phase 2 added the following tables (none required modifying any
existing Phase 1 table). See §2.A above for the full field-level
dictionary:

- `FinancialAccount` — where money lives (cash/bank/momo). Replaces
  the planned `Account` table; named `FinancialAccount` to
  disambiguate from the Phase 2 `LedgerAccount` chart of accounts.
- `LedgerAccount` — the chart of accounts (income/expense/asset/
  liability/equity categories). Replaces the planned `Category`
  table; named `LedgerAccount` to reflect that each row is an
  accounting category in the general ledger.
- `Journal` — one financial event (header). Replaces the planned
  `Transaction` table; named `Journal` because every financial
  event is a double-entry journal that owns ≥2 `JournalEntry` rows.
- `JournalEntry` — debit/credit lines. NEW in Phase 2 (the Phase 1
  audit had anticipated a single-row `Transaction` table).
- `FinanceRefCounter` — concurrency-safe reference counter.
- `FinanceIdempotencyLog` — optional idempotency-key log (table
  ships; consumption is wired in Phase 3).
- `Customer` (Phase 5) and `Supplier` (Phase 5) — master data for
  accounts receivable / accounts payable. Not yet implemented; the
  `Journal.partyType` + `Journal.partyRef` stub fields exist on the
  Phase 2 schema to host the future FK without migration.
- `Project` (Phase 6) — projects that income/expenses can be
  attributed to for profitability analysis. Not yet implemented; the
  `Journal.projectRef` stub field exists on the Phase 2 schema to
  host the future FK without migration.

The `cuid()` ID strategy used throughout Phase 1 (every `@id` is
`@default(cuid())`) is suitable for the ledger — ledger rows are
immutable once written and never need sequential IDs.

### 11.3 The balance-derivation principle (key invariant)

**Account balances are DERIVED, never stored as a mutable field
updated by writes.** The Phase 1 audit version of this invariant
anticipated:

```
balance(T) = openingBalance
           + sum(amount for transactions where type = 'income'  and createdAt <= T)
           - sum(amount for transactions where type = 'expense' and createdAt <= T)
```

Phase 2 implements this invariant in the reporting service
(`src/lib/finance/reporting.ts`) as:

```
balance(accountId) = Σ(debit) - Σ(credit)
                   for JournalEntry rows where
                     journalId IN (journals with status 'posted' OR 'reversed')
                     AND financialAccountId = accountId
```

This invariant preserves financial integrity and auditability:

- The balance is always recomputable from immutable history. An
  attacker who modifies a balance column cannot hide the discrepancy
  — the derived total will diverge from the stored total.
- The audit trail's `previousValue`/`newValue` JSON snapshots capture
  every transaction; the running balance is a pure function of the
  audit trail.
- Period-close operations can freeze a balance snapshot (cache the
  derived value at close time) without ever writing the balance back
  to the `FinancialAccount` row as a "current" field.

Phase 2 does NOT add a cached `currentBalance` column on
`FinancialAccount` — the derived balance is fast enough for the
Phase 2 dashboards and reports via a single aggregated
`db.journalEntry.groupBy` query (see `listAccountBalances()`). A
cached read-model can be added in a later phase if performance
demands it.

### 11.4 SQLite-specific risk summary for the migration

Phase 2 ships on SQLite (environment constraint — PostgreSQL/MySQL
are not available in this sandbox). The following SQLite-specific
behaviours apply and are mitigated by the application layer:

- **`Decimal` type**: Prisma maps `Decimal` to `TEXT` in SQLite (no
  precision enforcement) but to `DECIMAL(p,s)` in MySQL/Postgres.
  Phase 2 mitigates with app-layer precision enforcement
  (`toMoney`/`toPositiveMoney`/`roundMoney` in
  `src/lib/finance/money.ts`). The `@db.Decimal(18,2)` annotation is
  intentionally omitted from the schema so it works on both
  providers without modification — see §8 above.
- **No native enums**: the schema uses `String` + app-layer
  validation (`isTransactionType`, `isPaymentMethod`,
  `isAccountClass` in `src/lib/finance/constants.ts`). A future
  migration could promote these to native enums (optional, not
  blocking).
- **No row-level locking**: concurrent balance updates in SQLite are
  serialised at the DB level (correct but slow). The Phase 2 posting
  engine wraps every posting in `db.$transaction` and increments the
  `FinanceRefCounter` row inside the same transaction, so concurrent
  inserts cannot collide. Production must use MySQL/Postgres with
  `$transaction` + appropriate isolation (`SERIALIZABLE` or
  `SELECT ... FOR UPDATE`).
- **Production MUST use PostgreSQL 16+ or MySQL 8+** for row-level
  locking on concurrent balance updates, DB-level Decimal precision
  enforcement, and proper transaction isolation. The schema is
  migration-ready: switch `provider = "postgresql"` (or `"mysql"`)
  and run `prisma migrate` — no schema changes needed.
