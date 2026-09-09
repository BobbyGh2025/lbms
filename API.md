# API Reference

This document is the complete reference for every HTTP endpoint exposed by
LBMS in Phase 1. All endpoints are JSON-only. All endpoints except
NextAuth's session/credential callbacks require a valid NextAuth session
cookie.

---

## 1. Conventions

### Base URL

- Development: `http://localhost:3000` (when running `bun run dev`).
- Caddy gateway: `http://localhost:81` (see `DEPLOYMENT.md`).

### Authentication

All endpoints except `/api/auth/*` require a valid NextAuth session cookie
(`next-auth.session-token`). Anonymous requests receive HTTP 401:

```json
{ "error": "Authentication required." }
```

### Authorization

Each endpoint documents the required permission as `module:action` (e.g.
`users:view`). The MD role (`session.user.isMD === true`) bypasses every
permission check. Non-MD users without the required permission receive
HTTP 403:

```json
{ "error": "You are not authorized to perform this action." }
```

### Error envelope

All errors use the same shape:

```json
{
  "error": "Human-readable error message.",
  "code": "optional machine code",
  "details": "optional extra context (Zod issues, structured payload)"
}
```

Status codes used:

| Status | Meaning |
| --- | --- |
| 200 | OK — GET or successful PATCH / PUT |
| 201 | Created — POST that created a resource |
| 400 | Bad Request — Zod validation, JSON parse, uniqueness clash, business-rule guard, invalid audit date query |
| 401 | Unauthorized — no session |
| 403 | Forbidden — session present but missing permission, or self-delete / self-deactivation / last-MD guard / MD-role assignment-or-revocation-by-non-MD guard |
| 404 | Not Found — record not found or soft-deleted |
| 500 | Internal Server Error — unexpected (never returns a stack trace) |

### Pagination

List endpoints accept `page` and `pageSize` query params. Defaults:
`page = 1`, `pageSize = 20`. `pageSize` is clamped to `1..100`.

Response shape:

```json
{
  "items": [ /* records */ ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

### Content type

- All request bodies must be `application/json`.
- All responses are `application/json; charset=utf-8`.

### Dynamic route params

Next.js 16 Route Handlers receive dynamic params as a Promise:

```ts
{ params }: { params: Promise<{ id: string }> }
```

Inside the handler the params are awaited. Clients send the `id` as a
URL path segment (`/api/users/cx...`).

---

## 2. Endpoint inventory (by module)

| Module | Endpoint |
| --- | --- |
| auth | `POST /api/auth/callback/credentials`, `GET /api/auth/session`, `GET /api/auth/csrf`, `POST /api/auth/signout` (NextAuth) |
| dashboard | `GET /api/dashboard` |
| notifications | `GET /api/notifications`, `POST /api/notifications/read-all` |
| users | `GET /api/users`, `POST /api/users`, `GET /api/users/:id`, `PATCH /api/users/:id`, `DELETE /api/users/:id`, `GET /api/users/:id/roles`, `PUT /api/users/:id/roles`, `POST /api/users/:id/reset-password`, `GET /api/users/employees`, `GET /api/users/roles` |
| roles | `GET /api/roles`, `POST /api/roles`, `GET /api/roles/:id`, `PATCH /api/roles/:id`, `DELETE /api/roles/:id`, `GET /api/roles/:id/permissions`, `PUT /api/roles/:id/permissions` |
| permissions | `GET /api/permissions` |
| departments | `GET /api/departments`, `POST /api/departments`, `GET /api/departments/:id`, `PATCH /api/departments/:id`, `DELETE /api/departments/:id` |
| positions | `GET /api/positions`, `POST /api/positions`, `GET /api/positions/:id`, `PATCH /api/positions/:id`, `DELETE /api/positions/:id` |
| company-settings | `GET /api/company-settings`, `PUT /api/company-settings` |
| audit | `GET /api/audit`, `GET /api/audit/stats` |

---

## 3. Auth (NextAuth)

These endpoints are provided by the NextAuth route handler at
`src/app/api/auth/[...nextauth]/route.ts`. The configuration lives in
`src/lib/auth.ts`.

### `POST /api/auth/callback/credentials`

Sign in with email + password. The body is form-encoded by the NextAuth
client (`signIn("credentials", { email, password })`), not JSON.

- **Auth**: anonymous (this is the sign-in endpoint).
- **Body**: `email=...&password=...&csrfToken=...` (form-encoded).
- **Success**: HTTP 302 redirect to the `callbackUrl` (default `/`); sets
  the `next-auth.session-token` cookie.
- **Failure**: HTTP 401, returns to the sign-in page with an `error`
  query param.
- **Side effects**:
  - On success: writes `AuditLog` entry `action=login, module=auth`,
    resets `failedLoginAttempts=0`, `lockedUntil=null`, updates
    `lastLoginAt` + `lastLoginIp`.
  - On failure: writes `AuditLog` entry `action=login_failed,
    module=auth`. If the attempt count reaches 5, sets `lockedUntil =
    now + 15min`.

### `GET /api/auth/session`

Returns the current session as JSON, or `{}` if not signed in.

- **Auth**: anonymous.
- **Response (signed in)**:
  ```json
  {
    "user": {
      "id": "cx...",
      "email": "md@lightworld.tech",
      "name": "md",
      "username": "md",
      "roles": ["md"],
      "permissions": ["dashboard:view", "users:view", ...],
      "isMD": true
    },
    "expires": "2025-01-01T00:00:00.000Z"
  }
  ```

### `GET /api/auth/csrf`

Returns the CSRF token + cookie. Required before calling
`POST /api/auth/callback/credentials`.

- **Auth**: anonymous.
- **Response**: `{ "csrfToken": "..." }`.

### `POST /api/auth/signout`

Signs the user out. Clears the session cookie.

- **Auth**: requires a valid session.
- **Body**: `csrfToken=...` (form-encoded).
- **Side effect**: writes `AuditLog` entry `action=logout, module=auth`
  (best-effort via the `events.signOut` callback).

---

## 4. Root

> **Removed in Phase 1 audit hardening pass.** The legacy
> `GET /api` ("Hello, world!") health-check endpoint inherited from the
> original scaffold was deleted. It was unauthenticated, carried no
> business value, and expanded the public attack surface for no gain.
> `GET /api` now returns Next.js's default 404.

---

## 5. Dashboard

### `GET /api/dashboard`

Returns the executive-dashboard payload — currency symbol, financial KPIs,
business KPIs, alerts, and a cash-flow series.

- **Auth**: `dashboard:view` permission required (enforced as of the
  Phase 1 audit hardening pass; previously this endpoint only checked
  session existence). Every seeded role already carries
  `dashboard:view`, so legitimate access is unchanged; the route is now
  correctly gated for the contract. MD bypasses the check as usual.
- **Response**:
  ```json
  {
    "currencySymbol": "GH₵",
    "financial": {
      "todayIncome": 0,
      "todayExpenditure": 0,
      "monthlyIncome": 0,
      "monthlyExpenditure": 0,
      "monthlyProfit": 0,
      "cashBalance": 0,
      "accountsReceivable": 0,
      "accountsPayable": 0,
      "outstandingInvoices": 0,
      "upcomingPayments": 0
    },
    "business": {
      "totalCustomers": 0,
      "activeCustomers": 0,
      "totalStaff": 7,
      "activeProjects": 0,
      "completedProjects": 0,
      "pendingProjects": 0,
      "upcomingProjects": 0,
      "overdueTasks": 0
    },
    "alerts": [],
    "cashFlowSeries": []
  }
  ```

**Phase 1 note**: all financial and most business KPIs are zero because
the finance / project / customer modules land in later phases. The
`totalStaff` count is real (derived from the `Employee` table). The
response shape is stable; downstream phases will populate the zeros.

---

## 6. Notifications

### `GET /api/notifications`

Returns the 30 most recent notifications for the signed-in user.

- **Auth**: any signed-in user.
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "title": "Welcome to LBMS",
        "message": "...",
        "type": "success",
        "category": "system",
        "linkUrl": null,
        "isRead": false,
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/notifications/read-all`

Marks all unread notifications for the signed-in user as read.

- **Auth**: any signed-in user.
- **Body**: none.
- **Response**: `{ "updated": <number> }` — the count of rows updated.
- **Audit**: writes `AuditLog` entry
  `action=update, module=notifications, description="Marked N notification(s) as read"`.

---

## 7. Users

### `GET /api/users`

Paginated list of non-soft-deleted users. Never returns `passwordHash`.

- **Auth**: `users:view`.
- **Query**: `page`, `pageSize`, `search` (matches `email` or `username`
  via `contains`), `status` (`active | inactive | suspended | all`).
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "email": "md@lightworld.tech",
        "username": "md",
        "status": "active",
        "lastLoginAt": "2025-01-01T00:00:00.000Z",
        "lastLoginIp": "127.0.0.1",
        "mustChangePassword": false,
        "createdAt": "...",
        "updatedAt": "...",
        "employee": { "id": "cx...", "employeeId": "LT-EMP-0001", "fullName": "Lightworld MD" },
        "roles": [ { "id": "cx...", "name": "md", "displayName": "Managing Director" } ]
      }
    ],
    "total": 2,
    "page": 1,
    "pageSize": 20
  }
  ```

### `POST /api/users`

Create a new user. Hashes the password with bcrypt cost 10.

- **Auth**: `users:create`.
- **Body**:
  ```json
  {
    "email": "user@lightworld.tech",
    "username": "user",
    "password": "password123",
    "employeeId": "cx...",
    "roleIds": ["cx..."],
    "status": "active"
  }
  ```
  - `email`: required, must be a valid email.
  - `username`: required, min 3 chars.
  - `password`: required, min 8 chars.
  - `employeeId`: optional; if provided, must point to an active/on_leave
    employee not already linked to another live user.
  - `roleIds`: array of role IDs; defaults to `[]`. All must exist and not
    be soft-deleted.
  - `status`: optional; defaults to `active`. One of
    `active | inactive | suspended`.
- **Guards** (added in Phase 1 audit hardening pass):
  - **MD-role assignment guard**: if the caller is not MD
    (`ctx.isMD === false`) and any candidate role in `roleIds` has
    `name === "md"`, the request is rejected with HTTP 403
    `"Only the Managing Director may assign the 'md' role."` before
    any database write. The MD bypasses this check and may assign the
    `md` role freely. This prevents a non-MD administrator or HR
    manager from creating a new user with MD access in a single
    request.
- **Success**: HTTP 201 with the created user (same shape as a list item,
  plus `employeeId`).
- **Errors**:
  - 400 if email or username already exists (with a different message
    for soft-deleted collisions).
  - 400 if any role ID is invalid.
  - 400 if the employee is missing or already linked.
  - 403 if the caller is not MD and `roleIds` contains the MD role.
- **Audit**: `action=create, module=users, recordType=User, newValue=<user>`.

### `GET /api/users/:id`

Fetch a single user.

- **Auth**: `users:view`.
- **Success**: 200 with the user object (includes `employeeId`).
- **Errors**: 404 if the user is missing or soft-deleted.

### `PATCH /api/users/:id`

Partial update of a user. `passwordHash` is re-hashed when `password` is
provided.

- **Auth**: `users:edit`.
- **Body** (any subset):
  ```json
  {
    "email": "...",
    "username": "...",
    "status": "active | inactive | suspended",
    "employeeId": "cx..." | null,
    "password": "..."
  }
  ```
- **Guards**:
  - At least one field must be provided (Zod `.refine`).
  - Email / username uniqueness is re-checked (excluding the row itself).
  - Re-linking an employee validates that the employee is not already
    linked to another live user.
  - **Self-deactivation block** (added in Phase 1 audit hardening
    pass): if `auth.ctx.userId === id` and `data.status` is provided
    and is not `"active"`, the request is rejected with HTTP 403
    `"You cannot deactivate or suspend your own account."`. Brings
    the PATCH handler to parity with the existing DELETE
    self-deletion guard.
  - **Last-MD guard**: if the user is an MD (`role.name === "md"`) and the
    requested `status` is not `active`, the endpoint counts MD users
    (excluding this one); if the count is `<= 1`, returns 400
    `"Cannot deactivate or suspend the last Managing Director account."`.
- **Success**: 200 with the updated user.
- **Errors**:
  - 400 if no fields provided (Zod refine).
  - 400 if email/username uniqueness clashes.
  - 400 on last-MD guard.
  - 403 on self-deactivation.
- **Audit**: `action=update, module=users, recordType=User`,
  `previousValue` + `newValue` (both exclude `passwordHash`).

### `DELETE /api/users/:id`

Soft-delete a user. Sets `deletedAt`, `status="inactive"`, `employeeId=null`.

- **Auth**: `users:delete`.
- **Guards**:
  - Cannot delete self (`403 You cannot delete your own account.`).
  - **Last-MD guard**: if the user is an MD and is the only MD, returns
    `403 Cannot delete the last Managing Director account.`
- **Success**: 200 with `{ "id": "...", "deletedAt": "..." }`.
- **Audit**: `action=delete, module=users, recordType=User`,
  `previousValue=<user>`.

### `GET /api/users/:id/roles`

List the user's role assignments.

- **Auth**: `users:view`.
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "name": "md",
        "displayName": "Managing Director",
        "isSystem": true,
        "assignedAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `PUT /api/users/:id/roles`

Replace the user's roles atomically.

- **Auth**: `users:edit`.
- **Body**: `{ "roleIds": ["cx...", "cx..."] }`
- **Behaviour**: de-duplicates the array, validates each ID exists and is
  not soft-deleted, then within a `$transaction` deletes all existing
  `UserRole` rows for the user and recreates the new set.
- **Guards** (added in Phase 1 audit hardening pass):
  - **MD-role assignment guard**: if the caller is not MD
    (`ctx.isMD === false`) and any candidate role in the new
    `roleIds` has `name === "md"`, the request is rejected with
    HTTP 403 `"Only the Managing Director may assign the 'md' role."`
    before the transaction begins. This closes the hole where a
    non-MD administrator could grant themselves MD via
    `PUT /api/users/<self-id>/roles { roleIds: ["<md-role-id>"] }`.
  - **MD-role revocation guard**: if the caller is not MD and the
    target user currently has the MD role but the new `roleIds` do
    not include it, the request is rejected with HTTP 403 (a non-MD
    user cannot strip the MD role from anyone, including themselves).
  - **Last-MD guard**: if the target user is currently MD, the new
    `roleIds` omit `md`, and no other MD user remains in the system,
    the request is rejected with HTTP 400
    `"Cannot remove the 'md' role from the last Managing Director
    account."`. The MD caller can still reassign roles away from a
    non-last MD.
- **Errors**:
  - 400 if any role ID is invalid or soft-deleted.
  - 400 on last-MD guard.
  - 403 if a non-MD caller attempts to assign or remove the MD role.
- **Audit**: `action=update, module=users, recordType=User`,
  `previousValue={ roleIds: [...] }`, `newValue={ roleIds: [...] }`.

### `POST /api/users/:id/reset-password`

Reset a user's password. Hashes the new password, clears lockout state.

- **Auth**: `users:edit`.
- **Body**: `{ "password": "newpassword" }` (min 8 chars).
- **Side effects**:
  - `passwordHash` replaced (bcrypt cost 10).
  - `failedLoginAttempts = 0`, `lockedUntil = null`,
    `mustChangePassword = false`.
- **Response**: `{ "ok": true }`.
- **Audit**: `action=update, module=users, recordType=User,
  description="Password reset for <username> (<email>)"`. The new password
  is **never** included in the audit payload.

### `GET /api/users/employees`

Thin picker for the user form. Returns active / on_leave employees that
are not currently linked to a live user.

- **Auth**: `users:view`.
- **Query**: `includeEmployeeId=<id>` (optional; the Edit form passes
  this so the currently-linked employee is included in the list).
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "employeeId": "LT-EMP-0001",
        "fullName": "Lightworld MD",
        "departmentName": "Management"
      }
    ]
  }
  ```

### `GET /api/users/roles`

Thin picker for the user form. Returns all non-deleted roles.

- **Auth**: `users:view`.
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "name": "md",
        "displayName": "Managing Director",
        "isSystem": true,
        "description": "Full access..."
      }
    ]
  }
  ```

---

## 8. Roles

### `GET /api/roles`

List all non-deleted roles with their permissions and user counts. System
roles come first.

- **Auth**: `roles:view`.
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "name": "md",
        "displayName": "Managing Director",
        "description": "Full access...",
        "isSystem": true,
        "createdAt": "...",
        "permissions": [
          { "id": "cx...", "module": "users", "action": "view" }
        ],
        "_count": { "users": 1 }
      }
    ]
  }
  ```

### `POST /api/roles`

Create a new role + an initial permission set.

- **Auth**: `roles:create`.
- **Body**:
  ```json
  {
    "name": "team_lead",
    "displayName": "Team Lead",
    "description": "...",
    "permissionKeys": ["users:view", "tasks:view", "tasks:edit"]
  }
  ```
  - `name`: regex `^[a-z][a-z0-9_]*$` — lowercase, no spaces, starts with
    a letter.
  - `displayName`: min 2 chars.
  - `permissionKeys`: array of `"module:action"` strings. Unknown keys are
    dropped silently with a `console.warn`.
- **Soft-deleted restore**: if a soft-deleted role with the same `name`
  exists, the endpoint restores it (re-uses the row id) instead of
  failing the unique constraint.
- **Success**: HTTP 201 with the created role (same shape as a list item).
- **Audit**: `action=create, module=roles, recordType=Role,
  newValue={ name, displayName, description, permissionKeys }`.

### `GET /api/roles/:id`

Fetch a single role with its full permission list + user count.

- **Auth**: `roles:view`.
- **Errors**: 404 if missing or soft-deleted.

### `PATCH /api/roles/:id`

Update `displayName` and/or `description` only. The role `name` cannot
be changed via this endpoint (it is the canonical key in the JWT).

- **Auth**: `roles:edit`.
- **Body**: `{ "displayName": "...", "description": "..." | null }`
  (at least one field required).
- **Audit**: `action=update, module=roles, recordType=Role`.

### `DELETE /api/roles/:id`

Hard-delete a non-system role with no users assigned. Cascades
`RolePermission` and `UserRole` rows.

- **Auth**: `roles:delete`.
- **Guards**:
  - 400 if `isSystem === true` — `"System roles cannot be deleted."`.
  - 400 if `_count.users > 0` — `"Role has N user(s) assigned; reassign
    them first."`.
- **Response**: `{ "id": "...", "deleted": true }`.
- **Audit**: `action=delete, module=roles, recordType=Role,
  previousValue={ name, displayName, description, isSystem }`.

### `GET /api/roles/:id/permissions`

Return the role's current permission keys as `"module:action"` strings.

- **Auth**: `roles:view`.
- **Response**: `{ "permissionKeys": ["users:view", ...] }`.

### `PUT /api/roles/:id/permissions`

Replace the role's entire permission set atomically.

- **Auth**: `roles:edit`.
- **Body**: `{ "permissionKeys": ["users:view", ...] }`.
- **Behaviour**: de-duplicates keys, validates each against the canonical
  catalogue (unknown keys dropped + logged), resolves to `Permission` IDs,
  then within a `$transaction` deletes all existing `RolePermission` rows
  for the role and recreates the new set.
- **Response**:
  ```json
  {
    "permissionKeys": ["users:view", ...],
    "skippedCount": 0
  }
  ```
- **Audit**: `action=update, module=roles, recordType=RolePermission,
  previousValue={ permissionKeys: [...] },
  newValue={ permissionKeys: [...], skippedCount: 0 }`.

---

## 9. Permissions

### `GET /api/permissions`

Returns the entire permission catalogue grouped by module, in canonical
order.

- **Auth**: `roles:view` (the catalogue is consumed by the Roles view's
  permission matrix).
- **Response**:
  ```json
  {
    "modules": [
      {
        "module": "dashboard",
        "permissions": [
          { "id": "cx...", "module": "dashboard", "action": "view" },
          { "id": "cx...", "module": "dashboard", "action": "create" }
        ]
      }
    ]
  }
  ```

Modules with no permission rows in the DB are omitted from the response
(in practice all 25 modules are populated by the seed, so all 25 appear).

---

## 10. Departments

### `GET /api/departments`

List non-soft-deleted departments with position + employee counts.

- **Auth**: `departments:view`.
- **Query**: `search` (matches `name`), `status` (`active | inactive`).
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "name": "Management",
        "code": "MGMT",
        "description": "Executive management office.",
        "status": "active",
        "createdAt": "...",
        "_count": { "positions": 2, "employees": 1 }
      }
    ]
  }
  ```
- **Note**: `_count.positions` and `_count.employees` use Prisma filtered
  counts so soft-deleted children are excluded.

### `POST /api/departments`

Create a department.

- **Auth**: `departments:create`.
- **Body**: `{ "name": "Engineering", "code": "ENG", "description": "..." }`
  - `name`: required, max 100 chars, unique among non-deleted.
  - `code`: optional; if provided, uppercased and must be unique.
  - `description`: optional.
- **Success**: HTTP 201 with the created department.
- **Audit**: `action=create, module=departments, recordType=Department,
  newValue=<dept>`.

### `GET /api/departments/:id`

Fetch a single department with its positions (sorted by title) and counts.

- **Auth**: `departments:view`.
- **Response**: the department object plus a `positions[]` array; each
  position carries `_count.employees`.

### `PATCH /api/departments/:id`

Update a department.

- **Auth**: `departments:edit`.
- **Body** (any subset): `{ "name", "code", "description", "status" }`
  - `status` restricted to `active | inactive`.
  - `code` uppercased; null / empty string normalises to `null`.
- **Guards**: name + code uniqueness re-checked (excluding self). At least
  one field required.
- **Audit**: `action=update, module=departments, recordType=Department,
  previousValue + newValue`.

### `DELETE /api/departments/:id`

Soft-delete a department.

- **Auth**: `departments:delete`.
- **Guards**: 400 if the department has active employees or positions —
  the response body includes `{ activeEmployees, activePositions }` so the
  UI can show actionable guidance:
  ```json
  {
    "error": "Cannot delete a department that still has active employees or positions. Reassign or remove them first.",
    "details": { "activeEmployees": 3, "activePositions": 2 }
  }
  ```
- **Behaviour**: sets `deletedAt = now()` and `status = "inactive"`.
- **Audit**: `action=delete, module=departments, recordType=Department,
  previousValue=<dept>`.

---

## 11. Positions

Positions share the `departments` permission namespace.

### `GET /api/positions`

List non-soft-deleted positions with department + employee counts.

- **Auth**: `departments:view`.
- **Query**: `departmentId`, `search` (matches `title`), `status`.
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "title": "Managing Director",
        "departmentId": "cx...",
        "department": { "name": "Management", "code": "MGMT" },
        "description": "...",
        "status": "active",
        "_count": { "employees": 1 }
      }
    ]
  }
  ```

### `POST /api/positions`

Create a position.

- **Auth**: `departments:create`.
- **Body**: `{ "title": "...", "departmentId": "cx...", "description": "..." }`
  - `title`: required, max 100 chars, unique among non-deleted.
  - `departmentId`: optional; if provided, must point to an active
    department.
- **Audit**: `action=create, module=departments, recordType=Position,
  newValue=<position>`.

### `GET /api/positions/:id`

Fetch a single position with its department + employee count.

- **Auth**: `departments:view`.

### `PATCH /api/positions/:id`

Update a position. Same shape as the department PATCH (title,
departmentId, description, status).

- **Auth**: `departments:edit`.
- **Audit**: `action=update, module=departments, recordType=Position`.

### `DELETE /api/positions/:id`

Soft-delete a position. Blocked when active employees are attached.

- **Auth**: `departments:delete`.
- **Errors**: 400 with `{ activeEmployees }` if any active employees are
  attached to the position.
- **Audit**: `action=delete, module=departments, recordType=Position,
  previousValue=<position>`.

---

## 12. Company Settings

### `GET /api/company-settings`

Return the singleton company-settings row. Creates it with Prisma defaults
if missing (defensive — the seed already creates it).

- **Auth**: `settings:view`.
- **Response**: the full `CompanySetting` row.

### `PUT /api/company-settings`

Partial update of the singleton. Empty strings are normalised to `null`
for nullable fields before the write.

- **Auth**: `settings:edit`.
- **Body** (any subset):
  ```json
  {
    "companyName": "Lightworld Tech",
    "legalName": "Lightworld Tech Ltd",
    "logoUrl": "https://...",
    "address": "...",
    "city": "Accra",
    "region": "Greater Accra",
    "country": "Ghana",
    "phone": "+233 ...",
    "email": "info@lightworld.tech",
    "website": "https://...",
    "currency": "GHS",
    "currencySymbol": "GH₵",
    "financialYearStart": "01-01",
    "invoicePrefix": "INV-",
    "invoiceStart": 1,
    "taxIdNumber": "..."
  }
  ```
- **Validation**:
  - `currency`: must be exactly 3 uppercase letters (regex `^[A-Z]{3}$`).
  - `email`: if provided, must be email-shaped (or empty string, which
    becomes `null`).
  - `invoiceStart`: integer `>= 0`.
  - Each string field is trimmed and max-length-bounded.
- **Behaviour**: only provided keys are written; unspecified fields retain
  their existing values. If the row is missing, it is created.
- **Audit**: `action=update, module=settings, recordType=CompanySetting,
  recordId="singleton", previousValue=<old row>, newValue=<new row>`.

---

## 13. Audit

The audit resource is **read-only** by design. There are no
`POST`/`PATCH`/`DELETE` endpoints.

### `GET /api/audit`

Paginated, filterable list of audit log entries.

- **Auth**: `audit:view`.
- **Query**:
  - `page`, `pageSize` — standard pagination.
  - `search` — matches `description` via `contains`.
  - `module` — exact match (e.g. `users`, `auth`, `departments`).
  - `action` — exact match (one of `login | logout | login_failed |
    create | update | delete | approve | reject | view_sensitive |
    export | system`).
  - `userId` — exact match.
  - `from` — ISO date or date-time; lower bound on `createdAt`.
  - `to` — ISO date or date-time; upper bound on `createdAt`. **Note**: if
    `to` is a date-only string (`YYYY-MM-DD`), the upper bound is advanced
    by 24 hours so the entire day is covered (SQLite stores full ISO
    timestamps).
- **Response**:
  ```json
  {
    "items": [
      {
        "id": "cx...",
        "userId": "cx...",
        "action": "login",
        "module": "auth",
        "recordId": null,
        "recordType": null,
        "description": "User md signed in",
        "ipAddress": "127.0.0.1",
        "userAgent": "Mozilla/...",
        "previousValue": null,
        "newValue": null,
        "createdAt": "2025-01-01T00:00:00.000Z",
        "user": { "id": "cx...", "email": "md@lightworld.tech", "name": "md" }
      }
    ],
    "total": 150,
    "page": 1,
    "pageSize": 20
  }
  ```
- **Marked `dynamic = "force-dynamic"`** so the response is never cached.
- **Error handling** (hardened in Phase 1 audit pass): the entire
  handler — date parsing, Prisma `count`, and `findMany` — is wrapped in
  a single `try`/`catch`. Invalid `from` / `to` query params (any
  string `new Date()` cannot parse, e.g. `"yesterday"` or `"2025-13-99"`)
  are now detected before the Prisma call and rejected with HTTP 400
  `"Invalid date format for the 'from'/'to' parameter."`. Previously
  an unparseable date produced `Invalid Date` and Prisma threw an
  unhandled error that surfaced as HTTP 500 with a stack trace in
  development. Unexpected Prisma errors are also caught and returned
  as a generic HTTP 500 envelope (no stack trace) — see §9 of
  `SECURITY.md`.

### `GET /api/audit/stats`

Lightweight summary used by the audit view header.

- **Auth**: `audit:view`.
- **Response**:
  ```json
  {
    "total": 150,
    "last24h": 12,
    "byModule": { "auth": 4, "users": 3, "departments": 2, "settings": 1 },
    "byAction": { "login": 4, "create": 3, "update": 3, "delete": 1 }
  }
  ```
- `byModule` is the top 8 modules by count.
- `byAction` is all actions.

---

## 14. Standard error catalogue

| Status | `error` | When |
| --- | --- | --- |
| 400 | `"Invalid JSON body."` | Non-JSON or malformed JSON body |
| 400 | `"<first zod issue message>"` with `details = zod.issues` | Validation failure |
| 400 | `"Validation failed."` with `details = zod.flatten()` | Company-settings PUT |
| 400 | `"An account with this email already exists."` (or `username`) | Users create/PATCH uniqueness clash |
| 400 | `"Cannot delete a department that still has active employees or positions..."` with `details = { activeEmployees, activePositions }` | Department DELETE guard |
| 400 | `"System roles cannot be deleted."` | Role DELETE on system role |
| 400 | `"Role has N user(s) assigned; reassign them first."` | Role DELETE with users assigned |
| 400 | `"Cannot deactivate or suspend the last Managing Director account."` | Users PATCH last-MD guard |
| 400 | `"Cannot remove the 'md' role from the last Managing Director account."` | Users PUT roles last-MD guard (added in audit pass) |
| 400 | `"Invalid date format for the 'from'/'to' parameter."` | Audit GET with unparseable date query (added in audit pass) |
| 401 | `"Authentication required."` | No session |
| 401 | `"Unauthorized"` | Notifications (legacy short form) |
| 403 | `"You are not authorized to perform this action."` | Missing permission, non-MD |
| 403 | `"You cannot delete your own account."` | Self-delete |
| 403 | `"You cannot deactivate or suspend your own account."` | Self-deactivation via PATCH (added in audit pass) |
| 403 | `"Cannot delete the last Managing Director account."` | Last-MD delete guard |
| 403 | `"Only the Managing Director may assign the 'md' role."` | Non-MD attempting MD-role assign/revoke via POST users or PUT roles (added in audit pass) |
| 404 | `"User not found."` / `"Role not found."` / `"Department not found."` / `"Position not found."` | Record missing or soft-deleted |
| 500 | (generic message) | Unexpected server error — never a stack trace |
