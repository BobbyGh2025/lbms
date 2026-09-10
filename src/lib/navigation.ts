// ============================================================================
// LBMS Navigation Configuration
// ----------------------------------------------------------------------------
// Single source of truth for the sidebar. Each item carries the module key
// used for permission checks and the planned phase so placeholder views can
// inform the user when a module lands.
// ============================================================================

import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Wallet,
  PieChart,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Building2,
  CheckSquare,
  UserCheck,
  Truck,
  FolderKanban,
  Target,
  Activity,
  Gavel,
  CheckCheck,
  Boxes,
  FileText,
  BarChart3,
  UserCog,
  ShieldCheck,
  History,
  Settings,
  DatabaseBackup,
  ArrowLeftRight,
  Receipt,
  ListOrdered,
  CalendarCheck,
  Award,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  module: string; // for permission check
  view: string; // query param value
  phase: number; // planned delivery phase
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Executive Dashboard", icon: LayoutDashboard, module: "dashboard", view: "dashboard", phase: 1 },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "finance-overview", label: "Finance Overview", icon: LayoutDashboard, module: "finance", view: "finance-overview", phase: 2 },
      { key: "income", label: "Income", icon: TrendingUp, module: "finance", view: "finance-income", phase: 2 },
      { key: "expenses", label: "Expenditure", icon: TrendingDown, module: "finance", view: "finance-expenses", phase: 2 },
      { key: "transfers", label: "Transfers", icon: ArrowLeftRight, module: "finance", view: "finance-transfers", phase: 2 },
      { key: "transactions", label: "Transactions", icon: Receipt, module: "finance", view: "finance-transactions", phase: 2 },
      { key: "accounts", label: "Cash & Bank Accounts", icon: Wallet, module: "finance", view: "finance-accounts", phase: 2 },
      { key: "categories", label: "Chart of Accounts", icon: ListOrdered, module: "finance", view: "finance-categories", phase: 2 },
      { key: "finance-reports", label: "Finance Reports", icon: BarChart3, module: "finance", view: "finance-reports", phase: 2 },
      { key: "budgets", label: "Budgets", icon: PieChart, module: "budgets", view: "budgets", phase: 3 },
      { key: "receivables", label: "Receivables", icon: ArrowDownToLine, module: "receivables", view: "receivables", phase: 3 },
      { key: "payables", label: "Payables", icon: ArrowUpFromLine, module: "payables", view: "payables", phase: 3 },
    ],
  },
  {
    label: "People",
    items: [
      { key: "staff", label: "Staff Directory", icon: Users, module: "staff", view: "staff-directory", phase: 3 },
      { key: "staff-leave", label: "Leave Management", icon: CalendarCheck, module: "leave", view: "staff-leave", phase: 3 },
      { key: "staff-performance", label: "Performance", icon: Award, module: "performance", view: "staff-performance", phase: 3 },
      { key: "departments", label: "Departments & Positions", icon: Building2, module: "departments", view: "departments", phase: 1 },
      { key: "tasks", label: "Staff Tasks", icon: CheckSquare, module: "tasks", view: "tasks", phase: 4 },
    ],
  },
  {
    label: "Business",
    items: [
      { key: "customers", label: "Customers", icon: UserCheck, module: "customers", view: "customers", phase: 4 },
      { key: "suppliers", label: "Suppliers", icon: Truck, module: "suppliers", view: "suppliers", phase: 4 },
      { key: "activities", label: "CRM Activities", icon: ClipboardList, module: "activities", view: "activities", phase: 4 },
      { key: "projects", label: "Projects", icon: FolderKanban, module: "projects", view: "projects", phase: 5 },
      { key: "pipeline", label: "Project Pipeline", icon: Target, module: "pipeline", view: "pipeline", phase: 7 },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "operations", label: "Operations", icon: Activity, module: "operations", view: "operations", phase: 6 },
      { key: "procurement", label: "Procurement", icon: Truck, module: "procurement", view: "procurement", phase: 7 },
      { key: "inventory", label: "Inventory", icon: Boxes, module: "inventory", view: "inventory", phase: 8 },
      { key: "decisions", label: "MD Decisions", icon: Gavel, module: "decisions", view: "decisions", phase: 7 },
      { key: "approvals", label: "Approvals", icon: CheckCheck, module: "approvals", view: "approvals", phase: 3 },
    ],
  },
  {
    label: "Assets & Documents",
    items: [
      { key: "assets", label: "Assets", icon: Boxes, module: "assets", view: "assets", phase: 8 },
      { key: "documents", label: "Documents", icon: FileText, module: "documents", view: "documents", phase: 8 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { key: "reports", label: "Management Intelligence", icon: BarChart3, module: "reports", view: "reports", phase: 9 },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "users", label: "Users", icon: UserCog, module: "users", view: "users", phase: 1 },
      { key: "roles", label: "Roles & Permissions", icon: ShieldCheck, module: "roles", view: "roles", phase: 1 },
      { key: "audit", label: "Audit Trail", icon: History, module: "audit", view: "audit", phase: 1 },
      { key: "settings", label: "Company Settings", icon: Settings, module: "settings", view: "settings", phase: 1 },
      { key: "backup", label: "Backup & Restore", icon: DatabaseBackup, module: "backup", view: "backup", phase: 10 },
    ],
  },
];

/** Flatten all nav items for quick lookup by view key. */
export const NAV_ITEM_BY_VIEW: Record<string, NavItem> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.view, i])),
);
