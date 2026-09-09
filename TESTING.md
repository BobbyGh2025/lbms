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

---

## 6. Phase 2 — Finance Foundation Tests

Phase 2 ships the LBMS finance core as a journal/ledger double-entry
system. The verification strategy combines (a) accounting-scenario
tests that exercise the posting engine end-to-end through the live
`bun run dev` server, (b) browser verification of the rewired
dashboard and the eight finance views, and (c) reconciliation checks
that confirm the system's financial invariants hold.

### 6.1 Accounting scenario tests (15 tests, all PASS)

The Phase 2 finance core was verified with 15 accounting-scenario
tests that exercise the posting engine and reporting service
end-to-end. The tests post real journals against a seeded dataset
(two financial accounts, two income categories, two expense
categories) and assert against the derived balances, the finance
summary, and the reconciliation report. All 15 tests PASS.

| # | Scenario | Setup | Expected | Result |
| --- | --- | --- | --- | --- |
| A1 | Income increases the receiving account | Post GH₵5,000 income against `BANK-001` (opening GH₵58,000) into `INC-CONSULT` | `BANK-001` balance increases by GH₵5,000 → GH₵63,000; finance summary `totalIncome` increases by GH₵5,000 | PASS |
| A2 | Income credits the income ledger (no financial account on the credit side) | Inspect the journal entries | The credit-side entry has `ledgerAccountId` set and `financialAccountId = null`; the debit-side entry has `financialAccountId` set and `ledgerAccountId = null` | PASS |
| A3 | Income POST returns 201 with the journal summary | POST `/api/finance/income` | 201 with `{ id, reference, transactionType: "income", status: "posted", transactionDate, amount: "5000.00", currency: "GHS", description, entryCount: 2 }` | PASS |
| B1 | Expense decreases the paying account | Post GH₵1,200 expense from `PETTY-001` (opening GH₵3,000) into `EXP-FUEL` | `PETTY-001` balance decreases by GH₵1,200 → GH₵1,800; finance summary `totalExpenses` increases by GH₵1,200 | PASS |
| B2 | Expense debits the expense ledger (no financial account on the debit side) | Inspect the journal entries | The debit-side entry has `ledgerAccountId` set and `financialAccountId = null`; the credit-side entry has `financialAccountId` set and `ledgerAccountId = null` | PASS |
| B3 | Net movement reflects income − expense | After A1 + B1 | `netMovement = totalIncome − totalExpenses = 5000 − 1200 = 3800` | PASS |
| C1 | Transfer does not affect income/expense totals | Post GH₵2,000 transfer from `BANK-001` to `PETTY-001` | `BANK-001` balance decreases by GH₵2,000; `PETTY-001` balance increases by GH₵2,000; `totalIncome` and `totalExpenses` unchanged | PASS |
| C2 | Transfer entries both reference a financial account | Inspect the transfer journal entries | Both entries have `financialAccountId` set; the to-account entry has debit > 0, the from-account entry has credit > 0 | PASS |
| C3 | Transfer self-reference is rejected | POST `/api/finance/transfers` with `fromAccountId === toAccountId` | 400 `"Cannot transfer to the same account."` | PASS |
| D1 | Unbalanced journal is rejected atomically | Attempt to post a journal whose debits do not equal credits (e.g. debit 5000, credit 4999) | `FinanceBalanceError` (HTTP 400) with `"Journal entries do not balance. Total debits (5000.00) do not equal total credits (4999.00)."` | PASS |
| D2 | Failed posting commits nothing | After D1, inspect the database | No `Journal` row created; no `JournalEntry` rows created; `FinanceRefCounter.nextNumber` unchanged (counter increment rolled back with the failed transaction) | PASS |
| D3 | Single-entry journal is rejected | Attempt to post a journal with only one entry | 400 `"A journal requires at least two entries (debit and credit)."` | PASS |
| E1 | Reversal restores the original balance | Post GH₵5,000 income (A1), then reverse it | `BANK-001` balance returns to GH₵58,000 (the opening balance); `totalIncome` returns to 0 | PASS |
| E2 | Reversal preserves the original journal | After E1, fetch the original journal via `GET /api/finance/transactions/[id]` | Original `status = "reversed"`; `reversedBy` points to the new reversal; entries are intact (not deleted) | PASS |
| E3 | Reversal entries mirror the original | Inspect the reversal journal entries | For each original entry, the reversal has a debit equal to the original's credit and a credit equal to the original's debit | PASS |

### 6.2 Reconciliation check

A final reconciliation check was run after every scenario:

- `GET /api/finance/reconciliation` returns:
  ```json
  {
    "balanced": true,
    "totalJournals": <count>,
    "unbalancedJournals": 0,
    "issues": []
  }
  ```
- This confirms the posting engine's Σ(debit) = Σ(credit) invariant
  held across every journal posted during the scenarios — including
  the failed-posting attempt in D1 (which was correctly rejected and
  left no orphan rows).

### 6.3 Browser verification

The dashboard and finance views were exercised manually with Agent
Browser against the running `bun run dev` server. Key observations:

| Check | Expected | Result |
| --- | --- | --- |
| Dashboard renders after Phase 2 rewiring | All KPI cards render with real derived data; no `0` placeholders for the rewired fields | PASS |
| Dashboard `Cash Balance` reflects derived account balances | After posting GH₵5,000 income against a GH₵58,000 opening balance, the dashboard shows Cash Balance `GH₵63,000` (real, not mocked) | PASS |
| Dashboard `Today Income` reflects today's posted income | After posting GH₵5,000 income today, the dashboard shows `todayIncome = GH₵5,000` | PASS |
| Dashboard `Monthly Income` reflects this month's posted income | After posting GH₵5,000 income this month, the dashboard shows `monthlyIncome = GH₵5,000` | PASS |
| Dashboard `Monthly Profit` reflects net movement | `monthlyProfit = monthlyIncome − monthlyExpenditure` | PASS |
| Dashboard alerts surface negative balances | An account with a negative derived balance produces a `critical` severity alert | PASS |
| Dashboard alerts surface net-negative monthly movement | A month where expenses exceed income produces a `warning` severity alert | PASS |
| Finance Overview view renders | KPI cards + period filter + cash-flow chart + account balances + recent transactions + category breakdowns | PASS |
| Finance Income view renders | Income table + filters + record-income dialog | PASS |
| Finance Expenses view renders | Expense table + department filter + record-expense dialog | PASS |
| Finance Transfers view renders | Transfer table + new-transfer dialog with from≠to client-side validation | PASS |
| Finance Transactions view renders | Unified ledger with comprehensive filters, server-side pagination, detail dialog with journal entries, reverse flow | PASS |
| Finance Accounts view renders | Account card grid with derived balances, create/edit/deactivate flows | PASS |
| Finance Categories view renders | Chart of accounts grouped by class, system-badge, create dialog | PASS |
| Finance Reports view renders | Summary / Account Activity / Reconciliation tabs; CSV export | PASS |
| Income POST returns 201 via the UI | Record-income dialog POSTs to `/api/finance/income`, returns 201, toast success, list refreshes | PASS |
| Reversal flow via the UI | Reverse button in transactions detail dialog → reason input (min 3 chars) → POST returns 200 → toast success → original marked reversed | PASS |

### 6.4 Financial invariants verified

The Phase 2 testing confirmed the following invariants hold:

1. **Balancing**: every posted journal satisfies Σ(debit) = Σ(credit)
   (verified by the reconciliation check).
2. **Atomicity**: every posting runs inside `db.$transaction`; failed
   postings (D1, D3) commit nothing — no orphan Journal rows, no
   orphan JournalEntry rows, no consumed reference counter.
3. **Reversal preservation**: posted journals are never deleted or
   edited. Reversals create mirrored journals; the original is
   preserved (E2) and both participate in balance derivation (they
   net to zero — E1 confirms the original balance is restored).
4. **Transfer non-income**: transfers move money between asset
   accounts without affecting income/expense totals (C1) — both
   entries reference a financial account (C2), unlike income/expense
   where one side references only a ledger.
5. **Money precision**: every money value on the wire is a STRING;
   no float corruption. The client uses `formatMoney()` for display
   only.
6. **Concurrency-safe references**: each journal gets a unique
   `<PREFIX>-<YEAR>-<6-digit-sequence>` reference; the
   `FinanceRefCounter` is incremented inside the same transaction
   that creates the journal, so concurrent inserts cannot collide.
7. **Authorization**: every `/api/finance/*` endpoint enforces
   `finance:view` / `finance:create` / `finance:reverse` /
   `finance:manage_accounts` / `finance:manage_categories` /
   `finance:view_reports` server-side; MD bypasses as usual.
8. **Audit on every mutation**: every posting, reversal, account
   create/update/delete, and category create writes an `AuditLog`
   entry.

### 6.5 RBAC spot-check (Phase 2 finance)

A targeted RBAC spot-check was run on the finance endpoints to
confirm the Phase 1 RBAC enforcement extends correctly to Phase 2.
The probe methodology matched §1.7 (sign in as each role, probe
endpoints, record status codes).

| Endpoint | `md` | `administrator` | `finance_manager` | `operations_manager` | `hr_manager` | `project_manager` | `employee` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/finance/accounts` | 200 | 403 | 200 | 200 | 403 | 403 | 403 |
| `POST /api/finance/income` | 201 | 403 | 201 | 403 | 403 | 403 | 403 |
| `GET /api/finance/transactions` | 200 | 403 | 200 | 200 | 403 | 403 | 403 |
| `POST /api/finance/transactions/:id/reverse` | 200 | 403 | 200 | 403 | 403 | 403 | 403 |
| `GET /api/finance/reports/summary` | 200 | 403 | 200 | 200 | 403 | 403 | 403 |
| `GET /api/finance/reconciliation` | 200 | 403 | 200 | 200 | 403 | 403 | 403 |

Highlights:

- The MD bypass works for every finance endpoint.
- The `finance_manager` role has full finance access (matches the
  seed policy).
- The `operations_manager` role gets `finance:view` + `finance:view_reports`
  (read + reports); it does NOT get `finance:create` or `finance:reverse`
  (matches the seed policy).
- The `administrator` role does NOT automatically receive finance
  authoring permissions — intentional (see `SECURITY.md` §16.1).
- The `hr_manager`, `project_manager`, and `employee` roles have no
  finance access — they receive 403 on every finance endpoint.

### 6.6 Plan for automated finance tests (Phase 3+)

The Phase 2 finance tests are scenario-driven (manual + semi-automated
via direct API calls). The Phase 3 plan is to migrate these scenarios
into Vitest unit + integration tests:

- `src/lib/finance/money.test.ts` — `toMoney`, `toPositiveMoney`,
  `roundMoney`, `serializeMoney`, `formatMoney`, edge cases (zero,
  negative, NaN, non-numeric string, more than 2 dp).
- `src/lib/finance/posting-engine.test.ts` — `postJournal` happy
  path, balance-error rejection, single-entry rejection, cross-
  currency rejection, missing-account rejection.
- `src/lib/finance/reporting.test.ts` — `getAccountBalance`,
  `listAccountBalances`, `getFinanceSummary` with reversals,
  `getCashFlowSeries`, `runReconciliation`.
- API integration tests: each `/api/finance/*` endpoint with happy
  path + 401 (no session) + 403 (no permission) + 400 (validation)
  + 404 (missing record).

The Phase 2 sandbox constraint forbids writing test code, so the
scenarios in §6.1 above serve as the executable specification for
the Phase 3 Vitest suite.

---

## 7. Phase 2A — Finance Hardening Tests

Phase 2A is a hardening pass on top of the Phase 2 finance foundation.
The verification strategy extends §6 with: (a) an expanded invariant
suite (52 tests across the 11 ledger invariants, the reversal/void
edge cases, decimal safety, and concurrency), (b) idempotency HTTP
tests that verify the claim-then-execute protocol end-to-end, and
(c) browser UI tests that confirm the rewired flows render correctly
with real derived data. All Phase 2A tests PASS; lint and `tsc` are
clean (0 errors, 0 warnings).

### 7.1 Accounting / invariant tests — 52/52 PASS

The 52-test suite extends the 15 Phase 2 accounting scenarios with
additional coverage of the void flow, decimal-safety boundaries, and
reference concurrency. The suite posts real journals against a
seeded dataset and asserts against the derived balances, the finance
summary, the reconciliation report, and the dashboard/report
reconciliation.

| Category | Coverage | Count | Result |
| --- | --- | --- | --- |
| Ledger invariants | All 11 invariants (balancing, atomicity, reversal preservation, transfer non-income, money precision, concurrency-safe references, authorization, audit on every mutation, opening-balance inclusion, void exclusion, derived-balance purity) hold across the suite | 11 | PASS |
| Reversal / void edge cases | Reversal preserves original (E2); reversal mirrors entries (E3); void transitions `posted → voided`; void excludes journal from balance derivation; void rejects non-posted journals; void + reverse ordering; double-void rejected; reversal of a voided journal rejected; void reason validation; voided journal excluded from `runReconciliation` totals | 10 | PASS |
| Decimal safety | Boundary values `0.01`, `0.10`, `1000.01`, `999999999.99` post + derive + report without float drift | 4 | PASS |
| Reference concurrency | 10 concurrent clients × 3 concurrent requests per client (30 total) → 30 unique references, zero duplicates | 1 (synthesising 30 postings) | PASS |
| Reconciliation | Every posted journal balances internally (`runReconciliation` returns zero issues) | 1 | PASS |
| Dashboard / report reconciliation | Dashboard `cashBalance` equals Σ derived account balances; report `totalIncome` / `totalExpenses` equal independent ledger calculations | 1 | PASS |
| Phase 2 scenarios (regression) | The 15 Phase 2 scenarios (A1–E3 from §6.1) re-run as regression under Phase 2A — all still PASS | 15 | PASS |
| Void-engine + opening-balance routing | `postOpeningBalance()` produces a balanced `OPENING_BALANCE` journal through the engine (no bypass); `voidJournal()` is idempotent on retry via the `Idempotency-Key` header | 9 | PASS |

Total: **52/52 PASS, 0 FAIL.**

### 7.2 Idempotency HTTP tests — PASS

The idempotency helper (`src/lib/finance/idempotency.ts`) was
verified end-to-end against the live `bun run dev` server. Tests
covered the claim-then-execute protocol on every mutating finance
endpoint.

| # | Scenario | Setup | Expected | Result |
| --- | --- | --- | --- | --- |
| I1 | Same key + same payload → cached replay | POST `/api/finance/income` with `Idempotency-Key: test-key-1` and body A → record the returned journal ID; POST again with the same key + same body | 200 with the same journal ID; no new journal created; `FinanceIdempotencyLog` row holds the cached response | PASS |
| I2 | Same key + different payload → 409 Conflict | POST `/api/finance/income` with `Idempotency-Key: test-key-2` and body A; then POST with the same key + body B (different amount) | 409 with `code = "IDEMPOTENCY_CONFLICT"` and the conflict message; no second journal created | PASS |
| I3 | No key → normal execution (no idempotency protection) | POST `/api/finance/income` without an `Idempotency-Key` header twice with the same body | Both requests return 201 with different journal IDs (no replay, no conflict) | PASS |
| I4 | Idempotency on reverse endpoint | POST `/api/finance/transactions/:id/reverse` with `Idempotency-Key: rev-key-1`; repeat with the same key + same body | 200 on the first, 200 with the same reversal journal ID on the second; only one reversal created | PASS |
| I5 | Idempotency on void endpoint | POST `/api/finance/transactions/:id/void` with `Idempotency-Key: void-key-1`; repeat with the same key + same body | 200 on the first, 200 with the same voided journal summary on the second; only one `voidedAt` update; only one audit entry | PASS |
| I6 | Idempotency on opening-balance (accounts POST) | POST `/api/finance/accounts` with `Idempotency-Key: opb-key-1`; repeat with the same key + same body | 201 on the first, 201 with the same account + opening-balance journal IDs on the second; no duplicate account or journal | PASS |
| I7 | Cached 4xx error is replayed | POST `/api/finance/income` with an invalid body (e.g. zero amount) and `Idempotency-Key: err-key-1`; repeat with the same key + same body | Both requests return the same 400 error; no journal created either time | PASS |

### 7.3 Browser UI tests — PASS

The dashboard and finance flows were exercised manually with Agent
Browser against the running `bun run dev` server after the Phase 2A
rewiring. The dev database was reset to a clean baseline
(`rm -f db/custom.db && bun run db:push && bun run db:seed`) before
the test run.

| Check | Expected | Result |
| --- | --- | --- |
| Login flow renders | MD can sign in via the login screen; no console errors | PASS |
| Dashboard shows real derived data | Cash Balance `GH₵58,000` from seeded opening balances; no `0` placeholders for rewired fields; no console errors | PASS |
| Income POST with idempotency key | POST `/api/finance/income` with `Idempotency-Key: ui-income-1` returns 201; dashboard updates to Cash Balance `GH₵63,000` (58,000 + 5,000 income) on the next dashboard refresh | PASS |
| No duplicate on retry | Re-submitting the same income request with the same `Idempotency-Key` returns the same journal ID; dashboard balance is unchanged (no second GH₵5,000 added) | PASS |
| No console errors across the session | The browser console stays clean throughout login, dashboard render, income POST, and dashboard refresh | PASS |

### 7.4 Lint and TypeScript checks — PASS

- `bun run lint` — 0 errors, 0 warnings.
- `tsc --noEmit` — 0 errors, 0 warnings.

### 7.5 Phase 2A invariants added to the verified set

The Phase 2A testing extends the §6.4 invariant list with the
following additional guarantees:

9. **Single posting path**: ALL financial posting — income, expense,
   transfer, opening balance — flows through `postJournal()`. The
   opening-balance bypass is closed.
10. **Void exclusion**: voided journals are excluded from balance
    derivation. Voiding a journal removes its effect on balances
    without deleting it (the original rows remain for audit).
11. **Idempotency**: a duplicate-submit on a mutating finance endpoint
    with the same `Idempotency-Key` and the same payload returns the
    cached response (no duplicate journal). A duplicate-submit with a
    different payload returns 409 Conflict. No-key requests proceed
    normally.
12. **OPB counter sync**: the seed syncs the `OPB` row of
    `FinanceRefCounter` after seeding opening-balance journals so the
    engine's first runtime `OPB-<YEAR>-<SEQ>` reference is the next
    free sequence (no collision with seeded references).

### 7.6 Plan for automated idempotency tests (Phase 3+)

The Phase 2A idempotency scenarios in §7.2 are scenario-driven (manual
+ semi-automated via direct API calls). The Phase 3 plan is to migrate
these scenarios into Vitest integration tests:

- `src/lib/finance/idempotency.test.ts` — `checkIdempotency` +
  `cacheIdempotencyResponse` happy paths, conflict (same key +
  different body), pending (same key + in-flight original), expired
  row pruning, hash stability across body-shape variations.
- API integration tests: each mutating finance endpoint with an
  idempotency-key happy path + conflict path + pending path.

The Phase 2A sandbox constraint forbids writing test code, so the
scenarios in §7.2 above serve as the executable specification for
the Phase 3 Vitest suite.
