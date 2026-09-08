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
| Input validation | Zod schemas on every mutation route |
| Output escaping | React JSX auto-escaping; no `dangerouslySetInnerHTML` |
| CSRF protection | NextAuth built-in CSRF token + SameSite cookies |
| Secure errors | JSON envelope, no stack traces leaked |
| Secrets in env | `.env` gitignored; `NEXTAUTH_SECRET` required |
| Soft-delete | `deletedAt` + `notDeleted()` filter on all reads |
| Last-MD guard | DELETE/PATCH on the last MD user is blocked server-side |
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
