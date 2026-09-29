import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  getBackupPath,
  listDatabaseBackups,
  restoreDatabaseBackup,
} from "@/lib/backup";
import { authorize, auditFromCtx, badRequest, ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorize("backup", "view");
  if (!auth.ok) return auth.response;

  try {
    const id = req.nextUrl.searchParams.get("id");
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (download && id) {
      const data = await readFile(getBackupPath(id));
      await auditFromCtx(auth.ctx, {
        action: "export",
        module: "backup",
        recordId: id,
        recordType: "DatabaseBackup",
        description: `Downloaded database backup ${id}.`,
      });
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${id}.dump"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return ok({ items: await listDatabaseBackups() });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not read backups.");
  }
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");

  if (action === "restore") {
    const auth = await authorize("backup", "approve");
    if (!auth.ok) return auth.response;
    if (!auth.ctx.isMD) {
      return new NextResponse(JSON.stringify({ error: "Only the Managing Director can restore the production database." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: { id?: string; confirmation?: string };
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
    if (!body.id) return badRequest("Backup identifier is required.");
    if (body.confirmation !== "RESTORE") {
      return badRequest('Type "RESTORE" to confirm the destructive database restore.');
    }

    try {
      const result = await restoreDatabaseBackup(body.id);
      await auditFromCtx(auth.ctx, {
        action: "correct",
        module: "backup",
        recordId: body.id,
        recordType: "DatabaseBackup",
        description: `Restored production database from ${result.restoredBackup}; safety backup created as ${result.preRestoreBackup}.`,
      });
      return ok(result);
    } catch (error) {
      await auditFromCtx(auth.ctx, {
        action: "system",
        module: "backup",
        recordId: body.id,
        recordType: "DatabaseBackup",
        description: `Database restore failed for ${body.id}: ${error instanceof Error ? error.message : "unknown error"}`,
      });
      return badRequest(error instanceof Error ? error.message : "Database restore failed.");
    }
  }

  const auth = await authorize("backup", "create");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const label = typeof body?.label === "string" ? body.label.trim() : undefined;
    const backup = await createDatabaseBackup(label || undefined);
    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "backup",
      recordId: backup.id,
      recordType: "DatabaseBackup",
      description: `Created database backup ${backup.fileName}.`,
      newValue: backup,
    });
    return ok(backup, 201);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Backup creation failed.");
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await authorize("backup", "delete");
  if (!auth.ok) return auth.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return badRequest("Backup identifier is required.");

  try {
    await deleteDatabaseBackup(id);
    await auditFromCtx(auth.ctx, {
      action: "delete",
      module: "backup",
      recordId: id,
      recordType: "DatabaseBackup",
      description: `Deleted database backup ${id}.`,
    });
    return ok({ deleted: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not delete backup.");
  }
}
