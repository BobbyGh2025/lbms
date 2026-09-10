// ============================================================================
// LBMS Phase 9 — Management Reporting Helpers
// ----------------------------------------------------------------------------
// Shared utilities for the Management Intelligence Center reporting APIs.
// All functions here are READ-ONLY — they never mutate business data.
//
// Date range parsing supports: today, week, month, quarter, year, previous
// month/quarter/year, and custom from/to. Server-side calculation is
// authoritative; client-side filtering is never used for KPI values.
// ============================================================================

export type PresetRange =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "prev_month"
  | "prev_quarter"
  | "prev_year"
  | "custom";

export interface ResolvedRange {
  from: Date;
  to: Date;
  preset: PresetRange;
  label: string;
}

/**
 * Parse a date-range request into a {from, to} pair. Accepts either a preset
 * (`preset=today|week|month|...`) or explicit `from`/`to` ISO strings.
 * Returns the resolved range with midnight boundaries (from = start of day,
 * to = end of day, inclusive).
 */
export function parseDateRange(params: URLSearchParams): ResolvedRange {
  const preset = (params.get("preset") as PresetRange | null) ?? "month";
  const customFrom = params.get("from");
  const customTo = params.get("to");

  if (preset === "custom" && customFrom && customTo) {
    return {
      from: startOfDay(new Date(customFrom)),
      to: endOfDay(new Date(customTo)),
      preset: "custom",
      label: `${new Date(customFrom).toLocaleDateString()} – ${new Date(customTo).toLocaleDateString()}`,
    };
  }

  const now = new Date();
  let from: Date;
  let to: Date = endOfDay(now);
  let label: string;

  switch (preset) {
    case "today":
      from = startOfDay(now);
      label = "Today";
      break;
    case "week": {
      // Week starts Monday
      const day = now.getDay(); // 0=Sun
      const diff = day === 0 ? 6 : day - 1;
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
      label = "This Week";
      break;
    }
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      label = now.toLocaleString("en-US", { month: "long", year: "numeric" });
      break;
    case "quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), qMonth, 1);
      const qNum = Math.floor(now.getMonth() / 3) + 1;
      label = `Q${qNum} ${now.getFullYear()}`;
      break;
    }
    case "year":
      from = new Date(now.getFullYear(), 0, 1);
      label = String(now.getFullYear());
      break;
    case "prev_month": {
      const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = pm;
      to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      label = pm.toLocaleString("en-US", { month: "long", year: "numeric" });
      break;
    }
    case "prev_quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), qMonth - 3, 1);
      to = endOfDay(new Date(now.getFullYear(), qMonth, 0));
      const qNum = Math.floor((now.getMonth() - 3 < 0 ? now.getMonth() + 9 : now.getMonth() - 3) / 3) + 1;
      label = `Q${qNum} ${from.getFullYear()}`;
      break;
    }
    case "prev_year":
      from = new Date(now.getFullYear() - 1, 0, 1);
      to = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      label = String(now.getFullYear() - 1);
      break;
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      label = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  return { from, to, preset, label };
}

/** Set time to 00:00:00.000 local. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Set time to 23:59:59.999 local (inclusive end of day). */
export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Build a Prisma `where` clause for a date field from a resolved range. */
export function rangeWhere(range: ResolvedRange, field = "transactionDate") {
  return {
    [field]: {
      gte: range.from,
      lte: range.to,
    },
  } as Record<string, { gte: Date; lte: Date }>;
}
