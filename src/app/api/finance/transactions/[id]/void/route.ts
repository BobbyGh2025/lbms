// ============================================================================
// LBMS Finance — Void a posted transaction
// POST /api/finance/transactions/[id]/void   { reason }
// ----------------------------------------------------------------------------
// Void marks a posted journal as "voided" — excluded from balance
// calculations. Unlike reversal (which creates a mirrored journal), void
// nullifies the original in place. Use void for duplicate/mistaken postings;
// use reversal for posted transactions that need a traceable counter-entry.
// Only POSTED journals can be voided.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, badRequest, ok } from "@/lib/api-helpers";
import { voidJournal, FinanceValidationError } from "@/lib/finance/posting-engine";
import { checkIdempotency, cacheIdempotencyResponse } from "@/lib/finance/idempotency";

const VoidSchema = z.object({
  reason: z.string().min(3, "A void reason (min 3 chars) is required."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "void");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);

  const idem = await checkIdempotency(req, auth.ctx.userId, body);
  if (idem.replay) return idem.response!;

  try {
    const result = await voidJournal({
      journalId: id,
      reason: parsed.data.reason,
      createdById: auth.ctx.userId,
    });
    if (idem.key) {
      await cacheIdempotencyResponse(idem.key, 200, result);
    }
    return ok(result);
  } catch (err) {
    const errorResponse = err instanceof FinanceValidationError ? badRequest(err.message) : null;
    if (errorResponse && idem.key) {
      await cacheIdempotencyResponse(idem.key, 400, { error: (err as Error).message });
    }
    if (errorResponse) return errorResponse;
    throw err;
  }
}
