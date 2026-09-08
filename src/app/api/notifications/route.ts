import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      category: n.category,
      linkUrl: n.linkUrl,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}
