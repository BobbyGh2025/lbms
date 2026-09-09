# Security

This document describes the security posture of LBMS as shipped in Phase 1
and the planned hardening for later phases.

The guiding principle of the LBMS security model is: **authorization is
enforced server-side, not just in the UI.** Hiding a button on the client
is a UX nicety, never a security boundary.

---

## 1. Authentication

### Password hashing

- All passwords are hashed with **bcryptjs** at cost factor **10** before
  being written to `User.passwordHash`.
- Verification on login uses `bcrypt.compare(credentials.password,
  user.passwordHash)` — the plaintext password is never stored, never
  logged, and never returned by any API.
- Password resets (`POST /api/users/:id/reset-password`) and PATCH on a
  user (`PATCH /api/users/:id` with a `password` field) re-hash with the
  same cost factor.

### Session management

- NextAuth v4 with the **JWT session strategy**.
- Session lifetime: **8 hours** (`maxAge: 60 * 60 * 8` in `src/lib/auth.ts`).
- The JWT carries `userId`, `email`, `username`, `roles`,
  `permissions` (flattened `"module:action"` keys), and `isMD`.
- The JWT is signed with `NEXTAUTH_SECRET` (env variable, gitignored).
- The session cookie is set by NextAuth's default behaviour (HttpOnly,
  SameSite=Lax, Secure in production when `NEXTAUTH_URL` is HTTPS).

### Account lockout

- After **5** consecutive failed login attempts the account is locked for
  **15 minutes** (`lockedUntil = now + 15min`).
- A successful login resets `failedLoginAttempts` to 0 and clears
  `lockedUntil`.
- A locked account is rejected before the bcrypt compare runs — the
  attempt counter does not advance while locked.
- Lockout state can also be cleared by an administrator via the
  "Reset password" action (which sets `failedLoginAttempts=0`,
  `lockedUntil=null`).

### Login failure audit

Every failed login writes an `AuditLog` entry with `action: "login_failed"`
and `module: "auth"`. Distinct descriptions are recorded for:

- unknown email (no user found),
- non-active account status (`inactive` / `suspended`),
- locked account,
- incorrect password (with attempt count `N/5` and a separate description
  when the lockout threshold is crossed).

Successful login writes `action: "login"`. Sign-out writes
`action: "logout"` (best-effort via NextAuth's `events.signOut` callback).

---

## 2. Authorization (RBAC)

### Server-side enforcement on every API route

Every Route Handler in `src/app/api/*` calls the `authorize(module, action)`
helper from `src/lib/api-helpers.ts` **before** any database write:

```ts
const auth = await authorize("users", "create");
if (!auth.ok) return auth.response;  // 401 if not signed in, 403 if missing permission
```

`authorize()` returns:

- `{ ok: false, response: 401 }` when there is no session,
- `{ ok: false, response: 403 }` when the session lacks the required
  permission,
- `{ ok: true, ctx: { userId, isMD, roles } }` when authorised.

As of the Phase 1 audit hardening pass, **every** mutation and read
route under `/api/*` now goes through `authorize()` — including
`GET /api/dashboard`, which previously only checked session existence.
The dashboard route now requires the `dashboard:view` permission. Every
seeded role already carries `dashboard:view`, so legitimate access is
unchanged; the route is now correctly gated for the contract.

### Privilege escalation prevention

A non-MD user with `users:create` or `users:edit` could previously grant
the `md` role to themselves or anyone else via `POST /api/users` (with
`roleIds` containing the MD role ID) or via `PUT /api/users/:id/roles`
(with `roleIds` containing the MD role ID). This was a critical
privilege-escalation hole.

Both handlers now fetch the candidate roles' `name` field before writing
and reject the request with HTTP 403 when:

- `ctx.isMD === false`, AND
- any candidate role has `name === "md"`.

The 403 response body is:

```json
{ "error": "Only the Managing Director may assign the 'md' role." }
```

This guard is enforced in addition to the existing `users:create` /
`users:edit` permission check, so an unauthenticated or
permission-less caller is rejected with 401 / 403 before the role
inspection runs. The MD bypass works as usual: an MD caller can assign
the `md` role freely.

The same guard logic is mirrored on the **revoke** side: a non-MD user
cannot remove the `md` role from any user via `PUT /api/users/:id/roles`
— the candidate-set check treats "the new roleIds omit `md` but the
target user currently has it" as an attempted revocation and rejects
unless the caller is MD.

### Self-modification guards

A user with `users:edit` (which includes every MD, administrator and
HR manager) could previously invalidate their own session by setting
their own `status` to `inactive` or `suspended` via `PATCH /api/users/:id`.
This is dangerous because:

- it leaves the system potentially short of an active administrator,
- the caller's session token is still valid (8-hour JWT) but every
  subsequent `authorize()` call would reject them with 401, making the
  account unrecoverable from the UI.

The PATCH handler now blocks self-deactivation:

```ts
if (auth.ctx.userId === id && data.status && data.status !== "active") {
  return forbidden("You cannot deactivate or suspend your own account.");
}
```

Self-deletion (`DELETE /api/users/:id` where `auth.ctx.userId === id`)
was already blocked before Phase 1 sign-off; the audit pass removed a
redundant duplicate check that was unreachable. Both self-modification
guards now live alongside the **last-MD guard** (which prevents the
deletion or deactivation of the only remaining MD user) and together
they form a coherent self-protection layer on the user-management
surface.

### MD bypass

The `md` role bypasses every permission check. Two mechanisms enforce this:

1. In `src/lib/permissions.ts`, `loadUserAuthData()` sets `isMD = true`
   when the user's roles include `"md"`. This flag is stored on the JWT
   and on `session.user.isMD`.
2. In `authorize()` (and `requirePermission()`), the function short-circuits
   when `ctx.isMD === true` and returns success without checking
   `session.user.permissions`.

This means the MD can perform any action even if a permission row was
accidentally removed from their role.

### `requirePermission` server helper

For non-API server-side code (e.g. server components or server actions),
`src/lib/permissions.ts` exports `requirePermission(module, action)` which
throws `AuthenticationError` (401) or `AuthorizationError` (403). The
errors carry `statusCode` so a wrapping try/catch can convert them to
responses. There is also a soft `hasPermission(module, action)` that
returns a boolean for conditional UI rendering inside server components.

### Client-side permission gating

`src/hooks/use-auth.ts` exposes `useAuth().can(module, action)` for hiding
UI affordances (e.g. the "New User" button is only shown to users with
`users:create`). This is a UX improvement, not a security control — the
server still enforces the check on every API call.

---

## 3. CSRF

NextAuth v4's Credentials provider includes built-in CSRF protection:

- A CSRF token is exposed at `GET /api/auth/csrf` and validated on every
  POST to `/api/auth/callback/credentials`.
- The CSRF cookie is `HttpOnly` and uses the `SameSite=Lax` default.
- All mutation routes (`POST`/`PATCH`/`PUT`/`DELETE`) under `/api/*`
  require a valid NextAuth session cookie; anonymous requests get HTTP 401
  before any business logic runs.

No additional CSRF middleware is required for Phase 1.

---

## 4. Input validation (Zod)

Every mutation Route Handler validates its body with a Zod schema before
touching the database:

- `POST /api/users` — `CreateUserSchema` (email format, username min 3,
  password min 8, roleIds array, optional status enum).
- `PATCH /api/users/:id` — `PatchUserSchema` (all fields optional,
  refined to require at least one).
- `POST /api/users/:id/reset-password` — `ResetPasswordSchema`
  (password min 8).
- `PUT /api/users/:id/roles` — `ReplaceRolesSchema` (roleIds array).
- `POST /api/roles` — `CreateRoleSchema` (name regex `^[a-z][a-z0-9_]*$`,
  displayName min 2, permissionKeys array).
- `PATCH /api/roles/:id` — `PatchRoleSchema` (displayName / description
  only).
- `PUT /api/roles/:id/permissions` — `ReplacePermissionsSchema`
  (permissionKeys array; unknown keys dropped silently + logged).
- `PUT /api/company-settings` — `updateCompanySettingsSchema`
  (currency 3-letter uppercase regex, email format, invoiceStart int
  `>= 0`, all nullable strings normalised to `null`).

Validation errors return HTTP 400 with `{ error: string, details? }`.
`details` is typically the Zod `issues` array or `flatten()` result.

List endpoints parse query-string params with the `pagination()` helper
which clamps `page >= 1`, `pageSize` to `1..100`, and trims `search`.

---

## 5. Output escaping

LBMS renders all user-supplied data through React JSX, which auto-escapes
strings interpolated as children or attribute values. There is no use of
`dangerouslySetInnerHTML` anywhere in the Phase 1 codebase.

API responses are JSON; the JSON serializer escapes `<`, `>`, `&` etc.
by default, so a stored XSS payload in a `description` field will be
rendered as inert text in the browser.

---

## 6. Password handling

- Passwords are never logged. The audit trail captures
  `"Password reset for …"` / `"... — password changed"` descriptions but
  never the password itself.
- `passwordHash` is excluded from every API response by a Prisma `select`
  projection (`USER_SELECT` in `users/route.ts` and `users/[id]/route.ts`).
- The `previousValue` and `newValue` JSON snapshots in audit entries are
  serialised from the same `select`-ed object, so the hash never leaks
  into the audit log either.
- There is no "Forgot password" email flow in Phase 1; password resets
  are performed by an administrator via the Users view.

---

## 7. Audit logging

Every mutation that touches the database writes an `AuditLog` entry via
`auditFromCtx()` (or `recordAudit()` directly in `src/lib/auth.ts` for
auth events). Audit entries capture:

- `userId` (the actor),
- `action` (`create | update | delete | approve | reject | view_sensitive |
  export | system | login | logout | login_failed`),
- `module`,
- `recordId`, `recordType`,
- `description` (human-readable summary),
- `ipAddress` (from `x-forwarded-for` / `x-real-ip`),
- `userAgent`,
- `previousValue` (JSON string of the prior state),
- `newValue` (JSON string of the new state).

The audit log is append-only: there is no `update` or `delete` call on
`AuditLog` anywhere in the codebase, and the HTTP surface exposes only
`GET /api/audit` and `GET /api/audit/stats`.

`recordAudit()` swallows errors and logs them to stderr — audit failure
must never break the primary operation.

---

## 8. File upload validation (Phase 8 / 10)

Phase 1 has **no** file-upload endpoints. The Company Settings view
includes a disabled "Upload" button for the company logo and accepts a
`logoUrl` string instead.

File-upload validation will land in Phase 8 (assets & documents) and
Phase 10 (logo upload). The planned controls are:

- MIME-type whitelist (PNG, JPEG, WebP, PDF, common Office formats).
- Magic-byte verification on the first 16 bytes of the stream.
- Maximum file size enforced both server-side and client-side.
- Storage in a non-public directory with a generated filename (never the
  user-supplied filename).
- Per-user upload rate limit (Phase 10).

---

## 9. Error handling

- All API errors return a JSON envelope `{ error: string, details? }` with
  the appropriate HTTP status code (400 / 401 / 403 / 404 / 500).
- Stack traces are never returned to the client. Prisma errors are caught
  and translated into a generic `badRequest(...)` message; the raw error
  is logged to stderr.
- The development server (`bun run dev`) shows full errors in the
  terminal for debugging, but the HTTP response body is always the
  sanitised envelope.

---

## 10. Environment-based secrets

The following environment variables are required and must **never** be
committed to git:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Prisma datasource URL — `file:./db/custom.db` for SQLite dev |
| `NEXTAUTH_SECRET` | HMAC key for signing JWTs; rotate periodically |
| `NEXTAUTH_URL` | Public base URL of the deployment (e.g. `https://lbms.lightworld.tech`) |

A `.env` file in the project root is gitignored. There is no committed
`.env.example` — operators must create `.env` from the README instructions.

---

## 11. Rate limiting (Phase 10 — planned)

Phase 1 does **not** implement rate limiting beyond the 5-attempt login
lockout. Phase 10 will add:

- Per-IP rate limiting on `/api/auth/*` (login throttling).
- Per-user rate limiting on mutation endpoints (e.g. prevent a
  compromised admin from bulk-deleting thousands of users in a tight
  loop).
- A global rate limiter for unauthenticated GETs.

The implementation will likely use an in-memory store in dev and a Redis
backed store in production.

---

## 12. Secure headers

Next.js 16 sets sensible default security headers (`X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-
cross-origin`). Phase 10 will add a strict Content-Security-Policy tuned
to the production deployment.

---

## 13. Principle summary

| Principle | Implementation |
| --- | --- |
| Authorization enforced server-side | `authorize()` on every route, MD bypass via `isMD` flag |
| No plaintext passwords | bcrypt cost 10; hash never returned by any API |
| Append-only audit trail | `recordAudit()` is the only writer; no PATCH/DELETE endpoints on `/api/audit` |
| Input validation | Zod schemas on every mutation route; finance also uses `toMoney`/`toPositiveMoney`/`isTransactionType`/`isPaymentMethod` |
| Output escaping | React JSX auto-escaping; no `dangerouslySetInnerHTML` |
| CSRF protection | NextAuth built-in CSRF token + SameSite cookies |
| Secure errors | JSON envelope, no stack traces leaked |
| Secrets in env | `.env` gitignored; `NEXTAUTH_SECRET` required |
| Soft-delete | `deletedAt` + `notDeleted()` filter on all reads (Phase 1 + Phase 2 finance models) |
| Last-MD guard | DELETE/PATCH on the last MD user is blocked server-side; PUT on `/api/users/:id/roles` also blocks stripping the MD role from the last MD |
| Privilege-escalation guard | Non-MD users cannot assign or remove the `md` role via POST `/api/users` or PUT `/api/users/:id/roles` (403) |
| Self-modification guard | Users cannot delete or deactivate their own account |
| Dashboard authz | `/api/dashboard` requires `dashboard:view` (was: session-only check before audit) |
| Finance authz (Phase 2) | Every `/api/finance/*` endpoint requires `finance:view` / `finance:create` / `finance:reverse` / `finance:manage_accounts` / `finance:manage_categories` / `finance:view_reports` |
| Finance immutability (Phase 2) | Posted journals cannot be deleted or edited; corrections are mirrored reversals that preserve the original |
| Money precision (Phase 2) | Prisma `Decimal` end-to-end; serialized to STRING on the wire; no float math |
| Concurrency-safe references (Phase 2) | `FinanceRefCounter` incremented inside `db.$transaction` so concurrent inserts cannot collide |
| Double-entry enforcement (Phase 2) | Posting engine verifies Σ(debit) = Σ(credit) before opening the transaction |
| 5-attempt lockout | `failedLoginAttempts` + `lockedUntil` on User |
| 8h session expiry | JWT `maxAge = 8h` |

---

## 14. Known limitations (Phase 1)

These are explicit Phase 1 limitations tracked for later phases:

1. **No rate limiting** beyond the 5-attempt login lockout — see §11.
2. **No file upload validation** — see §8.
3. **No Content-Security-Policy** — Phase 10.
4. **No PWA / service worker** — Phase 10.
5. **No backup / restore UI** — Phase 10. The SQLite file is on the same
   volume as the app server; backups must be performed out-of-band until
   Phase 10 ships.
6. **SQLite** is single-writer; concurrent write load in production should
   be modest for Phase 1. The MySQL migration in Phase 2 removes this
   ceiling.
7. **No 2FA / MFA** — Phase 10 will add TOTP for the MD and administrator
   roles.
8. **No password rotation policy enforcement** — `mustChangePassword` flag
   exists on the schema but is not yet enforced in the UI. Phase 10 will
   add a forced password-change screen.

---

## 15. Deferred hardening (Phase 10)

The Phase 1 audit identified two security trade-offs that are acceptable
for Phase 1 but should be revisited in Phase 10. They are tracked here so
they are not lost.

### JWT revocation latency

Permissions and the `isMD` flag are loaded into the JWT at sign-in
(`src/lib/permissions.ts` → `loadUserAuthData()`) and stored on the
session cookie for the full 8-hour `maxAge`. When a user's roles are
changed via `PUT /api/users/:id/roles`, when their permissions are
revoked via `PUT /api/roles/:id/permissions`, or when their account is
suspended via `PATCH /api/users/:id`, the change is **not** reflected
until the JWT expires or the user re-logs in. For up to 8 hours a
revoked or suspended user retains all prior permissions.

Phase 1 acceptance: the attack window is bounded (8h) and any
suspicious session can be cleared by an MD forcing the user's session
cookie off the device (sign-out via the audit log). This is documented
as a deliberate performance tradeoff: the JWT strategy avoids a DB hit
on every request.

Phase 10 options:

- Shorten the JWT `maxAge` (e.g. 1 hour) and add a sliding refresh —
  cheaper but the revocation window remains nonzero.
- Switch to a DB-backed session table (`sessionStrategy: "database"`)
  and invalidate by deleting the session row — zero revocation latency,
  higher per-request cost.
- Keep the JWT but add a lightweight `tokenVersion` column on `User`
  that the `jwt` callback checks against the DB on every request;
  bumping the version on revocation invalidates outstanding tokens.

### bcrypt cost factor

bcryptjs runs at cost factor **10** in Phase 1 (`src/lib/auth.ts`).
Cost 10 is the bcrypt library default and yields roughly 50–100 ms
hashing time per login on a typical dev machine — acceptable for the
expected Phase 1 user count.

Phase 10 recommendation: bump to cost factor **12** (roughly 4× slower
per attempt) before any production deployment. The trade-off is
increased per-login CPU on the app server; this is acceptable because
login is a low-frequency operation. The change is a one-line update
plus a one-time re-hash on next login (or a forced password reset for
all users — bcrypt hashes are self-describing, so old cost-10 hashes
continue to verify correctly with `bcrypt.compare`, they are just
re-hashed at the new cost on the next successful login).

### Roles hard-delete (deliberate design choice, not a deferral)

`DELETE /api/roles/:id` hard-deletes the role (rather than
soft-deleting). This is intentional and accepted as the long-term
behaviour, not a Phase 10 deferral:

- The handler blocks the deletion when `isSystem === true` (system
  roles cannot be removed) and when `_count.users > 0` (a role with
  assigned users cannot be removed until those users are reassigned).
- The cascade in `prisma/schema.prisma` cleanly removes the
  `RolePermission` and `UserRole` join rows when a role is deleted, so
  no orphan rows are left behind.
- Audit entries that reference the deleted role via `recordId` continue
  to exist (AuditLog rows are never deleted) — the JSON
  `previousValue`/`newValue` snapshots preserve the role's name and
  display name for forensic inspection even after the role row is gone.

If a soft-delete-on-roles behaviour is required in the future, the
`deletedAt` column already exists on the `Role` model and the create
endpoint already restores soft-deleted names — but the current
hard-delete path is the documented production behaviour.

---

## 16. Finance security (Phase 2)

Phase 2 ships the LBMS finance core as a journal/ledger double-entry
system. This section documents the security controls layered onto the
Phase 1 RBAC + audit foundation to protect financial data and
mutations.

### 16.1 Finance permissions (7 new actions)

The existing RBAC system gained 7 finance-specific actions in
`src/lib/permissions.ts` (the `PermissionAction` union type was
extended with: `post`, `void`, `reverse`, `manage_accounts`,
`manage_categories`, `view_reports`, `manage_opening_balances`).
These are enforced via the existing `authorize("finance", action)`
helper on every finance Route Handler. The MD retains its full
bypass as usual.

Finance action matrix:

| Action | Purpose | Default role grants |
| --- | --- | --- |
| `finance:view` | list income / expenses / transfers / transactions / accounts / categories | MD, finance_manager, operations_manager |
| `finance:create` | post income / expenses / transfers (delegates to `postJournal`) | MD, finance_manager |
| `finance:post` | post a draft journal (reserved for the future approval flow) | MD, finance_manager |
| `finance:void` | void a posted journal (reserved for the future approval flow) | MD, finance_manager |
| `finance:reverse` | reverse a posted journal (`POST /api/finance/transactions/[id]/reverse`) | MD, finance_manager |
| `finance:manage_accounts` | create / update / deactivate financial accounts | MD, finance_manager |
| `finance:manage_categories` | create / update / deactivate ledger categories | MD, finance_manager |
| `finance:view_reports` | consume the summary / account / category / reconciliation reports | MD, finance_manager, operations_manager |
| `finance:manage_opening_balances` | post an opening-balance journal (reserved; currently invoked inline by the account-creation POST when `openingBalance > 0`) | MD, finance_manager |

The `Administrator` role is intentionally restricted: it does NOT
automatically receive finance authoring permissions. An Administrator
who needs to post transactions must be granted a finance role (or the
MD must explicitly assign the relevant finance permissions). This
mirrors the Phase 1 design where the Administrator is a system
administration role, not a financial authoring role.

### 16.2 Server-side `authorize()` on every finance endpoint

Every Route Handler under `src/app/api/finance/*` calls
`authorize("finance", <action>)` before any database write or read.
Read endpoints (GET) require `finance:view`; report endpoints
require `finance:view_reports`; mutation endpoints require
`finance:create`, `finance:reverse`, `finance:manage_accounts`, or
`finance:manage_categories` depending on the action. There is no
finance endpoint that bypasses `authorize()`. The MD bypass is
preserved via the existing `ctx.isMD === true` short-circuit.

### 16.3 Privilege-escalation protection preserved

The Phase 1 audit hardening pass closed three critical privilege-
escalation paths (MD-role assignment, last-MD strip, self-deactivation).
Phase 2 introduces no regression on these controls — the finance
permission catalogue is added as new rows in the existing
`Permission` table; the `authorize()` helper is reused unchanged;
the MD-role assignment/revocation guard and the last-MD guard
continue to apply on every finance Route Handler that mutates a
User or Role (currently none do — finance endpoints mutate only
finance tables, not User/Role rows).

### 16.4 Audit logging on every finance mutation

Every finance mutation writes an `AuditLog` entry via the existing
`recordAudit()` helper (the only writer to `AuditLog`). The posting
engine itself (`src/lib/finance/posting-engine.ts`) writes the audit
entry AFTER the `db.$transaction` commits — the posting is the source
of truth and audit failure is best-effort (audit failure never rolls
back a posting). The audit entry captures:

- `userId` — the actor (the posting user).
- `action` — `"create"` for posts, `"reverse"` for reversals.
- `module` — `"finance"`.
- `recordId` — the new Journal's ID.
- `recordType` — `"Journal"`.
- `description` — e.g. `"Posted income journal INC-2026-000001
  (5000.00 GHS)"`.
- `newValue` — a JSON snapshot of the journal (reference, type,
  status, date, amount, currency, description, entry count).

For account and category mutations the Route Handlers use the
existing `auditFromCtx()` helper with `action: "create" | "update" |
"delete"` and `previousValue` + `newValue` snapshots (excluding
`passwordHash`, which is not relevant for finance rows).

### 16.5 Financial immutability — reversals, not deletes

Posted journals CANNOT be deleted and CANNOT be edited. The HTTP
surface exposes no PATCH on `/api/finance/transactions/[id]`; only
the `POST /api/finance/transactions/[id]/reverse` endpoint creates
the linked reversal. The reversal mirrors the entries (debit becomes
credit and vice versa), marks the original as `status = "reversed"`,
and preserves the original journal in the database — both stay in
balance derivation and net to zero (the correct accounting outcome).

This immutability is a security property: an attacker who obtains
`finance:create` permission cannot silently delete past transactions
to hide fraud. Every correction leaves a permanent audit trail, and
the original journal is preserved alongside its reversal.

### 16.6 Money precision as a security concern

Money precision is treated as a security property, not just a
correctness property. Phase 2 uses Prisma `Decimal` (decimal.js)
end-to-end on the server and serializes every money value to STRING
on the wire via `serializeMoney()`. The client never parses money
for calculation — it formats with `formatMoney()` for display only.

This prevents the classic JavaScript floating-point corruption
vulnerability where `0.1 + 0.2 === 0.30000000000000004` and a
balance drift accumulates over thousands of transactions. The
`toMoney()` parser rejects non-numeric input via `MoneyError`;
`toPositiveMoney()` requires `> 0`; `roundMoney()` rounds to 2 dp
with `ROUND_HALF_UP`. Negative amounts are rejected by the posting
engine (`debit.lt(0) || credit.lt(0)`).

The `@db.Decimal(18,2)` annotation is intentionally omitted from
the schema so it works on both SQLite (no native Decimal) and
PostgreSQL/MySQL (`DECIMAL(18,2)`) without modification. App-layer
validation enforces precision in dev. Production deployments MUST
use PostgreSQL 16+ or MySQL 8+ for DB-level precision enforcement.

### 16.7 Concurrency safety — reference generation inside transactions

The `FinanceRefCounter` table holds one row per `(prefix, year)`.
The posting engine increments `nextNumber` via Prisma's `upsert`
with `{ increment: 1 }` **inside the same `db.$transaction` that
creates the journal**. This guarantees that two concurrent POST
requests cannot both obtain the same reference number — even on
SQLite (which serialises writes), the transaction isolates the
counter increment from the journal insert so a partial failure
rolls both back.

This prevents a class of fraud where a race condition could produce
two journals with the same reference (which would corrupt the audit
trail's `recordId` correlation). On PostgreSQL/MySQL the same code
path benefits from row-level locking automatically.

### 16.8 Balance protection — double-entry enforcement

The posting engine verifies Σ(debit) = Σ(credit) BEFORE opening the
database transaction, and rejects with `FinanceBalanceError` (a
subclass of `FinanceValidationError`, HTTP 400) if the entries do
not balance. This prevents an attacker who obtains `finance:create`
permission from posting an unbalanced journal that would silently
drift account balances — the verification is enforced at the
application layer, not at the API layer, so direct callers of the
posting engine (e.g. the future approval flow) get the same
guarantee.

The `runReconciliation()` function in the reporting service is a
diagnostic that verifies every posted journal still balances. In
a healthy system it returns zero issues; any issues indicate a bug
in the posting engine that must be investigated.

### 16.9 Cross-currency protection

The posting engine rejects journals whose entries reference financial
accounts with mismatched currencies — Phase 2 does not support
cross-currency transactions. The transfer API additionally rejects
`from === to` (self-transfer) and cross-currency mismatches at the
API layer with HTTP 400.

### 16.10 Deletion guards — accounts with posted entries cannot be deleted

`DELETE /api/finance/accounts/[id]` returns 403 with a descriptive
error if the account has any posted journal entries. The recommended
action is to deactivate the account (`PATCH { status: "inactive" }`)
which preserves the historical journal entries and the derived
balance. This mirrors the Phase 1 design where roles with assigned
users cannot be deleted.
