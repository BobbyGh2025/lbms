import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid non-negative amount.");

const CreateAssetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  assetTag: z.string().trim().max(100).optional(),
  description: z.string().trim().max(5000).optional(),
  serialNumber: z.string().trim().max(150).optional(),
  condition: z.enum(["new", "good", "fair", "poor"]).default("good"),
  status: z.enum(["active", "maintenance", "disposed", "lost", "sold"]).default("active"),
  location: z.string().trim().max(200).optional(),
  acquisitionDate: dateOnly.optional(),
  acquisitionCost: money.default("0"),
  currentValue: money.default("0"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code.").default("GHS"),
  usefulLifeMonths: z.number().int().positive().max(1200).optional(),
  depreciationMethod: z.enum(["none", "straight_line"]).default("none"),
  warrantyExpiry: dateOnly.optional(),
  custodianId: z.string().optional(),
  supplierId: z.string().optional(),
  projectId: z.string().optional(),
  notes: z.string().trim().max(5000).optional(),
});

function parseDateOnly(value?: string) {
  if (!value) return null;
  return new Date(Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  ));
}

async function nextAssetNumber(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], date: Date) {
  const year = date.getUTCFullYear();
  const counter = await tx.assetRefCounter.upsert({
    where: { prefix_year: { prefix: "AST", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "AST", year, nextNumber: 2 },
  });
  return `AST-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
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

export async function GET(req: NextRequest) {
  const auth = await authorize("assets", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const search = sp.get("search")?.trim() || undefined;
  const category = sp.get("category")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const condition = sp.get("condition")?.trim() || undefined;

  const where: any = {
    ...notDeleted(),
    ...(category ? { category } : {}),
    ...(status && status !== "all" ? { status } : {}),
    ...(condition && condition !== "all" ? { condition } : {}),
    ...(search ? {
      OR: [
        { assetNumber: { contains: search } },
        { assetTag: { contains: search } },
        { name: { contains: search } },
        { serialNumber: { contains: search } },
        { location: { contains: search } },
      ],
    } : {}),
  };

  const [total, items] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        custodian: { select: { id: true, fullName: true, employeeNumber: true, employeeId: true } },
        supplier: { select: { id: true, tradingName: true, legalName: true, supplierNumber: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    }),
  ]);

  const categories = await db.asset.findMany({
    where: notDeleted(),
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });

  return ok({
    items: items.map(serializeAsset),
    categories: categories.map((x) => x.category),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function POST(req: NextRequest) {
  const auth = await authorize("assets", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateAssetSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed.", parsed.error.issues);
  const d = parsed.data;

  if (d.currentValue && toMoney(d.currentValue).lt(0)) return badRequest("Current value cannot be negative.");
  if (toMoney(d.currentValue).gt(toMoney(d.acquisitionCost))) return badRequest("Current value cannot exceed acquisition cost.");

  const acquisitionDate = parseDateOnly(d.acquisitionDate);
  const warrantyExpiry = parseDateOnly(d.warrantyExpiry);

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

  const asset = await db.$transaction(async (tx) => {
    const referenceDate = acquisitionDate ?? new Date();
    const assetNumber = await nextAssetNumber(tx, referenceDate);
    return tx.asset.create({
      data: {
        assetNumber,
        assetTag: d.assetTag || null,
        name: d.name,
        category: d.category,
        description: d.description || null,
        serialNumber: d.serialNumber || null,
        condition: d.condition,
        status: d.status,
        location: d.location || null,
        acquisitionDate,
        acquisitionCost: toMoney(d.acquisitionCost),
        currentValue: toMoney(d.currentValue),
        currency: d.currency,
        usefulLifeMonths: d.usefulLifeMonths,
        depreciationMethod: d.depreciationMethod,
        warrantyExpiry,
        custodianId: d.custodianId || null,
        supplierId: d.supplierId || null,
        projectId: d.projectId || null,
        notes: d.notes || null,
        createdById: auth.ctx.userId,
        updatedById: auth.ctx.userId,
      },
      include: {
        custodian: { select: { id: true, fullName: true } },
        supplier: { select: { id: true, tradingName: true, legalName: true } },
        project: { select: { id: true, name: true } },
      },
    });
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "assets",
    recordId: asset.id,
    recordType: "Asset",
    description: `Created asset ${asset.assetNumber} (${asset.name})`,
    newValue: { assetNumber: asset.assetNumber, name: asset.name, category: asset.category, acquisitionCost: serializeMoney(asset.acquisitionCost) },
  });

  return ok(serializeAsset(asset), 201);
}
