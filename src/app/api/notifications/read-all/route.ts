import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.notification.updateMany({
    where: { userId: session.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  await recordAudit({
    userId: session.user.id,
    action: "update",
    module: "notifications",
    description: `Marked ${result.count} notification(s) as read`,
  });

  return NextResponse.json({ updated: result.count });
}
