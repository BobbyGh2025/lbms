// ============================================================================
// LBMS Finance — Single Transaction Detail API
// GET  /api/finance/transactions/[id]   — fetch a journal + its entries
// PATCH /api/finance/transactions/[id]  — edit a DRAFT transaction (no journal mutations)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, notFound, ok, badRequest, auditFromCtx } from "@/lib/api-helpers";
import { getTransactionDetail } from "@/lib/finance/reporting";
import { toPositiveMoney, serializeMoney } from "@/lib/finance/money";
import { Prisma } from "@prisma/client";

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

// ---------------------------------------------------------------------------
// PATCH /api/finance/transactions/[id] — edit a DRAFT transaction
// Only DRAFT journals can be edited. Posted journals are immutable (use
// the /correct endpoint instead). No new journals are created — existing
// journal fields + entries are updated in place.
// ---------------------------------------------------------------------------
const EditDraftSchema = z.object({
  transactionDate: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  financialAccountId: z.string().optional(),
  ledgerAccountId: z.string().optional(),
  description: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  paymentMethod: z.string().optional(),
  externalRef: z.string().max(200).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const journal = await db.journal.findUnique({
    where: { id },
    include: { entries: true },
  });
  if (!journal) return notFound("Transaction not found.");

  // Only DRAFT transactions can be edited
  if (journal.status !== "draft") {
    return badRequest(
      `Only draft transactions can be edited (current status: ${journal.status}). Use the Correct action for posted transactions.`,
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = EditDraftSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Build the update data for the journal
  const updateData: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.transactionDate) updateData.transactionDate = new Date(d.transactionDate);
  if (d.description !== undefined) updateData.description = d.description;
  if (d.notes !== undefined) updateData.notes = d.notes;
  if (d.departmentId !== undefined) updateData.departmentId = d.departmentId || null;
  if (d.paymentMethod !== undefined) updateData.paymentMethod = d.paymentMethod;
  if (d.externalRef !== undefined) updateData.externalRef = d.externalRef;

  // Handle amount change — update both the journal.amount and the entries
  let newAmount: Prisma.Decimal | undefined;
  if (d.amount !== undefined) {
    newAmount = toPositiveMoney(d.amount);
    if (newAmount.lte(0)) {
      return badRequest("Amount must be greater than zero.");
    }
    updateData.amount = serializeMoney(newAmount);
  }

  // Handle account changes
  if (d.financialAccountId) {
    const account = await db.financialAccount.findFirst({
      where: { id: d.financialAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true },
    });
    if (!account) return badRequest("Financial account is invalid or inactive.");
    updateData.financialAccountId = d.financialAccountId;
  }
  if (d.ledgerAccountId) {
    const ledger = await db.ledgerAccount.findFirst({
      where: { id: d.ledgerAccountId, deletedAt: null, status: "active" },
      select: { id: true, accountClass: true },
    });
    if (!ledger) return badRequest("Ledger account is invalid or inactive.");
    updateData.ledgerAccountId = d.ledgerAccountId;
  }

  // Update the journal + entries within a transaction
  await db.$transaction(async (tx) => {
    // Update journal header
    await tx.journal.update({ where: { id }, data: updateData });

    // If amount or accounts changed, update the entries
    if (newAmount || d.financialAccountId || d.ledgerAccountId) {
      const amount = newAmount ?? new Prisma.Decimal(journal.amount);
      const finAccId = (d.financialAccountId || journal.financialAccountId)!;
      const ledAccId = (d.ledgerAccountId || journal.ledgerAccountId)!;

      for (const entry of journal.entries) {
        const isFinancialEntry = !!entry.financialAccountId;
        if (isFinancialEntry) {
          await tx.journalEntry.update({
            where: { id: entry.id },
            data: {
              financialAccountId: finAccId,
              // Income: debit cash; Expense: credit cash
              debit: journal.transactionType === "income" ? serializeMoney(amount) : entry.debit,
              credit: journal.transactionType === "expense" ? serializeMoney(amount) : entry.credit,
            },
          });
        } else {
          await tx.journalEntry.update({
            where: { id: entry.id },
            data: {
              ledgerAccountId: ledAccId,
              // Income: credit income; Expense: debit expense
              credit: journal.transactionType === "income" ? serializeMoney(amount) : entry.credit,
              debit: journal.transactionType === "expense" ? serializeMoney(amount) : entry.debit,
            },
          });
        }
      }
    }
  });

  // Audit
  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "finance",
    recordId: id,
    recordType: "Journal",
    description: `Edited draft transaction ${journal.reference}.`,
    previousValue: {
      amount: journal.amount.toString(),
      date: journal.transactionDate,
      status: journal.status,
    },
    newValue: updateData,
  });

  // Return the updated journal
  const updated = await db.journal.findUnique({
    where: { id },
    include: { entries: true },
  });
  return ok(updated);
}
