// ============================================================================
// LBMS Finance — Transactions API (the unified ledger view)
// GET /api/finance/transactions   — paginated, filterable list of all journals
// ============================================================================

import { NextRequest } from "next/server";
import { authorize, ok, pagination } from "@/lib/api-helpers";
import { listTransactions } from "@/lib/finance/reporting";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize, search } = pagination(sp);
  const transactionType = sp.get("transactionType") || undefined;
  const status = sp.get("status") || undefined;
  const financialAccountId = sp.get("financialAccountId") || undefined;
  const ledgerAccountId = sp.get("ledgerAccountId") || undefined;
  const departmentId = sp.get("departmentId") || undefined;
  const from = sp.get("from");
  const to = sp.get("to");

  const result = await listTransactions({
    page,
    pageSize,
    search,
    transactionType,
    status,
    financialAccountId,
    ledgerAccountId,
    departmentId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });

  return ok(result);
}
