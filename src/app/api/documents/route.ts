import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf","image/png","image/jpeg","image/webp",
  "text/plain","application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

async function nextNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear();
  const counter = await tx.documentRefCounter.upsert({
    where: { prefix_year: { prefix: "DOC", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "DOC", year, nextNumber: 2 },
  });
  return `DOC-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
}

export async function GET(req: NextRequest) {
  const auth = await authorize("documents", "view");
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim();
  const category = sp.get("category")?.trim();
  const entityType = sp.get("entityType")?.trim();
  const entityId = sp.get("entityId")?.trim();

  const where: any = {
    ...notDeleted(),
    ...(category ? { category } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(search ? { OR: [
      { documentNumber: { contains: search } },
      { title: { contains: search } },
      { fileName: { contains: search } },
      { category: { contains: search } },
    ] } : {}),
  };

  const [items, categories] = await Promise.all([
    db.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id:true, documentNumber:true, title:true, category:true, description:true,
        fileName:true, mimeType:true, fileSize:true, externalUrl:true,
        entityType:true, entityId:true, status:true, uploadedById:true, createdAt:true, updatedAt:true,
      },
    }),
    db.document.findMany({
      where: notDeleted(),
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
  ]);

  return ok({ items, categories: categories.map(x => x.category) });
}

export async function POST(req: NextRequest) {
  const auth = await authorize("documents", "create");
  if (!auth.ok) return auth.response;

  const contentType = req.headers.get("content-type") ?? "";
  let title = "", category = "", description = "", entityType = "", entityId = "", externalUrl = "";
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    title = String(form.get("title") ?? "").trim();
    category = String(form.get("category") ?? "").trim();
    description = String(form.get("description") ?? "").trim();
    entityType = String(form.get("entityType") ?? "").trim();
    entityId = String(form.get("entityId") ?? "").trim();
    externalUrl = String(form.get("externalUrl") ?? "").trim();
    const candidate = form.get("file");
    if (candidate instanceof File && candidate.size > 0) file = candidate;
  } else {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
    title = String(body.title ?? "").trim();
    category = String(body.category ?? "").trim();
    description = String(body.description ?? "").trim();
    entityType = String(body.entityType ?? "").trim();
    entityId = String(body.entityId ?? "").trim();
    externalUrl = String(body.externalUrl ?? "").trim();
  }

  if (!title || title.length > 200) return badRequest("A document title is required.");
  if (!category || category.length > 100) return badRequest("A document category is required.");
  if (!file && !externalUrl) return badRequest("Provide a file or an external document URL.");
  if (externalUrl && !/^https?:\/\//i.test(externalUrl)) return badRequest("External URL must start with http:// or https://.");
  if (file) {
    if (file.size > MAX_FILE_BYTES) return badRequest("Document files are limited to 10 MB.");
    if (!ALLOWED_MIME.has(file.type)) return badRequest("This file type is not supported.");
  }

  const fileData = file ? Buffer.from(await file.arrayBuffer()) : null;
  const document = await db.$transaction(async tx => {
    const documentNumber = await nextNumber(tx);
    return tx.document.create({
      data: {
        documentNumber, title, category,
        description: description || null,
        fileName: file?.name ?? null,
        mimeType: file?.type ?? null,
        fileSize: file?.size ?? null,
        fileData: fileData ?? undefined,
        externalUrl: externalUrl || null,
        entityType: entityType || null,
        entityId: entityId || null,
        uploadedById: auth.ctx.userId,
      },
      select: {
        id:true, documentNumber:true, title:true, category:true, description:true,
        fileName:true, mimeType:true, fileSize:true, externalUrl:true, entityType:true, entityId:true,
        status:true, uploadedById:true, createdAt:true,
      },
    });
  });

  await auditFromCtx(auth.ctx, {
    action: "create", module: "documents", recordId: document.id, recordType: "Document",
    description: `Created document ${document.documentNumber} (${document.title})`,
    newValue: { documentNumber: document.documentNumber, title: document.title, category: document.category },
  });
  return ok(document, 201);
}
