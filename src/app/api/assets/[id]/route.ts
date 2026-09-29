import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid non-negative amount.");

const UpdateAssetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  assetTag: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  serialNumber: z.string().trim().max(150).nullable().optional(),
  condition: z.enum(["new", "good", "fair", "poor"]).optional(),
  status: z.enum(["active", "maintenance", "disposed", "lost", "sold"]).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  acquisitionDate: dateOnly.nullable().optional(),
  acquisitionCost: money.optional(),
  currentValue: money.optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  usefulLifeMonths: z.number().int().positive().max(1200).nullable().optional(),
  depreciationMethod: z.enum(["none", "straight_line"]).optional(),
  warrantyExpiry: dateOnly.nullable().optional(),
  custodianId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

function parseDateOnly(value: string | null | undefined) {
  if (value == null) return value;
  return new Date(Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  ));
}

function serializeAsset(asset: any) {
  return {
    ...asset,
    acquisitionCost: asset.acquisitionCost?.toString?.() ?? "0.00",
    currentValue: asset.currentValue?.toString?.() ?? "0.00",
    acquisitionDate: asset.acquisitionDate?.toISOString?.() ?? null,
    warrantyExpiry: asset.warrantyExpiry?.toISOString?.() ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("assets", "view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const asset = await db.asset.findFirst({
    where: { id, ...notDeleted() },
    include: {
      custodian: { select: { id: true, fullName: true, employeeNumber: true, employeeId: true, department: { select: { name: true } } } },
      supplier: { select: { id: true, tradingName: true, legalName: true, supplierNumber: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
      createdBy: { select: { id: true, username: true } },
      updatedBy: { select: { id: true, username: true } },
    },
  });
  if (!asset) return notFound("Asset not found.");
  return ok(serializeAsset(asset));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("assets", "edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await db.asset.findFirst({ where: { id, ...notDeleted() } });
  if (!existing) return notFound("Asset not found.");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = UpdateAssetSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed.", parsed.error.issues);
  const d = parsed.data;

  const acquisitionCost = d.acquisitionCost !== undefined ? toMoney(d.acquisitionCost) : toMoney(existing.acquisitionCost);
  const currentValue = d.currentValue !== undefined ? toMoney(d.currentValue) : toMoney(existing.currentValue);
  if (currentValue.lt(0)) return badRequest("Current value cannot be negative.");
  if (currentValue.gt(acquisitionCost)) return badRequest("Current value cannot exceed acquisition cost.");

  const acquisitionDate = d.acquisitionDate !== undefined ? parseDateOnly(d.acquisitionDate) : existing.acquisitionDate;
  const warrantyExpiry = d.warrantyExpiry !== undefined ? parseDateOnly(d.warrantyExpiry) : existing.warrantyExpiry;
  if (acquisitionDate && warrantyExpiry && warrantyExpiry < acquisitionDate) {
    return badRequest("Warranty expiry cannot be before acquisition date.");
  }

  const [custodian, supplier, project] = await Promise.all([
    d.custodianId ? db.employee.findFirst({ where: { id: d.custodianId, deletedAt: null }, select: { id: true } }) : null,
    d.supplierId ? db.supplier.findFirst({ where: { id: d.supplierId, deletedAt: null }, select: { id: true } }) : null,
    d.projectId ? db.project.findFirst({ where: { id: d.projectId, deletedAt: null }, select: { id: true } }) : null,
  ]);
  if (d.custodianId && !custodian) return badRequest("Selected custodian does not exist.");
  if (d.supplierId && !supplier) return badRequest("Selected supplier does not exist.");
  if (d.projectId && !project) return badRequest("Selected project does not exist.");

  const asset = await db.asset.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.assetTag !== undefined ? { assetTag: d.assetTag || null } : {}),
      ...(d.description !== undefined ? { description: d.description || null } : {}),
      ...(d.serialNumber !== undefined ? { serialNumber: d.serialNumber || null } : {}),
      ...(d.condition !== undefined ? { condition: d.condition } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.location !== undefined ? { location: d.location || null } : {}),
      ...(d.acquisitionDate !== undefined ? { acquisitionDate } : {}),
      ...(d.acquisitionCost !== undefined ? { acquisitionCost } : {}),
      ...(d.currentValue !== undefined ? { currentValue } : {}),
      ...(d.currency !== undefined ? { currency: d.currency } : {}),
      ...(d.usefulLifeMonths !== undefined ? { usefulLifeMonths: d.usefulLifeMonths } : {}),
      ...(d.depreciationMethod !== undefined ? { depreciationMethod: d.depreciationMethod } : {}),
      ...(d.warrantyExpiry !== undefined ? { warrantyExpiry } : {}),
      ...(d.custodianId !== undefined ? { custodianId: d.custodianId || null } : {}),
      ...(d.supplierId !== undefined ? { supplierId: d.supplierId || null } : {}),
      ...(d.projectId !== undefined ? { projectId: d.projectId || null } : {}),
      ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      updatedById: auth.ctx.userId,
    },
    include: {
      custodian: { select: { id: true, fullName: true } },
      supplier: { select: { id: true, tradingName: true, legalName: true } },
      project: { select: { id: true, name: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "assets",
    recordId: asset.id,
    recordType: "Asset",
    description: `Updated asset ${asset.assetNumber} (${asset.name})`,
    newValue: { assetNumber: asset.assetNumber, name: asset.name, status: asset.status, currentValue: serializeMoney(asset.currentValue) },
  });

  return ok(serializeAsset(asset));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("assets", "delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await db.asset.findFirst({ where: { id, ...notDeleted() } });
  if (!existing) return notFound("Asset not found.");

  const asset = await db.asset.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: auth.ctx.userId },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "assets",
    recordId: asset.id,
    recordType: "Asset",
    description: `Archived asset ${asset.assetNumber} (${asset.name})`,
    previousValue: { assetNumber: existing.assetNumber, name: existing.name, status: existing.status },
  });

  return ok({ id: asset.id, archived: true });
}
