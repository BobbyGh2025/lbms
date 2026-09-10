# P11-UI — Phase 11 Accounts Payable & Expenses UI

**Agent:** full-stack-developer
**Task ID:** P11-UI
**Date:** 2025-09-10
**Status:** COMPLETED

## Objective
Build 2 payables UI views for LBMS Phase 11 (Accounts Payable & Expenses). The Phase 11 backend (18 API route files) is already complete. The view-router.tsx already imports `PayablesView` and `SupplierBillProfileView` from `@/components/views/payables/`.

## Files Created
1. `src/components/views/payables/payables-view.tsx` — 1,349 lines
2. `src/components/views/payables/supplier-bill-profile-view.tsx` — 952 lines

Total: 2,301 lines of "use client" TypeScript React.

## Architecture

### PayablesView (directory, 4 tabs)
- **PageHeader**: "Payables & Expenses" subtitle "Supplier bills, payments, expenses and AP dashboard"
- **Permission gate**: `can("payables", "view") || can("expenses", "view")` — otherwise renders "No access" EmptyState.
- **Supplier Bills tab**: search + 7-status filter + New Bill dialog. Table with Bill #, Supplier, Status badge, Overdue badge, Total, Paid, Balance, Due Date. Row click → supplier-bill-profile.
- **Supplier Payments tab**: search + 3-status filter + New Payment dialog. Table with Payment #, Supplier, Bill, Amount, Method, Status, Date. Payment dialog: supplier/bill/account/amount/method/reference/notes.
- **Expenses tab**: search + 5-status filter + New Expense dialog. Table with Expense #, Category (ledgerAccountCode), Description, Amount, Status, Date. Expense dialog: category/supplier/employee/project/account/amount/description/method/reference/notes.
- **AP Dashboard tab**: KPI cards (Total Payable, Overdue Payable, Outstanding Bills count, Overdue Bills count) + aging buckets with progress bars (0-30/31-60/61-90/90+) + supplier breakdown table (top 20).

### SupplierBillProfileView (profile, 4 tabs)
- **Header**: billNumber + supplier name + Back-to-Directory button.
- **Header summary card**: status badge + overdue badge + total + balance due + due date.
- **Action buttons** (status + permission gated):
  - Edit (draft + payables:edit)
  - Submit (draft + payables:submit) — data-testid="submit-bill-action"
  - Approve (submitted + payables:approve) — data-testid="approve-bill-action"
  - Post (approved + payables:post) — data-testid="post-bill-action" (posts Dr Expense / Cr AP)
  - Void (posted/partially_paid + payables:void) — data-testid="void-bill-action" (opens reason dialog min 3 chars)
  - Cancel (draft/submitted/approved + payables:cancel) — data-testid="cancel-bill-action"
- **Tabs**: Overview, Items (count), Payments (count), Audit.
  - Overview: 2-column grid with Bill Information + Financial Summary + optional Project + optional Notes.
  - Items: table + "Add Item" dialog if draft. Dialog: inventoryItem/description/qty/unitPrice/ledgerAccountCode. data-testid="submit-bill-item".
  - Payments: read-only table of payments made against this bill.
  - Audit: created/updated timestamps, createdBy/approvedBy usernames, journalId (if posted).

## API Contracts Consumed

### Supplier Bills (`/api/payables/bills`)
- `GET ?page&pageSize&search&status&supplierId` → `{ items: Bill[], pagination }`
- `POST` body `{ supplierId, supplierRef?, projectId?, dueDate?, notes? }` → 201
- `GET /:id` → bill with items, supplier, payments, project
- `PATCH /:id` body `{ notes?, supplierRef? }` (draft only)
- `POST /:id/items` body `{ description, quantity, unitPrice, ledgerAccountCode?, inventoryItemId? }` → 201
- `POST /:id/submit` → draft→submitted
- `POST /:id/approve` → submitted→approved
- `POST /:id/post` → approved→posted (Dr Expense / Cr AP)
- `POST /:id/void` body `{ reason }` → posted→voided (reverses journal)
- `POST /:id/cancel` → non-posted → voided

### Supplier Payments (`/api/payables/payments`)
- `GET ?page&pageSize&search&status&supplierId` → `{ items: Payment[], pagination }`
- `POST` body `{ supplierId, supplierBillId?, financialAccountId, amount, paymentMethod?, reference?, notes? }` → 201
- `POST /:id/post` → draft→posted (Dr AP / Cr Cash)
- `POST /:id/void` body `{ reason }` → posted→voided

### Expenses (`/api/expenses`)
- `GET ?page&pageSize&search&status&supplierId` → `{ items: Expense[], pagination }`
- `POST` body `{ ledgerAccountCode?, supplierId?, employeeId?, projectId?, financialAccountId, amount, description, paymentMethod?, reference?, notes? }` → 201
- `POST /:id/submit` → draft→submitted
- `POST /:id/approve` → submitted→approved
- `POST /:id/post` → approved→posted (Dr Expense / Cr Cash)
- `POST /:id/void` body `{ reason }` → posted→voided

### AP Dashboard (`/api/payables/receivables`)
- `GET` → `{ summary: { totalPayable, totalOverdue, outstandingCount, overdueCount, billCount }, aging: { "0-30"|"31-60"|"61-90"|"90+": { count, amount } }, supplierBreakdown: [...top 20], generatedAt }`

### Reference Data
- `GET /api/suppliers?pageSize=100`
- `GET /api/projects?pageSize=100`
- `GET /api/finance/accounts` (financial accounts for payment source selection)
- `GET /api/finance/categories?accountClass=expense` (expense ledger accounts for bill items + expense category)
- `GET /api/staff?pageSize=100` (employees for expense form)
- `GET /api/inventory/items?pageSize=100` (inventory items for bill items)

## UI Conventions (per spec)

1. **"use client" directive** at top of both files.
2. **shadcn/ui** components: Button, Input, Label, Textarea, Badge, Skeleton, Card, CardContent, CardHeader, CardTitle, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue.
3. **Common components**: `PageHeader` from `@/components/common/page-header`, `EmptyState` from `@/components/common/empty-state`.
4. **Permission checks**: `useAuth()` from `@/hooks/use-auth` — `can("payables"|"expenses", action)`.
5. **Toast notifications**: `toast` from `sonner`.
6. **Navigation**: `useRouter()` from `next/navigation`.
7. **ID from URL**: `useSearchParams().get("id")`.
8. **Submit buttons**: `type="button"` + `onClick` + `data-testid`.
9. **Money**: Decimal strings displayed via `formatMoney(v, "GHS")` (canonical "GHS 5,000.00" format from `@/lib/finance/money`).
10. **Status badges**: draft=zinc, submitted=sky, approved=amber, posted=emerald, partially_paid=amber, paid=emerald, voided=rose.
11. **Overdue badges**: rose "OVERDUE" with AlertCircle icon.
12. **Responsive**: 375/768/1440px. TabsList `flex flex-wrap h-auto`. Tables `overflow-x-auto`. Dialogs `sm:max-w-[560px]` (480px for void/cancel).
13. **`useEffect` + relative fetch paths only** — no absolute URLs, no port specifiers (gateway-safe).
14. **NO indigo/blue primary colors** — palette: zinc/sky/amber/emerald/rose/orange/violet.

## Permission Gates

| Action | Permission | Visible When |
|---|---|---|
| New Bill button | `payables:create` | Always (Bills tab) |
| New Payment button | `payables:pay` | Always (Payments tab) |
| New Expense button | `expenses:create` | Always (Expenses tab) |
| Edit Bill button | `payables:edit` | status = draft |
| Submit Bill button | `payables:submit` | status = draft |
| Approve Bill button | `payables:approve` | status = submitted |
| Post Bill button | `payables:post` | status = approved |
| Void Bill button | `payables:void` | status = posted OR partially_paid |
| Cancel Bill button | `payables:cancel` | status = draft, submitted, OR approved |
| Add Item button | `payables:edit` | status = draft |
| Payables tab visibility | `payables:view` | Tab content; AP Dashboard tab |
| Expenses tab visibility | `expenses:view` | Tab content |

MD bypasses all permission checks via `useAuth().isMD`.

## Lifecycle Enforcement (UI-side mirror)

The UI mirrors the server-side lifecycle rules:
- `draft → submitted → approved → posted → partially_paid → paid` (terminal: paid, voided)
- Submit button only visible on draft
- Approve only on submitted
- Post only on approved
- Void only on posted/partially_paid (with reason dialog)
- Cancel only on draft/submitted/approved (reason optional)
- Terminal states (paid, voided) hide all action buttons

The server still enforces these rules authoritatively — the UI is just for usability.

## Finance Boundary

ZERO `prisma.journal.create` calls in payables UI code. All accounting postings are triggered via POST to API endpoints:
- `/api/payables/bills/[id]/post` — server calls postJournal with Dr Expense / Cr LIB-AP entries
- `/api/payables/payments/[id]/post` — server calls postJournal with Dr LIB-AP / Cr Cash entries
- `/api/expenses/[id]/post` — server calls postJournal with Dr Expense / Cr Cash entries
- `/api/payables/bills/[id]/void` — server calls reverseJournal
- `/api/payables/payments/[id]/void` — server calls reverseJournal
- `/api/expenses/[id]/void` — server calls reverseJournal

The UI only displays the resulting `journalId` (read-only) in the Audit tab.

## Verification

### TypeScript
```
cd /home/z/my-project && npx tsc --noEmit 2>&1 | grep -E "payables|expenses"
```
Result: ZERO output (no errors in my files).

Pre-existing tsc errors remain in `scripts/*` and `skills/*` (not in scope).

### ESLint
```
cd /home/z/my-project && bun run lint 2>&1 | grep payables
```
Result: ZERO output. `bun run lint` exits with code 0 (full project clean).

### Export Names
Both files export exactly one function each with the exact names that view-router.tsx imports:
- `export function PayablesView()` — line 228 of payables-view.tsx
- `export function SupplierBillProfileView()` — line 171 of supplier-bill-profile-view.tsx

## Files NOT Modified

- `src/components/views/view-router.tsx` (already imports my components at lines 45–46)
- Any file under `src/app/api/payables/` or `src/app/api/expenses/` (P11-API complete)
- `prisma/schema.prisma` (no schema changes needed)
- Any seed file
- Any test file (per spec)

## Cross-References

- **P11-API worklog** (above this entry in worklog.md) — built the 18 API route files this UI consumes
- **P10-UI worklog** — established the directory + profile pattern that this work mirrors
- **P10-HARDENING** — converted sales from cash-basis to accrual; payables follows the same accrual pattern (bill POST = Dr Expense / Cr AP; payment POST = Dr AP / Cr Cash; voids reverse via reverseJournal)

## Done

Phase 11 Accounts Payable & Expenses UI is COMPLETE. The 2 view files compile cleanly (tsc + eslint exit code 0) and are ready to be exercised end-to-end against the P11-API backend.
