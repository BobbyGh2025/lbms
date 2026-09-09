// ============================================================================
// LBMS Finance — Single Transaction Detail API
// GET /api/finance/transactions/[id]   — fetch a journal + its entries
// ============================================================================

import { NextRequest } from "next/server";
import { authorize, notFound, ok } from "@/lib/api-helpers";
import { getTransactionDetail } from "@/lib/finance/reporting";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const detail = await getTransactionDetail(id);
  if (!detail) return notFound("Transaction not found.");
  return ok(detail);
}
