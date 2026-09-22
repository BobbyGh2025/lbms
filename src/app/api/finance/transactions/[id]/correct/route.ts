// ============================================================================
// LBMS Finance API — Correct a Posted Transaction
// ----------------------------------------------------------------------------
// POST /api/finance/transactions/[id]/correct
//   Corrects a posted income or expense transaction by:
//   1. Reversing the original (creates a reversal journal with mirrored entries)
//   2. Creating a new corrected transaction (posted)
//   3. Linking the corrected journal to the original via correctedFromId
//
//   The original posted journal remains IMMUTABLE — it is never modified.
//   All accounting effects go through the existing posting/reversal engine.
//
//   Body:
//   {
//     correctedAmount: string,
//     correctedDate: string (YYYY-MM-DD),
//     correctedFinancialAccountId?: string,
//     correctedLedgerAccountId?: string,
//     description?: string,
//     reason: string (min 3 chars)
//   }
//
//   Requires `finance:reverse` permission (correction involves reversal).
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { toPositiveMoney } from "@/lib/finance/money";
import {
  reverseJournal,
  postIncome,
  postExpense,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";
import { Prisma } from "@prisma/client";

const CorrectSchema = z.object({
  correctedAmount: z.union([z.string(), z.number()]),
  correctedDate: z.string().min(1, "Corrected date is required"),
  correctedFinancialAccountId: z.string().optional(),
  correctedLedgerAccountId: z.string().optional(),
  description: z.string().max(500).optional(),
  reason: z.string().min(3, "A correction reason (min 3 chars) is required"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "reverse");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Fetch the original journal
  const original = await db.journal.findUnique({
    where: { id },
    include: {
      entries: true,
      financialAccount: { select: { id: true, code: true, name: true, currency: true } },
      ledgerAccount: { select: { id: true, code: true, name: true, accountClass: true } },
    },
  });

  if (!original) return notFound("Transaction not found.");

  // Validate: must be posted
  if (original.status !== "posted") {
    return badRequest(
      `Only posted transactions can be corrected (current status: ${original.status}).`,
    );
  }

  // Validate: not already reversed
  const existingReversal = await db.journal.findFirst({
    where: { reversesId: original.id },
    select: { id: true, reference: true },
  });
  if (existingReversal) {
    return badRequest(
      `Transaction ${original.reference} has already been reversed/corrected by ${existingReversal.reference}.`,
    );
  }

  // Validate: not an AR/AP-linked transaction (those have their own workflows)
  if (original.transactionType === "opening_balance" || original.transactionType === "adjustment") {
    return badRequest(
      `${original.transactionType} transactions cannot be corrected through this endpoint.`,
    );
  }

  // Parse the correction body
  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CorrectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate amount
  const amount = toPositiveMoney(d.correctedAmount);
  if (amount.lte(0)) {
    return badRequest("Corrected amount must be greater than zero.");
  }

  // Determine corrected accounts (fall back to original if not provided)
  const finAccountId = d.correctedFinancialAccountId || original.financialAccountId;
  const ledgerAccountId = d.correctedLedgerAccountId || original.ledgerAccountId;

  if (!finAccountId) {
    return badRequest("A financial account is required (either corrected or from the original).");
  }
  if (!ledgerAccountId) {
    return badRequest("A ledger account is required (either corrected or from the original).");
  }

  // Validate accounts exist + active
  const [account, ledger] = await Promise.all([
    db.financialAccount.findFirst({
      where: { id: finAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true, name: true },
    }),
    db.ledgerAccount.findFirst({
      where: { id: ledgerAccountId, deletedAt: null, status: "active" },
      select: { id: true, name: true, accountClass: true },
    }),
  ]);
  if (!account) return badRequest("The selected financial account is invalid or inactive.");
  if (!ledger) return badRequest("The selected ledger account is invalid or inactive.");

  // Verify the ledger account class matches the transaction type
  if (original.transactionType === "income" && ledger.accountClass !== "income") {
    return badRequest("The corrected ledger account must be an income account.");
  }
  if (original.transactionType === "expense" && ledger.accountClass !== "expense") {
    return badRequest("The corrected ledger account must be an expense account.");
  }

  const originalAmount = new Prisma.Decimal(original.amount);

  try {
    // Execute the correction within a single database transaction
    const result = await db.$transaction(async (tx) => {
      // STEP 1: Reverse the original journal
      const reversal = await reverseJournal({
        journalId: original.id,
        reason: `Correction: ${d.reason}`,
        createdById: auth.ctx.userId,
        client: tx,
      });

      // STEP 2: Create the corrected transaction
      const commonArgs = {
        date: d.correctedDate,
        amount: d.correctedAmount as string,
        financialAccountId: finAccountId,
        ledgerAccountId: ledgerAccountId,
        description: d.description || original.description || undefined,
        notes: `Corrected from ${original.reference}. Reason: ${d.reason}`,
        departmentId: original.departmentId || undefined,
        paymentMethod: original.paymentMethod || undefined,
        externalRef: original.externalRef || undefined,
        createdById: auth.ctx.userId,
        status: "posted" as const,
      };

      let corrected;
      if (original.transactionType === "income") {
        corrected = await postIncome({
          ...commonArgs,
          customerId: original.customerId || undefined,
          partyType: original.partyType as "customer" | undefined,
          partyRef: original.partyRef || undefined,
          projectId: original.projectId || undefined,
          projectRef: original.projectRef || undefined,
        });
      } else {
        corrected = await postExpense({
          ...commonArgs,
          supplierId: original.supplierId || undefined,
          partyType: original.partyType as "supplier" | undefined,
          partyRef: original.partyRef || undefined,
          projectId: original.projectId || undefined,
          projectRef: original.projectRef || undefined,
        });
      }

      // STEP 3: Link the corrected journal to the original
      await tx.journal.update({
        where: { id: corrected.id },
        data: {
          correctedFromId: original.id,
          correctionReason: d.reason,
        },
      });

      return { reversal, corrected };
    });

    // STEP 4: Audit (outside the transaction — best-effort)
    await auditFromCtx(auth.ctx, {
      action: "correct",
      module: "finance",
      recordId: original.id,
      recordType: "Journal",
      description: `Corrected transaction ${original.reference}. Original: ${originalAmount} → Corrected: ${amount}. Reason: ${d.reason}. Reversal: ${result.reversal.reference}. Corrected: ${result.corrected.reference}.`,
      previousValue: {
        reference: original.reference,
        amount: originalAmount.toString(),
        date: original.transactionDate,
        status: original.status,
      },
      newValue: {
        correctedReference: result.corrected.reference,
        correctedAmount: amount.toString(),
        correctedDate: d.correctedDate,
        reversalReference: result.reversal.reference,
        reason: d.reason,
      },
    });

    return ok({
      original: {
        id: original.id,
        reference: original.reference,
        amount: originalAmount.toString(),
        status: original.status,
      },
      reversal: {
        id: result.reversal.id,
        reference: result.reversal.reference,
      },
      corrected: {
        id: result.corrected.id,
        reference: result.corrected.reference,
        amount: amount.toString(),
      },
      reason: d.reason,
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    throw err;
  }
}
