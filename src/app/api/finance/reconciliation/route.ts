// ============================================================================
// LBMS Finance — Reconciliation Check API
// GET /api/finance/reconciliation   — verify all posted journals balance
// ============================================================================

import { authorize, ok } from "@/lib/api-helpers";
import { runReconciliation } from "@/lib/finance/reporting";

export async function GET() {
  const auth = await authorize("finance", "view_reports");
  if (!auth.ok) return auth.response;
  const report = await runReconciliation();
  return ok(report);
}
