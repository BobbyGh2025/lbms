// ============================================================================
// LBMS Audit Log Helper
// ----------------------------------------------------------------------------
// Provides a single entry point to record audit events. Audit logs are
// append-only at the application layer; there is no update/delete API.
// ============================================================================

import { db } from "@/lib/db";

export type AuditAction =
  | "login"
  | "logout"
  | "login_failed"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "view_sensitive"
  | "export"
  | "system"
  | "void";

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction | string;
  module: string;
  recordId?: string | null;
  recordType?: string | null;
  description?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        module: entry.module,
        recordId: entry.recordId ?? null,
        recordType: entry.recordType ?? null,
        description: entry.description ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        previousValue:
          entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        newValue: entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      },
    });
  } catch (err) {
    // Audit logging must never break the primary operation. Log to stderr.
    console.error("[audit] failed to record audit entry:", err);
  }
}
