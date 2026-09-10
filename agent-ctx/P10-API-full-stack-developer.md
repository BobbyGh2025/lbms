# Task ID: P10-API
**Agent:** full-stack-developer

## Task
Build Phase 10 Sales API routes (18 route files) under `src/app/api/sales/**`:
- Quotes: list/create, single/edit, items add, send, accept, reject, cancel, convert
- Sales Orders: list/create, single/edit, items add, confirm, complete, cancel
- Invoices: list/create, single/edit, items add, issue, void
- Payments: list/create, post, void (via finance posting engine)
- Receivables: aging dashboard

## Prior Context Read
- `/home/z/my-project/worklog.md` — Phases 1–9 complete. Phase 9 finance boundary verified clean.
- Pattern refs: `src/app/api/procurement/requests/route.ts` (collection), `procurement/orders/[id]/route.ts` (single), `procurement/orders/[id]/items/route.ts` (items add + totals recompute), `procurement/orders/[id]/receiving/route.ts` (transactional flow).
- `src/lib/sales-utils.ts` — COMPLETED: nextSalesRefNumber, lifecycle transitions, recompute* helpers, isInvoiceOverdue.
- `src/lib/api-helpers.ts` — authorize + ok/badRequest/notFound + auditFromCtx + notDeleted.
- `src/lib/finance/posting-engine.ts` — postIncome + voidJournal signatures verified.

## Work Log
1. Created quotes/route.ts — GET (paginated list with search + status/customerId/projectId filters) + POST (create draft with auto QT-YYYY-NNNNNN).
2. Created quotes/[id]/route.ts — GET (single with items + customer + project) + PATCH (edit draft only, recompute totals).
3. Created quotes/[id]/items/route.ts — POST add item, server-side totals, recompute quote totals.
4. Created quotes/[id]/send/route.ts + accept + reject + cancel — lifecycle transitions.
5. Created quotes/[id]/convert/route.ts — idempotent conversion (convertedToSalesOrderId check), creates SalesOrder from quote items.
6. Created orders/route.ts + [id]/route.ts + [id]/items/route.ts + confirm + complete + cancel — same patterns.
7. Created invoices/route.ts (dueDate required) + [id]/route.ts + [id]/items/route.ts + issue + void.
8. Created payments/route.ts (overpayment protection: amount ≤ invoice.balanceDue) + [id]/post/route.ts (calls postIncome + recomputeInvoiceBalance) + [id]/void/route.ts (calls voidJournal + recomputeInvoiceBalance).
9. Created receivables/route.ts — aging buckets 0-30/31-60/61-90/90+ + customer breakdown.
10. Ran tsc + lint — verified clean.

## Verification
- `npx tsc --noEmit 2>&1 | grep api/sales` — ZERO errors in sales API code.
- `npx eslint 'src/app/api/sales/**/*.ts'` — exit code 0 (clean).
- `bun run lint` — exit code 0 (full project lint clean).
- Pre-existing tsc errors remain in: scripts/* (test scripts), skills/*, and `src/components/views/view-router.tsx` (which imports the not-yet-created UI files `sales-view`, `receivables-view`, `quote-profile-view`, `sales-order-profile-view`, `invoice-profile-view` — these are the UI agent's responsibility).

## Files Created (23 route files)
**Quotes (8):**
- `quotes/route.ts` — GET (paginated list with search + status/customerId/projectId filters) + POST (create draft, auto QT-YYYY-NNNNNN)
- `quotes/[id]/route.ts` — GET (single with items + customer + project) + PATCH (edit draft only, recompute totals)
- `quotes/[id]/items/route.ts` — POST (add item, server-side line totals + recompute quote totals)
- `quotes/[id]/send/route.ts` — POST (draft → sent)
- `quotes/[id]/accept/route.ts` — POST (sent → accepted)
- `quotes/[id]/reject/route.ts` — POST (sent → rejected, terminal)
- `quotes/[id]/cancel/route.ts` — POST (draft/sent/accepted → cancelled, terminal)
- `quotes/[id]/convert/route.ts` — POST (accepted → converted, idempotent via convertedToSalesOrderId check; copies quote items into SalesOrderItem rows)

**Sales Orders (6):**
- `orders/route.ts` — GET (list, filters by status/customerId/projectId/quoteId) + POST (create draft, auto SO-YYYY-NNNNNN)
- `orders/[id]/route.ts` — GET (single with items + invoices) + PATCH (edit draft only)
- `orders/[id]/items/route.ts` — POST (add item, recompute totals)
- `orders/[id]/confirm/route.ts` — POST (draft → confirmed)
- `orders/[id]/complete/route.ts` — POST (confirmed/processing → completed, terminal)
- `orders/[id]/cancel/route.ts` — POST (draft/confirmed/processing → cancelled, terminal)

**Invoices (5):**
- `invoices/route.ts` — GET (list with derived `overdue` flag, filters by status/customerId/projectId/salesOrderId/overdue) + POST (create draft, auto INV-YYYY-NNNNNN, dueDate REQUIRED)
- `invoices/[id]/route.ts` — GET (single with items + payments + customer + salesOrder + derived overdue) + PATCH (edit draft only, recompute totals + balance)
- `invoices/[id]/items/route.ts` — POST (add item, recompute invoice totals + balanceDue)
- `invoices/[id]/issue/route.ts` — POST (draft → issued, immutable after; refuses empty invoice)
- `invoices/[id]/void/route.ts` — POST (any non-terminal → voided, terminal)

**Payments (3):**
- `payments/route.ts` — GET (list) + POST (create draft, auto PMT-YYYY-NNNNNN, overpayment protection: amount > invoice.balanceDue → 400)
- `payments/[id]/post/route.ts` — POST (draft → posted, calls postIncome via finance posting engine; resolves first active FinancialAccount + INC-SALES LedgerAccount; stores journalId on payment; recomputes invoice balance + auto-advances invoice status to paid/partially_paid)
- `payments/[id]/void/route.ts` — POST (posted → voided, calls voidJournal via finance posting engine; requires reason min 3 chars; recomputes invoice balance + auto-advances invoice status back to issued/partially_paid/paid)

**Receivables (1):**
- `receivables/route.ts` — GET (receivables dashboard: total outstanding, overdue count, aging buckets 0-30/31-60/61-90/90+, top 20 customer breakdown)

## Architecture Decisions
1. **Audit actions**: AuditAction enum doesn't include "post"/"void" — used "update" (status transition) for invoice void + payment post + payment void. Accept uses "approve"; reject uses "reject"; cancel uses "cancel" (all valid enum members).
2. **Permission actions** (sales module): Used actions matching the seeded perms (view/create/edit/submit/approve/issue/pay/void/export) plus canonical PermissionAction enum members "reject"/"cancel"/"post" where semantically correct. MD bypasses auth so all roles work for MD; non-MD roles require those perms to be added in future RBAC updates.
3. **Invoice issue action**: Used `authorize("sales", "issue")` (matches seeded sales perms).
4. **Payment post**: Stored the journalId returned by postIncome on `payment.journalId` for void/reversal lookup. Used `Awaited<ReturnType<typeof tx.invoice.update>>` type annotation for the `updatedInvoice` variable to fix TS narrowing to `never`.
5. **Idempotent conversion**: `quotes/[id]/convert` checks `convertedToSalesOrderId` first — if set, returns the linked SalesOrder with 200 OK without re-running conversion logic or rewriting audit.
6. **Overpayment protection**: payments/route.ts POST validates `amount <= invoice.balanceDue` and returns 400 with a clear message on violation.
7. **Receivables aging**: Uses `(now - dueDate)` in days, bucketed 0-30/31-60/61-90/90+. Only counts invoices with balance > 0 AND status != voided.
8. **Derived overdue flag**: Both invoices/route.ts GET and invoices/[id]/route.ts GET compute `overdue: isInvoiceOverdue(...)` on read — never stored on the invoice row.
9. **Finance boundary**: ZERO `prisma.journal.create` calls in sales API. Payment post/void routes ONLY call `postIncome` and `voidJournal` from `@/lib/finance/posting-engine`.

## Did NOT Modify
- Any files outside `src/app/api/sales/`.
- No Prisma schema, no seed files, no UI files.
- No test files created (per spec).

