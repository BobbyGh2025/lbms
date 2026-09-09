# Testing

This document describes the LBMS testing strategy. It covers what was
verified in Phase 1, the testing categories required by the
specification, and the plan for automated tests in later phases.

> **Sandbox constraint**: per environment rules, no test code is written
> in this sandbox. This document captures the **plan** for automated
> tests in later phases — no test files are committed.

---

## 1. Phase 1 verification (manual, via Agent Browser)

Phase 1 was verified by manual end-to-end passes through the running
application using the Agent Browser skill. Each pass exercised one
functional area against the live `bun run dev` server on port 3000.

### 1.1 Login flow

| Step | Expected result | Status |
| --- | --- | --- |
| Navigate to `http://localhost:3000` while signed out | `LoginScreen` renders with email + password fields, demo-credential hint | Pass |
| Submit with wrong password | Stays on login screen; audit log gains a `login_failed` entry | Pass |
| Submit 5 wrong passwords in a row | 5th attempt triggers account lockout; subsequent attempts rejected before bcrypt compare | Pass |
| Submit with `md@lightworld.tech` / `Lightworld@2025` | Redirect to dashboard; sidebar + topbar + footer chrome mounts | Pass |
| Submit with `admin@lightworld.tech` / `Admin@2025` | Redirect to dashboard | Pass |
| Click "Sign out" in user menu | Returns to login screen; audit log gains a `logout` entry | Pass |
| Submit a locked account's correct password within the 15-min window | Rejected with locked message | Pass |
| Submit after the 15-min window expires | Login succeeds; `failedLoginAttempts` reset to 0 | Pass |

### 1.2 Dashboard render

| Step | Expected result | Status |
| --- | --- | --- |
| Land on `/` after sign-in | Dashboard view mounts; `?view=dashboard` is implicit | Pass |
| 10 financial KPI cards render | All cards visible with currency symbol `GH₵`; financial values are 0 (Phase 1 placeholder) | Pass |
| 8 business KPI cards render | `Total Staff` shows 7 (real); other business KPIs show 0 | Pass |
| Cash-flow area chart renders | Recharts AreaChart renders empty (Phase 1) | Pass |
| Alerts panel renders | Empty-state copy is shown | Pass |
| Theme toggle | Light/Dark/System cycle works without remount | Pass |

### 1.3 Navigation

| Step | Expected result | Status |
| --- | --- | --- |
| Click each sidebar item | `?view=` query param updates; the matching view mounts; back button returns to previous view | Pass |
| Click "Departments & Positions" | Two-pane master-detail view renders; left = department list, right = positions table | Pass |
| Click "Users" | User table renders with pagination, search, status filter | Pass |
| Click "Roles & Permissions" | Roles card grid renders; clicking "Permissions" opens the 25×6 matrix dialog | Pass |
| Click "Company Settings" | Tabbed form renders with three tabs: Company Profile, Financial, Scope | Pass |
| Click "Audit Trail" | Stat cards + filter bar + audit log table render | Pass |
| Click a Phase 2+ nav item (e.g. "Income") | `ComingSoonView` renders with the module label and phase number | Pass |
| Reload the page mid-module | URL query param is preserved; the same view remounts | Pass |

### 1.4 RBAC enforcement

The RBAC matrix was verified against each of the 7 seeded roles. For
every Phase 1 module the following was checked:

| Check | Method | Result |
| --- | --- | --- |
| MD sees all sidebar items | Sign in as MD; sidebar shows every module | Pass |
| Administrator sees admin + dashboard + audit; finance items hidden | Sign in as admin; verify sidebar | Pass |
| Employee sees only dashboard + notifications + tasks + documents | Sign in as a user with the `employee` role | Pass |
| Non-MD user without `users:create` does not see the "New User" button | Client-side gating via `useAuth().can(...)` | Pass |
| Non-MD user without `users:create` who POSTs to `/api/users` anyway | Server returns 403 | Pass |
| Non-MD user with `users:create` who POSTs to `/api/users` with the MD role in `roleIds` | Server returns 403 (added in audit hardening pass — see §1.7) | Pass |
| Non-MD user without `audit:view` who GETs `/api/audit` | Server returns 403 | Pass |
| MD can POST to any module route even without explicit permission | Server returns 200/201 | Pass |
| Soft-deleted user is invisible in `/api/users` list | `notDeleted()` filter verified | Pass |
| Self-delete returns 403 | MD or admin attempting to delete self | Pass |
| Self-deactivation (PATCH `status` to `inactive`/`suspended` on own account) returns 403 | Added in audit hardening pass — see §1.7 | Pass |
| Last-MD delete returns 403 | DELETE on the only MD-linked user | Pass |
| Last-MD suspend returns 400 | PATCH status to non-active on the only MD | Pass |
| Last-MD role-strip via `PUT /api/users/:id/roles` returns 400/403 | Added in audit hardening pass — see §1.7 | Pass |

### 1.5 CRUD on each Phase 1 admin module

For each of the five Phase 1 admin modules, the full create / read /
update / delete cycle was exercised through the UI and verified against
the audit log:

#### Users
- Create user (with employee + roles) → user appears in list; audit entry
  `action=create, module=users`.
- Edit user (rename, change status, re-link employee) → audit entry
  `action=update` with `previousValue + newValue`.
- Manage roles dialog → PUT `/api/users/:id/roles` replaces the role set;
  audit entry captures the role diff.
- Reset password → audit entry `description="Password reset for …"`.
- Soft-delete (with last-MD guard) → user disappears from list but row
  remains with `deletedAt`; audit entry `action=delete`.

#### Roles & Permissions
- Create custom role with a subset of permissions → role appears at the
  end of the grid (after system roles).
- Edit role display name → audit entry `action=update`.
- Permission matrix: toggle modules × actions; save → PUT replaces the
  permission set atomically; audit captures `previousValue.permissionKeys`
  vs `newValue.permissionKeys`.
- Delete custom role with no users → cascades cleanly.
- Delete system role → blocked with 400 `"System roles cannot be
  deleted."`.
- Delete role with users assigned → blocked with 400 `"Role has N
  user(s) assigned..."`.

#### Departments & Positions
- Create department → appears in list with position/employee counts.
- Edit department (rename, change code, status) → audit captures diff.
- Delete department with active employees → blocked with 400 +
  `{ activeEmployees, activePositions }` details.
- Delete department with no children → soft-deleted.
- Create position with department link → appears in right pane.
- Edit / delete position with the same guards.

#### Company Settings
- GET singleton → returns seeded row.
- PUT partial update (currency, address, etc.) → audit captures
  `previousValue + newValue`.
- Validation: invalid currency code (e.g. `"ghana"`) → 400 with Zod
  flatten; invalid email → 400.
- Empty strings are normalised to `null` for nullable fields.
- Read-only mode for users without `settings:edit` (non-MD) → all
  inputs disabled; save bar hidden.

#### Audit Trail
- GET `/api/audit` paginated list renders in table.
- Filter by module / action / date range / search.
- Expandable rows show `previousValue` + `newValue` as pretty-printed
  JSON.
- Stats cards render (`/api/audit/stats`).
- No `POST`/`PATCH`/`DELETE` endpoint exists on the audit resource
  (immutability confirmed by inspection).

### 1.6 Cross-cutting checks

| Check | Result |
| --- | --- |
| `passwordHash` is never in any API response | Verified by inspecting network tab on every list + detail call |
| `passwordHash` is never in any audit `previousValue`/`newValue` | Verified by expanding audit rows after user updates |
| Toast notifications fire on every save/error | Pass |
| Loading skeletons render while fetching | Pass |
| Empty states render when no rows match | Pass |
| Mobile responsive layout (375px viewport) | Sidebar collapses; topbar hamburger works; tables scroll horizontally |
| Dark mode preserves contrast | Pass — emerald primary + slate-teal sidebar hold up in both themes |

### 1.7 Phase 1 audit RBAC verification (scripted)

After the Phase 1 audit hardening pass (see `CHANGELOG.md` →
"Phase 1 Audit & Hardening Pass"), a scripted RBAC probe was run against
the live `bun run dev` server. The probe methodology was:

1. One test user per system role was created (`md`, `administrator`,
   `finance_manager`, `operations_manager`, `hr_manager`,
   `project_manager`, `employee`) — each with a distinct email and a
   known password.
2. Each test user was signed in via the NextAuth credentials flow
   (`POST /api/auth/callback/credentials`) and issued a session cookie.
3. Using that session cookie, the test harness probed 9 protected API
   endpoints and recorded the HTTP status code.
4. Two privilege-escalation attempts were made by the `administrator`
   test user (the highest-privilege non-MD role).
5. Three unauthenticated attempts were made with no session cookie.

**Result: 14/14 PASS, 0 FAIL.**

#### Per-role probe results

The table below shows the HTTP status returned per role per endpoint.
The expected behaviour is shown in parentheses; all actual results
matched expected.

| Endpoint | `md` | `administrator` | `finance_manager` | `operations_manager` | `hr_manager` | `project_manager` | `employee` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/dashboard` | 200 | 200 | 200 | 200 | 200 | 200 | 200 (all roles have `dashboard:view`) |
| `GET /api/users` | 200 | 200 | 403 | 403 | 403 | 403 | 403 (only `md` + `administrator`) |
| `POST /api/users` (create) | 201 | 201 | 403 | 403 | 403 | 403 | 403 |
| `GET /api/roles` | 200 | 200 | 403 | 403 | 403 | 403 | 403 (only `md` + `administrator`) |
| `GET /api/departments` | 200 | 200 | 403 | 403 | 200 | 403 | 403 (`md` + `administrator` + `hr_manager`) |
| `GET /api/positions` | 200 | 200 | 403 | 403 | 200 | 403 | 403 (shares `departments:view`) |
| `GET /api/company-settings` | 200 | 200 | 403 | 403 | 403 | 403 | 403 (only `md` + `administrator`) |
| `GET /api/audit` | 200 | 200 | 403 | 403 | 403 | 403 | 403 (only `md` + `administrator`) |
| `GET /api/notifications` | 200 | 200 | 200 | 200 | 200 | 200 | 200 (scoped to own `userId`) |

All 63 cells (7 roles × 9 endpoints) returned the expected status code.
The non-trivial expectations that were verified:

- All 7 roles can access `/api/dashboard` (200) — correct, every role
  has `dashboard:view`. (Before the audit, this endpoint only checked
  session existence; the audit pass added the `dashboard:view` check,
  which every seeded role already satisfies.)
- Only `md` + `administrator` can list/create users; all other roles
  get 403.
- Only `md` + `administrator` can list roles; others 403.
- Only `md` + `administrator` + `hr_manager` can list departments; the
  other four roles 403.
- Only `md` + `administrator` can view company settings / audit; the
  other five roles 403.
- All roles can view their own notifications (200) — correct, scoped to
  own `userId`.

#### Privilege-escalation probes (2/2 PASS)

Two targeted attempts by the `administrator` test user to obtain MD
access were made:

| # | Attempt | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| 1 | `PUT /api/users/:id/roles` with `roleIds` containing the MD role ID (target = self) | 403 `"Only the Managing Director may assign the 'md' role."` | 403 | PASS |
| 2 | `POST /api/users` with `roleIds` containing the MD role ID (creating a new user with MD access) | 403 `"Only the Managing Director may assign the 'md' role."` | 403 | PASS |

Both probes returned 403 before any database write was attempted — the
audit-trail `AuditLog` table confirmed that no `UserRole` rows were
created or modified by either probe.

#### Unauthenticated-access probes (3/3 PASS)

Three endpoints were probed with no session cookie at all:

| # | Endpoint | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/dashboard` | 401 `"Authentication required."` | 401 | PASS |
| 2 | `GET /api/users` | 401 `"Authentication required."` | 401 | PASS |
| 3 | `GET /api/departments` | 401 `"Authentication required."` | 401 | PASS |

All three returned 401 with the canonical unauthenticated-response
envelope. The `authorize()` helper correctly short-circuits every
protected route before any business logic runs.

#### Browser re-verification after the hardening pass

After the code fixes for the audit findings were applied, the UI was
re-walked through with Agent Browser at 1440×900, 768×1024, and
375×812 viewports. The specific regressions that the audit fixes
targeted were re-verified:

| Check | Expected after fix | Status |
| --- | --- | --- |
| ThemeToggle hydration mismatch (any non-default theme stored in `localStorage`) | No console errors on page load | Pass — `mounted` guard eliminates the SSR/client icon mismatch |
| Settings save bar keyboard focus when the form is clean | Save-bar buttons not in the tab order | Pass — SaveBar now conditionally rendered, not CSS-hidden |
| Departments form `required` announcement | Screen reader announces Department Name + Position Title as required | Pass — `required` + `aria-required="true"` added |
| Tablet-portrait sidebar at exactly 768×1024 | Mobile overlay drawer (no horizontal overflow) | Pass — `<= 768` breakpoint activates the mobile layout |
| Demo-credential hint on login screen when `NODE_ENV='production'` | Hint hidden | Pass — gated behind `NODE_ENV !== 'production'` |
| Dashboard renders after `dashboard:view` permission enforcement | All 7 roles can still see the dashboard | Pass — every seeded role carries `dashboard:view` |
| Dark mode contrast on every view | Consistent emerald/slate-teal palette, no contrast regression | Pass |

The full Phase 1 acceptance matrix in §3 below continues to pass — the
audit hardening pass did not introduce any regression in the original
40-row matrix.

---

## 2. Testing categories required by the spec

The specification requires four testing categories. Phase 1 coverage is
summarised below.

### 2.1 Functional testing

 verifies that each feature behaves as specified.

Phase 1 coverage: login, lockout, RBAC enforcement, CRUD on each admin
module, dashboard render, navigation, theme toggle, notifications menu,
audit immutability. See §1 above.

### 2.2 Security testing

 verifies the system resists common attack vectors.

Phase 1 coverage:

- Authentication: wrong password, locked account, unknown email,
  inactive user, JWT expiry.
- Authorization: every API route returns 401 without a session, 403
  without the required permission, MD bypass works for every module.
- Input validation: Zod schemas reject malformed bodies, oversized
  strings, invalid enums, invalid email/currency formats.
- Output: `passwordHash` never in any response or audit payload.
- Audit: every mutation writes a `previousValue`/`newValue` audit
  entry; the audit resource has no mutation endpoints.
- CSRF: NextAuth built-in CSRF token enforced on sign-in.
- Soft-delete: deleted records are invisible to list/GET/PATCH/DELETE.

Planned for later phases: rate-limit testing (Phase 10), file-upload
magic-byte + size-limit validation (Phase 8/10), 2FA enrollment (Phase
10), CSP header tests (Phase 10).

### 2.3 Financial testing

 verifies that money math is correct, auditable, and tolerant of
rounding.

Phase 1 has **no money fields** (deferred to Phase 2 with the MySQL
migration). The Phase 1 financial test plan is therefore limited to:

- Currency symbol (`GH₵`) is rendered consistently across the dashboard.
- The `currency` field on `CompanySetting` enforces 3-letter uppercase
  via Zod.
- `invoiceStart` enforces `>= 0` integer.

Phase 2 will introduce the full financial test suite: rounding behaviour
on currency conversion, double-entry balance checks, approval-state
transitions on invoices, period-close immutability.

### 2.4 UI testing

 verifies the user interface is usable, accessible, and responsive.

Phase 1 coverage:

- Visual regression: every Phase 1 view renders identically in light and
  dark themes.
- Responsive: every view is usable at 375px / 768px / 1280px widths.
- Accessibility: shadcn/ui components are built on Radix UI which
  provides keyboard navigation, ARIA roles, and focus management out of
  the box. Dialog open/close restores focus to the trigger. Tables are
  navigable by keyboard.
- Toast feedback on every mutation success / error.

Planned for later phases: automated visual regression with Playwright
screenshots (Phase 10), axe-core accessibility scan (Phase 10), Lighthouse
PWA + performance audit (Phase 10).

---

## 3. Phase 1 acceptance test matrix

The following matrix is the formal acceptance criteria for Phase 1. Each
row was verified manually against the running application.

| # | Area | Test | Pass criterion |
| --- | --- | --- | --- |
| 1 | Auth | MD login | Dashboard renders with all sidebar items visible |
| 2 | Auth | Admin login | Dashboard renders; finance sidebar items hidden |
| 3 | Auth | Wrong password | Login screen remains; audit `login_failed` written |
| 4 | Auth | 5-attempt lockout | Account locked for 15 min; further attempts rejected |
| 5 | Auth | Sign out | Login screen shown; audit `logout` written |
| 6 | RBAC | MD bypass | MD can POST to any module route |
| 7 | RBAC | 401 unauthenticated | Anonymous API call returns 401 |
| 8 | RBAC | 403 missing permission | Non-MD without permission gets 403 |
| 9 | RBAC | Last-MD guard | Cannot delete or suspend the only MD |
| 10 | RBAC | Self-delete guard | Cannot delete own account |
| 11 | Dashboard | Financial KPIs render | 10 cards with currency symbol, 0 values |
| 12 | Dashboard | Business KPIs render | 8 cards; `Total Staff` = 7 |
| 13 | Dashboard | Cash-flow chart renders | Recharts area chart visible |
| 14 | Users | List + paginate | Pagination reflects `total` from API |
| 15 | Users | Create | New user visible in list; audit `create` |
| 16 | Users | Edit (rename) | Audit `update` with `previousValue + newValue` |
| 17 | Users | Reset password | Audit `update` with `description="Password reset ..."` |
| 18 | Users | Soft-delete | User disappears; audit `delete`; employee unlinked |
| 19 | Roles | List with permission counts | All 7 roles visible; counts match |
| 20 | Roles | Create custom role | New role appears at end of grid |
| 21 | Roles | Permission matrix PUT | Permissions replaced atomically; audit logged |
| 22 | Roles | Delete system role | Blocked with 400 |
| 23 | Roles | Delete role with users | Blocked with 400 |
| 24 | Departments | List with position + employee counts | Counts exclude soft-deleted children |
| 25 | Departments | Create + edit + delete (with guard) | Soft-delete blocked when active children present |
| 26 | Positions | List with department filter | Filter works; counts correct |
| 27 | Positions | Create + edit + delete (with guard) | Soft-delete blocked when active employees present |
| 28 | Settings | GET singleton | Returns seeded row |
| 29 | Settings | PUT partial update | Audit captures `previousValue + newValue` |
| 30 | Settings | Currency validation | 3-letter uppercase enforced |
| 31 | Settings | Read-only mode for non-editors | Inputs disabled; save bar hidden |
| 32 | Audit | GET list + filters | Filters return correct subset |
| 33 | Audit | Stats endpoint | Stat cards render with correct counts |
| 34 | Audit | No mutation endpoints | No `POST`/`PATCH`/`DELETE` available |
| 35 | Notifications | GET + read-all | Mark-all-read updates count |
| 36 | Navigation | `?view=` swap | Each known view mounts; unknown falls back to dashboard |
| 37 | Theme | Light/Dark toggle | Both themes render with proper contrast |
| 38 | Responsive | 375px viewport | Sidebar collapses; tables scroll horizontally |
| 39 | Output | `passwordHash` never returned | Verified in network tab + audit payloads |
| 40 | Audit immutability | `recordAudit` is the only writer | No `update`/`delete` call exists in codebase |

---

## 4. Plan for automated tests (Phase 2+)

The Phase 1 verification above is **manual**. The spec forbids writing
test code in this sandbox, so the following plan is documented for later
phases — **no test files are committed in Phase 1**.

### 4.1 Tooling plan

| Layer | Tool | Phase |
| --- | --- | --- |
| Unit tests (lib helpers) | Vitest | Phase 2 |
| API integration tests | Vitest + `next/test` Route Handler caller | Phase 2 |
| End-to-end tests | Playwright | Phase 4 |
| Visual regression | Playwright screenshots + Percy/Chromatic | Phase 10 |
| Accessibility scan | axe-core via Playwright | Phase 10 |
| Performance baseline | Lighthouse CI | Phase 10 |

### 4.2 Unit-test targets (Phase 2)

- `src/lib/permissions.ts`: `loadUserAuthData` (mock Prisma),
  `requirePermission` (covers MD bypass + 401 + 403 paths),
  `hasPermission` (covers null session + MD + permission check).
- `src/lib/audit.ts`: `recordAudit` (verifies payload shape + JSON
  stringification + error swallowing).
- `src/lib/api-helpers.ts`: `authorize` (covers 401/403/MD paths),
  `pagination` (covers clamping + edge cases), `notDeleted`.
- Zod schemas in every mutation route (extract to a shared module for
  testability).

### 4.3 API integration tests (Phase 2)

One test per Route Handler. Each test:

1. Mocks the NextAuth session via a test helper.
2. Calls the handler with a `NextRequest`.
3. Asserts the JSON response + status code.
4. Verifies the audit log entry was written (or skipped on auth failure).

Coverage targets:

- Happy path for every endpoint.
- 401 (no session) for every endpoint.
- 403 (no permission) for every endpoint.
- Zod validation failures for every mutation.
- Soft-delete invisibility (deleted records are 404).
- Last-MD and self-delete guards.
- MD bypass for at least one endpoint per module.

### 4.4 End-to-end tests (Phase 4)

Playwright scenarios that exercise the full browser → app → DB stack:

- The Phase 1 acceptance matrix in §3, automated.
- Phase 4 finance workflows: create income/expense, reconcile period
  close.
- Phase 6 project P&L rollup.
- Phase 8 file upload + validation.

### 4.5 Continuous integration (Phase 2)

A GitHub Actions (or equivalent) workflow will run:

1. `bun install`
2. `bun run lint`
3. `bun run db:push` against an in-memory or temporary SQLite file.
4. `bun run db:seed`
5. `bun run test:unit`
6. `bun run test:integration`
7. `bun run test:e2e` (Playwright against a running dev server)

The workflow gates every pull request. A green build is required to
merge.

### 4.6 Test data

A separate `prisma/seed.test.ts` will be added in Phase 2 that seeds a
larger, more varied dataset (50 users, 20 departments, sample finance
transactions) for integration tests. Phase 1's `prisma/seed.ts` is the
minimal development seed.

---

## 5. Test ownership

| Phase | Owner | Cadence |
| --- | --- | --- |
| Manual smoke (every change) | Implementing subagent | Per task |
| Phase 1 acceptance matrix | Documentation agent | Phase 1 sign-off |
| Automated unit + integration | Implementing subagent | Phase 2 onward |
| E2E + visual regression | QA agent (Phase 10) | Phase 4 onward |
| Security penetration test | External (Phase 10) | Phase 10 sign-off |
