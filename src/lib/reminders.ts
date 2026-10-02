import { db } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateKey(d: Date) {
  return startOfDay(d).toISOString().slice(0, 10);
}

function daysUntil(target: Date, now: Date) {
  return Math.floor((startOfDay(target).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function addReminder(
  userId: string,
  key: string,
  title: string,
  message: string,
  type: "info" | "warning" | "error" | "success",
  linkUrl: string,
) {
  const marker = `[REMINDER:${key}]`;
  const existing = await db.notification.findFirst({
    where: {
      userId,
      category: "reminder",
      message: { contains: marker },
    },
    select: { id: true },
  });
  if (existing) return;

  await db.notification.create({
    data: {
      userId,
      title,
      message: `${message} ${marker}`,
      type,
      category: "reminder",
      linkUrl,
    },
  });
}

export async function generateReminders(userId: string, isMD: boolean) {
  const now = new Date();
  const today = startOfDay(now);
  const horizon3 = new Date(today.getTime() + 3 * DAY_MS);
  const horizon7 = new Date(today.getTime() + 7 * DAY_MS);
  const horizon30 = new Date(today.getTime() + 30 * DAY_MS);

  const currentUser = await db.user.findUnique({
    where: { id: userId },
    select: { employeeId: true },
  });
  const employeeId = currentUser?.employeeId ?? null;

  // CRM activities: meetings, follow-ups and other scheduled activities.
  const activities = await db.activity.findMany({
    where: {
      status: { in: ["open", "overdue"] },
      dueDate: { not: null, lte: horizon3 },
      ...(!isMD
        ? { OR: [{ createdById: userId }, { assignedTo: { user: { id: userId } } }] }
        : {}),
    },
    select: {
      id: true, activityType: true, subject: true, dueDate: true,
      customer: { select: { tradingName: true, legalName: true } },
      supplier: { select: { tradingName: true, legalName: true } },
    },
  });

  for (const a of activities) {
    if (!a.dueDate) continue;
    const dueIn = daysUntil(a.dueDate, now);
    const party = a.customer?.tradingName || a.customer?.legalName || a.supplier?.tradingName || a.supplier?.legalName;
    const label = a.activityType === "meeting" ? "meeting" : a.activityType === "follow_up" ? "follow-up" : "activity";
    const prefix = party ? ` for ${party}` : "";
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `activity-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${a.id}-${dateKey(overdue ? now : a.dueDate)}`,
      overdue ? `Overdue ${label}` : dueIn === 0 ? `${label[0].toUpperCase() + label.slice(1)} due today` : `Upcoming ${label}`,
      overdue ? `${a.subject}${prefix} is overdue. Please follow up.` : dueIn === 0 ? `${a.subject}${prefix} is due today.` : `${a.subject}${prefix} is due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=activities",
    );
  }

  // Customer receivables: impending, due-today and overdue invoices.
  const invoices = await db.invoice.findMany({
    where: {
      status: { in: ["issued", "partially_paid"] },
      balanceDue: { gt: 0 },
      deletedAt: null,
      dueDate: { lte: horizon3 },
      ...(!isMD ? { createdById: userId } : {}),
    },
    select: {
      id: true, invoiceNumber: true, dueDate: true, balanceDue: true,
      customer: { select: { tradingName: true, legalName: true } },
    },
  });

  for (const inv of invoices) {
    const dueIn = daysUntil(inv.dueDate, now);
    const customer = inv.customer.tradingName || inv.customer.legalName || "Customer";
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `invoice-${overdue ? "overdue" : dueIn === 0 ? "due" : "upcoming"}-${inv.id}-${dateKey(overdue ? now : inv.dueDate)}`,
      overdue ? "Customer payment overdue" : dueIn === 0 ? "Customer payment due today" : "Customer payment impending",
      overdue
        ? `${customer} has an overdue balance of GHS ${money(inv.balanceDue)} on invoice ${inv.invoiceNumber}.`
        : dueIn === 0
          ? `${customer} owes GHS ${money(inv.balanceDue)} on invoice ${inv.invoiceNumber}, due today.`
          : `${customer} owes GHS ${money(inv.balanceDue)} on invoice ${inv.invoiceNumber}, due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=sales-invoices",
    );
  }

  // Operational tasks.
  const tasks = await db.task.findMany({
    where: {
      status: { notIn: ["completed", "cancelled"] },
      deletedAt: null,
      dueDate: { not: null, lte: horizon3 },
      ...(!isMD
        ? { OR: [{ createdById: userId }, { assignedEmployee: { user: { id: userId } } }] }
        : {}),
    },
    select: { id: true, taskNumber: true, title: true, dueDate: true },
  });

  for (const t of tasks) {
    if (!t.dueDate) continue;
    const dueIn = daysUntil(t.dueDate, now);
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `task-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${t.id}-${dateKey(overdue ? now : t.dueDate)}`,
      overdue ? "Task overdue" : dueIn === 0 ? "Task due today" : "Upcoming task",
      overdue ? `${t.taskNumber}: ${t.title} is overdue.` : `${t.taskNumber}: ${t.title} is due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=tasks",
    );
  }

  // Supplier payment obligations.
  const bills = await db.supplierBill.findMany({
    where: {
      status: { in: ["posted", "partially_paid"] },
      balanceDue: { gt: 0 },
      deletedAt: null,
      dueDate: { not: null, lte: horizon3 },
      ...(!isMD ? { createdById: userId } : {}),
    },
    select: {
      id: true, billNumber: true, dueDate: true, balanceDue: true,
      supplier: { select: { tradingName: true, legalName: true } },
    },
  });

  for (const b of bills) {
    if (!b.dueDate) continue;
    const dueIn = daysUntil(b.dueDate, now);
    const supplier = b.supplier.tradingName || b.supplier.legalName || "Supplier";
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `supplier-bill-${overdue ? "overdue" : dueIn === 0 ? "due" : "upcoming"}-${b.id}-${dateKey(overdue ? now : b.dueDate)}`,
      overdue ? "Supplier payment overdue" : dueIn === 0 ? "Supplier payment due today" : "Supplier payment impending",
      overdue
        ? `${supplier} bill ${b.billNumber} has GHS ${money(b.balanceDue)} outstanding and is overdue.`
        : `${supplier} bill ${b.billNumber} requires GHS ${money(b.balanceDue)} in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=payables",
    );
  }

  // Supplier deliveries.
  const orders = await db.purchaseOrder.findMany({
    where: {
      status: { in: ["approved", "sent", "partially_received"] },
      deletedAt: null,
      expectedDeliveryDate: { not: null, lte: horizon3 },
      ...(!isMD ? { requestedById: userId } : {}),
    },
    select: {
      id: true, purchaseOrderNumber: true, expectedDeliveryDate: true,
      supplier: { select: { tradingName: true, legalName: true } },
    },
  });

  for (const po of orders) {
    if (!po.expectedDeliveryDate) continue;
    const dueIn = daysUntil(po.expectedDeliveryDate, now);
    const supplier = po.supplier.tradingName || po.supplier.legalName || "Supplier";
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `po-delivery-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${po.id}-${dateKey(overdue ? now : po.expectedDeliveryDate)}`,
      overdue ? "Purchase order delivery overdue" : dueIn === 0 ? "Purchase order delivery due today" : "Upcoming supplier delivery",
      overdue ? `${po.purchaseOrderNumber} from ${supplier} is past its expected delivery date.` : `${po.purchaseOrderNumber} from ${supplier} is due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=procurement",
    );
  }

  // Project milestones.
  const milestones = await db.projectMilestone.findMany({
    where: {
      status: "pending",
      dueDate: { not: null, lte: horizon7 },
      project: {
        deletedAt: null,
        ...(!isMD ? { projectManager: { user: { id: userId } } } : {}),
      },
    },
    select: {
      id: true, name: true, dueDate: true,
      project: { select: { projectNumber: true, name: true } },
    },
  });

  for (const m of milestones) {
    if (!m.dueDate) continue;
    const dueIn = daysUntil(m.dueDate, now);
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `milestone-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${m.id}-${dateKey(overdue ? now : m.dueDate)}`,
      overdue ? "Project milestone overdue" : dueIn === 0 ? "Project milestone due today" : "Upcoming project milestone",
      overdue ? `${m.project.projectNumber}: ${m.name} is overdue.` : `${m.project.projectNumber}: ${m.name} is due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=projects",
    );
  }

  // Quotations nearing expiry — prompts sales follow-up.
  const quotes = await db.quote.findMany({
    where: {
      status: "sent",
      deletedAt: null,
      expiryDate: { not: null, lte: horizon3 },
      ...(!isMD ? { createdById: userId } : {}),
    },
    select: {
      id: true, quoteNumber: true, expiryDate: true,
      customer: { select: { tradingName: true, legalName: true } },
    },
  });

  for (const q of quotes) {
    if (!q.expiryDate) continue;
    const dueIn = daysUntil(q.expiryDate, now);
    const overdue = dueIn < 0;
    const customer = q.customer.tradingName || q.customer.legalName || "Customer";
    await addReminder(
      userId,
      `quote-${overdue ? "expired" : "expiring"}-${q.id}-${dateKey(overdue ? now : q.expiryDate)}`,
      overdue ? "Quotation expired" : "Quotation expiring soon",
      overdue ? `${q.quoteNumber} for ${customer} has expired.` : `${q.quoteNumber} for ${customer} expires in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "warning" : "info",
      "/?view=sales-quotes",
    );
  }

  // Staff contract/end-date reminders.
  const employees = await db.employee.findMany({
    where: {
      status: { notIn: ["resigned", "terminated", "retired", "inactive"] },
      endDate: { not: null, lte: horizon30 },
    },
    select: { id: true, employeeId: true, fullName: true, endDate: true, user: { select: { id: true } } },
  });

  for (const e of employees) {
    if (!e.endDate) continue;
    const dueIn = daysUntil(e.endDate, now);
    const overdue = dueIn < 0;
    if (!isMD && e.user?.id !== userId) continue;
    await addReminder(
      userId,
      `employee-end-${overdue ? "overdue" : "upcoming"}-${e.id}-${dateKey(overdue ? now : e.endDate)}`,
      overdue ? "Employee end date passed" : "Employee end date approaching",
      overdue
        ? `${e.employeeId} - ${e.fullName}'s employment end date has passed.`
        : `${e.employeeId} - ${e.fullName}'s employment end date is in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "warning" : "info",
      "/?view=staff-directory",
    );
  }

  // Asset warranty expiry reminders.
  const assets = await db.asset.findMany({
    where: {
      status: { notIn: ["disposed", "lost", "sold"] },
      warrantyExpiry: { not: null, lte: horizon30 },
    },
    select: { id: true, assetNumber: true, name: true, warrantyExpiry: true },
  });

  for (const asset of assets) {
    if (!asset.warrantyExpiry) continue;
    const dueIn = daysUntil(asset.warrantyExpiry, now);
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `asset-warranty-${overdue ? "expired" : "upcoming"}-${asset.id}-${dateKey(overdue ? now : asset.warrantyExpiry)}`,
      overdue ? "Asset warranty expired" : "Asset warranty expiring",
      overdue
        ? `${asset.assetNumber} - ${asset.name} warranty has expired.`
        : `${asset.assetNumber} - ${asset.name} warranty expires in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "warning" : "info",
      "/?view=assets",
    );
  }

  // Project planned completion reminders.
  const projects = await db.project.findMany({
    where: {
      status: { in: ["planning", "active", "on_hold"] },
      deletedAt: null,
      plannedEndDate: { not: null, lte: horizon7 },
      ...(!isMD ? { projectManager: { user: { id: userId } } } : {}),
    },
    select: { id: true, projectNumber: true, name: true, plannedEndDate: true },
  });

  for (const p of projects) {
    if (!p.plannedEndDate) continue;
    const dueIn = daysUntil(p.plannedEndDate, now);
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `project-end-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${p.id}-${dateKey(overdue ? now : p.plannedEndDate)}`,
      overdue ? "Project planned end date passed" : dueIn === 0 ? "Project planned end date today" : "Project deadline approaching",
      overdue
        ? `${p.projectNumber}: ${p.name} has passed its planned end date.`
        : `${p.projectNumber}: ${p.name} reaches its planned end date in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "error" : dueIn === 0 ? "warning" : "info",
      "/?view=projects",
    );
  }

  // Management decisions and approvals.
  if (isMD) {
    const decisions = await db.mDDecision.findMany({
      where: {
        status: { in: ["draft", "pending", "approved"] },
        deletedAt: null,
        dueDate: { not: null, lte: horizon7 },
      },
      select: { id: true, decisionNumber: true, title: true, dueDate: true },
    });

    for (const d of decisions) {
      if (!d.dueDate) continue;
      const dueIn = daysUntil(d.dueDate, now);
      const overdue = dueIn < 0;
      await addReminder(
        userId,
        `decision-${overdue ? "overdue" : dueIn === 0 ? "today" : "upcoming"}-${d.id}-${dateKey(overdue ? now : d.dueDate)}`,
        overdue ? "MD decision overdue" : dueIn === 0 ? "MD decision due today" : "Upcoming MD decision",
        overdue ? `${d.decisionNumber}: ${d.title} is overdue.` : `${d.decisionNumber}: ${d.title} is due in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
        overdue ? "error" : dueIn === 0 ? "warning" : "info",
        "/?view=decisions",
      );
    }

    const approvals = await db.approvalRequest.findMany({
      where: { status: "pending", approverId: userId },
      select: { id: true, approvalNumber: true, title: true },
    });

    for (const a of approvals) {
      await addReminder(
        userId,
        `approval-${a.id}-${dateKey(now)}`,
        "Approval pending",
        `${a.approvalNumber}: ${a.title} is awaiting your approval.`,
        "warning",
        "/?view=approvals",
      );
    }
  }

  // Sales pipeline opportunities nearing expected close.
  const opportunities = await db.pipelineOpportunity.findMany({
    where: {
      stage: { in: ["lead", "qualified", "proposal", "negotiation"] },
      deletedAt: null,
      expectedCloseDate: { not: null, lte: horizon7 },
      ...(!isMD && employeeId
        ? { ownerId: employeeId }
        : !isMD
          ? { createdById: userId }
          : {}),
    },
    select: {
      id: true, opportunityNumber: true, title: true, expectedCloseDate: true,
    },
  });

  for (const o of opportunities) {
    if (!o.expectedCloseDate) continue;
    const dueIn = daysUntil(o.expectedCloseDate, now);
    const overdue = dueIn < 0;
    await addReminder(
      userId,
      `opportunity-${overdue ? "past-due" : "upcoming"}-${o.id}-${dateKey(overdue ? now : o.expectedCloseDate)}`,
      overdue ? "Opportunity close date passed" : "Opportunity follow-up due",
      overdue ? `${o.opportunityNumber}: ${o.title} has passed its expected close date.` : `${o.opportunityNumber}: ${o.title} reaches its expected close date in ${dueIn} day${dueIn === 1 ? "" : "s"}.`,
      overdue ? "warning" : "info",
      "/?view=pipeline",
    );
  }
}
