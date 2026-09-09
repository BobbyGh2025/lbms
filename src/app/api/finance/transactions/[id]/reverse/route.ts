// ============================================================================
// LBMS Finance — Reverse a posted transaction
// POST /api/finance/transactions/[id]/reverse   { reason }
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, badRequest, ok } from "@/lib/api-helpers";
import { reverseJournal, FinanceValidationError } from "@/lib/finance/posting-engine";

const ReverseSchema = z.object({
  reason: z.string().min(3, "A reversal reason (min 3 chars) is required."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "reverse");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = ReverseSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);

  try {
    const result = await reverseJournal({
      journalId: id,
      reason: parsed.data.reason,
      createdById: auth.ctx.userId,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof FinanceValidationError) return badRequest(err.message);
    throw err;
  }
}
