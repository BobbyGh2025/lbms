"use client";

import { Construction, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NAV_ITEM_BY_VIEW } from "@/lib/navigation";

interface ComingSoonProps {
  view: string;
}

const PHASE_DESCRIPTIONS: Record<number, string> = {
  2: "Income, expenditure, cash & bank accounts, and the financial dashboard.",
  3: "Budgets, accounts receivable, accounts payable, cash-flow and the approval system.",
  4: "Staff management, departments, positions, staff records and staff tasks.",
  5: "Customer relationship management, suppliers and transaction history.",
  6: "Project management, project budgets, project profitability and the future-project pipeline.",
  7: "Operational activities, issues, follow-ups and the MD decision log.",
  8: "Asset register, maintenance scheduling and document management.",
  9: "Advanced executive intelligence: KPIs, charts, management reports and alerts.",
  10: "Full security audit, performance testing, backup, recovery and PWA preparation.",
};

export function ComingSoonView({ view }: ComingSoonProps) {
  const item = NAV_ITEM_BY_VIEW[view];
  const phase = item?.phase ?? 2;
  const Icon = item?.icon ?? Construction;
  const description = PHASE_DESCRIPTIONS[phase] ?? "This module is planned for a future phase.";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-lg border-dashed">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center sm:p-10">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-8 w-8" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">{item?.label ?? "Module"}</h2>
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                Phase {phase}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              This module is part of the Lightworld Business Management System roadmap
              and is scheduled for delivery in Phase {phase}.
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 p-4 text-left">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Phase {phase} scope
            </p>
            <p className="text-sm">{description}</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Currently shipping</span>
            <Badge variant="secondary" className="text-[10px]">Phase 1 · Foundation</Badge>
            <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
