# Task ID: P8-UI
**Agent:** full-stack-developer

## Task
Build 3 inventory UI views for LBMS Phase 8 — Inventory & Warehouse Management:
1. `src/components/views/inventory/inventory-view.tsx` — directory (4 tabs)
2. `src/components/views/inventory/inventory-item-profile-view.tsx` — item profile (4 tabs)
3. `src/components/views/inventory/warehouse-profile-view.tsx` — warehouse profile (4 tabs)

## Prior Context Read
- `/home/z/my-project/worklog.md` — Phases 1–7 complete; Phase 8 backend API already built.
- Pattern references: `procurement-view.tsx` (directory pattern), `purchase-order-profile-view.tsx` + `procurement-request-profile-view.tsx` (profile pattern with tabs).
- API contracts verified by reading each route file under `src/app/api/inventory/**`.

## Work Log
1. Created `inventory-view.tsx` (directory):
   - PageHeader "Inventory" + subtitle.
   - 4 tabs: Items | Warehouses | Stock | Movements.
   - Items tab: search (code/name), category filter (loaded from /api/inventory/categories),
     active filter (all/active/inactive), "New Item" button (gated by can("inventory","create"))
     opening create dialog (itemCode, name, description, categoryId select, unitOfMeasure,
     reorderLevel, reorderQuantity, active checkbox; submit data-testid="submit-item").
     Table: Code | Name | Category | UoM | Reorder Level | Active badge | Movements count.
     Row click → /?view=inventory-item-profile&id=. Low-stock items highlighted amber —
     computed by fetching all stock balances in parallel with the items list and building a
     Set of itemIds whose any balance ≤ reorderLevel.
   - Warehouses tab: active filter, "New Warehouse" button (gated by can("inventory","create"))
     opening create dialog (code, name, description, location, active checkbox;
     submit data-testid="submit-warehouse"). Table: Code | Name | Location | Active badge |
     Items count | Movements count. Row click → /?view=warehouse-profile&id=.
   - Stock tab: warehouse filter select (loaded from /api/inventory/warehouses), low-stock-only
     checkbox. Table: Item Code | Item Name | Warehouse | Quantity | UoM | Reorder Level |
     Status badge (In Stock emerald / Low Stock amber). Low-stock rows highlighted amber.
     Row click → item profile.
   - Movements tab: search by movementNumber, movementType filter select. Table: Movement # |
     Date | Type (color-coded badge) | Item | Warehouse | Quantity | Reason | Performed By.
     Paginated with prev/next buttons + page indicator.
2. Created `inventory-item-profile-view.tsx` (profile):
   - Back button → /?view=inventory.
   - Loads item via GET /api/inventory/items/[id].
   - Header card: active badge (emerald/rose) + category badge (sky).
   - 4 tabs: Overview | Stock by Warehouse | Movement History | Audit.
   - Overview: item details card (itemCode, name, category, UoM, reorderLevel, reorderQuantity,
     active badge) + description/audit card (description, category description, created/updated
     timestamps, createdBy).
   - Stock by Warehouse: table of stockBalances (Warehouse code+name, Quantity, UoM, Reorder
     Level, Status badge). Low-stock rows highlighted amber. Row click → warehouse profile.
   - Movement History: paginated table from /api/inventory/stock/movements?inventoryItemId=...
     &pageSize=20 (movementNumber, date, type badge, warehouse, quantity+UoM, reason,
     performedBy). Prev/next pagination. Row click → warehouse profile.
   - Audit: placeholder Card.
   - Empty states: "No item selected" if id missing, "Item not found" if 404.
3. Created `warehouse-profile-view.tsx` (profile):
   - Back button → /?view=inventory.
   - Loads warehouse via GET /api/inventory/warehouses/[id].
   - Header card: active badge, location, item/movement counts.
   - 4 tabs: Overview | Stock Items | Movements | Audit.
   - Overview: warehouse details card (code, name, location, active badge) + description/audit
     card with count tiles (stockBalances, movements).
   - Stock Items: table of stockBalances (Item code, Item name, Quantity, UoM, Reorder Level,
     Status badge). Low-stock rows highlighted amber. Row click → item profile.
   - Movements: paginated table from /api/inventory/stock/movements?warehouseId=...&pageSize=20
     (movementNumber, date, type badge, item, quantity, reason, performedBy). Prev/next
     pagination. Row click → item profile.
   - Audit: placeholder Card.
   - Empty states: "No warehouse selected" / "Warehouse not found".
4. Constraints honoured:
   - "use client" directive at top of every file.
   - shadcn/ui components only (Button, Input, Label, Textarea, Badge, Skeleton, Card,
     CardContent, CardHeader, CardTitle, Tabs, TabsList, TabsTrigger, TabsContent, Table,
     TableBody, TableCell, TableHead, TableHeader, TableRow, Dialog, DialogContent,
     DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent,
     SelectItem, SelectTrigger, SelectValue).
   - PageHeader + EmptyState from @/components/common.
   - useAuth() for permission gating (can("inventory","create")).
   - toast from sonner for notifications.
   - useRouter + useSearchParams for nav; relative fetch paths only.
   - type="button" + onClick + data-testid on every submit button.
   - Loading skeletons + Loader2 spinners during async ops.
   - Decimal fields displayed via formatAmount() (no JS Number corruption).
   - Date display via toLocaleDateString / toLocaleString.
   - Movement-type badges with required color palette (RECEIPT/TRANSFER_IN/ADJUSTMENT_IN emerald,
     ISSUE/ADJUSTMENT_OUT rose, TRANSFER_OUT amber).
   - Status badges: emerald (active/in-stock), rose (inactive), amber (low-stock), sky (category).
   - Responsive: overflow-x-auto on every table, flex-wrap on action rows + TabsList, mobile-first
     grids.
   - All fetches wrapped in try/catch with toast.error on failure.
   - NO indigo/blue primary colors.
   - Card alignment: p-4 sm:p-6 padding, gap-4 / gap-6 spacing.
5. VERIFICATION:
   - `npx tsc --noEmit 2>&1 | grep inventory` → CLEAN (zero errors in inventory files; remaining
     tsc errors are all pre-existing in unrelated directories: prisma/seed.ts, scripts/, skills/).
   - `bun run lint 2>&1 | grep inventory` → CLEAN (zero warnings/errors). Full `bun run lint`
     exits 0.
   - Dev server log: clean, only 200 GET / responses, no compilation errors with new files.

## Stage Summary
- 3 new UI files (1 directory + 2 profile views) consuming the existing Phase 8 inventory API.
- InventoryView: directory with 4 tabs (Items/Warehouses/Stock/Movements), 2 create dialogs
  (New Item + New Warehouse), search/filter/pagination throughout, low-stock highlighting
  computed client-side via parallel stock-balance fetch.
- InventoryItemProfileView: 4 tabs (Overview/Stock by Warehouse/Movement History/Audit) with
  paginated movement history via dedicated /api/inventory/stock/movements endpoint.
- WarehouseProfileView: 4 tabs (Overview/Stock Items/Movements/Audit) with paginated movements
  and stock-item table linking back to item profiles.
- All views responsive (375px → 1440px), accessible (semantic tables, ARIA via shadcn), loading
  skeletons, error toasts, permission-gated actions.
- tsc + eslint pass CLEAN on all 3 new inventory files.
- Phase 8 UI: COMPLETED.
