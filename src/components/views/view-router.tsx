"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardView } from "@/components/views/dashboard/dashboard-view";
import { ComingSoonView } from "@/components/views/coming-soon/coming-soon-view";
import { UsersView } from "@/components/views/users/users-view";
import { RolesView } from "@/components/views/roles/roles-view";
import { DepartmentsView } from "@/components/views/departments/departments-view";
import { SettingsView } from "@/components/views/settings/settings-view";
import { AuditView } from "@/components/views/audit/audit-view";
import { FinanceOverviewView } from "@/components/views/finance/finance-overview-view";
import { FinanceIncomeView } from "@/components/views/finance/finance-income-view";
import { FinanceExpensesView } from "@/components/views/finance/finance-expenses-view";
import { FinanceTransfersView } from "@/components/views/finance/finance-transfers-view";
import { FinanceTransactionsView } from "@/components/views/finance/finance-transactions-view";
import { FinanceAccountsView } from "@/components/views/finance/finance-accounts-view";
import { FinanceCategoriesView } from "@/components/views/finance/finance-categories-view";
import { FinanceReportsView } from "@/components/views/finance/finance-reports-view";
import { StaffDirectoryView } from "@/components/views/staff/staff-directory-view";
import { StaffProfileView } from "@/components/views/staff/staff-profile-view";
import { StaffLeaveView } from "@/components/views/staff/staff-leave-view";
import { StaffPerformanceView } from "@/components/views/staff/staff-performance-view";
import { CustomersView } from "@/components/views/crm/customers-view";
import { SuppliersView } from "@/components/views/crm/suppliers-view";
import { ActivitiesView } from "@/components/views/crm/activities-view";
import { CustomerProfileView } from "@/components/views/crm/customer-profile-view";
import { SupplierProfileView } from "@/components/views/crm/supplier-profile-view";
import { ProjectsView } from "@/components/views/projects/projects-view";
import { ProjectProfileView } from "@/components/views/projects/project-profile-view";
import { OperationsView } from "@/components/views/operations/operations-view";
import { TaskProfileView } from "@/components/views/operations/task-profile-view";
import { ProcurementView } from "@/components/views/procurement/procurement-view";
import { ProcurementRequestProfileView } from "@/components/views/procurement/procurement-request-profile-view";
import { PurchaseOrderProfileView } from "@/components/views/procurement/purchase-order-profile-view";
import { InventoryView } from "@/components/views/inventory/inventory-view";
import { InventoryItemProfileView } from "@/components/views/inventory/inventory-item-profile-view";
import { WarehouseProfileView } from "@/components/views/inventory/warehouse-profile-view";
import { ManagementReportsView } from "@/components/views/reports/management-reports-view";
import { SalesView } from "@/components/views/sales/sales-view";
import { ReceivablesView } from "@/components/views/sales/receivables-view";
import { QuoteProfileView } from "@/components/views/sales/quote-profile-view";
import { SalesOrderProfileView } from "@/components/views/sales/sales-order-profile-view";
import { InvoiceProfileView } from "@/components/views/sales/invoice-profile-view";
import { NAV_ITEM_BY_VIEW } from "@/lib/navigation";

function ViewRouterInner() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "dashboard";

  // Phase 1 implemented views
  if (view === "dashboard") return <DashboardView />;
  if (view === "users") return <UsersView />;
  if (view === "roles") return <RolesView />;
  if (view === "departments") return <DepartmentsView />;
  if (view === "settings") return <SettingsView />;
  if (view === "audit") return <AuditView />;

  // Phase 2 finance views
  if (view === "finance-overview") return <FinanceOverviewView />;
  if (view === "finance-income") return <FinanceIncomeView />;
  if (view === "finance-expenses") return <FinanceExpensesView />;
  if (view === "finance-transfers") return <FinanceTransfersView />;
  if (view === "finance-transactions") return <FinanceTransactionsView />;
  if (view === "finance-accounts") return <FinanceAccountsView />;
  if (view === "finance-categories") return <FinanceCategoriesView />;
  if (view === "finance-reports") return <FinanceReportsView />;

  // Phase 3 staff & HR views
  if (view === "staff-directory") return <StaffDirectoryView />;
  if (view === "staff-profile") return <StaffProfileView />;
  if (view === "staff-leave") return <StaffLeaveView />;
  if (view === "staff-performance") return <StaffPerformanceView />;

  // Phase 4 CRM views
  if (view === "customers") return <CustomersView />;
  if (view === "suppliers") return <SuppliersView />;
  if (view === "activities") return <ActivitiesView />;
  if (view === "customer-profile") return <CustomerProfileView />;
  if (view === "supplier-profile") return <SupplierProfileView />;

  // Phase 5 project views
  if (view === "projects") return <ProjectsView />;
  if (view === "project-profile") return <ProjectProfileView />;

  // Phase 6 operations views
  if (view === "operations") return <OperationsView />;
  if (view === "task-profile") return <TaskProfileView />;

  // Phase 7 procurement views
  if (view === "procurement") return <ProcurementView />;
  if (view === "procurement-request-profile") return <ProcurementRequestProfileView />;
  if (view === "purchase-order-profile") return <PurchaseOrderProfileView />;

  // Phase 8 inventory views
  if (view === "inventory") return <InventoryView />;
  if (view === "inventory-item-profile") return <InventoryItemProfileView />;
  if (view === "warehouse-profile") return <WarehouseProfileView />;

  // Phase 9 management intelligence
  if (view === "reports") return <ManagementReportsView />;

  // Phase 10 sales views
  if (view === "sales") return <SalesView />;
  if (view === "receivables") return <ReceivablesView />;
  if (view === "quote-profile") return <QuoteProfileView />;
  if (view === "sales-order-profile") return <SalesOrderProfileView />;
  if (view === "invoice-profile") return <InvoiceProfileView />;

  // Validate that view is a known nav item (prevents arbitrary view injection)
  if (!NAV_ITEM_BY_VIEW[view]) return <DashboardView />;

  // Phase 4+ views render a "coming soon" placeholder
  return <ComingSoonView view={view} />;
}

export function ViewRouter() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ViewRouterInner />
    </Suspense>
  );
}
