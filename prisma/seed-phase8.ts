// Phase 8 focused seed: inventory permissions + test data.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Phase 8 focused seed — inventory permissions + test data\n");

  // 1. Ensure inventory permissions exist
  const inventoryActions = ["view", "create", "edit", "issue", "receive", "transfer", "adjust", "export"];
  for (const action of inventoryActions) {
    await prisma.permission.upsert({
      where: { module_action: { module: "inventory", action } },
      update: {},
      create: { module: "inventory", action, description: `Inventory: ${action}` },
    });
  }
  console.log(`  ✓ ${inventoryActions.length} inventory permissions ensured`);

  // 2. Assign inventory permissions to roles
  const ROLE_POLICIES: Record<string, string[]> = {
    md: inventoryActions,
    administrator: ["view", "create", "edit", "issue", "receive", "transfer", "adjust", "export"],
    finance_manager: ["view", "export"],
    operations_manager: ["view", "create", "edit", "issue", "receive", "transfer", "adjust", "export"],
    hr_manager: [],
    project_manager: ["view", "create", "edit", "issue", "receive"],
    employee: ["view"],
  };

  for (const [roleName, actions] of Object.entries(ROLE_POLICIES)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of actions) {
      const perm = await prisma.permission.findUnique({
        where: { module_action: { module: "inventory", action } },
      });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(`  ✓ Inventory permissions assigned to roles`);

  // 3. Test data — skip if already exists
  const existingItems = await prisma.inventoryItem.count();
  if (existingItems > 0) {
    console.log(`  ✓ Inventory test data already exists (${existingItems} items) — skipping`);
    console.log("\n✅ Phase 8 focused seed complete.");
    return;
  }

  const mdUser = await prisma.user.findFirst({
    where: { userRoles: { some: { role: { name: "md" } } } },
  });
  if (!mdUser) throw new Error("MD user not found");

  // 3a. Inventory categories
  const categories = [
    { name: "Building Materials", description: "Cement, sand, blocks, etc." },
    { name: "Electrical", description: "Cables, fittings, distribution boards" },
    { name: "IT Equipment", description: "Laptops, monitors, network gear" },
    { name: "Office Supplies", description: "Stationery, consumables" },
  ];
  const catMap: Record<string, string> = {};
  for (const c of categories) {
    const cat = await prisma.inventoryCategory.create({
      data: { name: c.name, description: c.description, createdById: mdUser.id },
    });
    catMap[c.name] = cat.id;
  }
  console.log(`  ✓ ${categories.length} inventory categories ensured`);

  // 3b. Warehouses
  const warehouses = [
    { code: "WH-MAIN", name: "Main Warehouse", location: "Accra HQ", active: true },
    { code: "WH-BRANCH-01", name: "Branch Warehouse Tema", location: "Tema", active: true },
    { code: "WH-SITE-01", name: "Site Store Solar Project", location: "Solar Project Site", active: true },
  ];
  const whMap: Record<string, string> = {};
  for (const w of warehouses) {
    const wh = await prisma.warehouse.create({
      data: { ...w, createdById: mdUser.id },
    });
    whMap[w.code] = wh.id;
  }
  console.log(`  ✓ ${warehouses.length} warehouses ensured`);

  // 3c. Inventory items
  const items = [
    { code: "CEM-50KG", name: "Cement 50kg Bag", category: "Building Materials", uom: "bag", reorderLevel: 50, reorderQuantity: 200 },
    { code: "SAND-CM", name: "Sand (cubic metre)", category: "Building Materials", uom: "cubic_metre", reorderLevel: 5, reorderQuantity: 20 },
    { code: "CAB-2.5MM", name: "Electrical Cable 2.5mm (per metre)", category: "Electrical", uom: "metre", reorderLevel: 100, reorderQuantity: 500 },
    { code: "DB-63A", name: "Distribution Board 63A", category: "Electrical", uom: "unit", reorderLevel: 5, reorderQuantity: 20 },
    { code: "LAP-5540", name: "Dell Latitude 5540 Laptop", category: "IT Equipment", uom: "unit", reorderLevel: 2, reorderQuantity: 10 },
    { code: "MON-27", name: 'Dell 27" Monitor', category: "IT Equipment", uom: "unit", reorderLevel: 2, reorderQuantity: 10 },
    { code: "PAP-A4", name: "A4 Paper Ream", category: "Office Supplies", uom: "ream", reorderLevel: 20, reorderQuantity: 100 },
  ];
  const itemMap: Record<string, string> = {};
  for (const it of items) {
    const item = await prisma.inventoryItem.create({
      data: {
        itemCode: it.code,
        name: it.name,
        categoryId: catMap[it.category] || null,
        unitOfMeasure: it.uom,
        reorderLevel: it.reorderLevel,
        reorderQuantity: it.reorderQuantity,
        active: true,
        createdById: mdUser.id,
      },
    });
    itemMap[it.code] = item.id;
  }
  console.log(`  ✓ ${items.length} inventory items ensured`);

  // 3d. Seed some stock via direct balance + receipt movements (bypassing
  // procurement to give the warehouse starting stock). We'll use SRI numbers.
  const year = new Date().getFullYear();
  const seedStock = [
    { itemCode: "CEM-50KG", warehouse: "WH-MAIN", qty: 150 },
    { itemCode: "CEM-50KG", warehouse: "WH-BRANCH-01", qty: 40 },
    { itemCode: "CAB-2.5MM", warehouse: "WH-MAIN", qty: 800 },
    { itemCode: "DB-63A", warehouse: "WH-MAIN", qty: 8 },
    { itemCode: "LAP-5540", warehouse: "WH-MAIN", qty: 3 },
    { itemCode: "PAP-A4", warehouse: "WH-MAIN", qty: 60 },
  ];
  let sriNum = 0;
  for (const s of seedStock) {
    sriNum++;
    const itemId = itemMap[s.itemCode];
    const whId = whMap[s.warehouse];
    // Create stock balance
    await prisma.stockBalance.create({
      data: { inventoryItemId: itemId, warehouseId: whId, quantity: s.qty },
    });
    // Create a receipt movement (opening stock)
    const counter = await prisma.inventoryRefCounter.upsert({
      where: { prefix_year: { prefix: "SRI", year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix: "SRI", year, nextNumber: 2 },
    });
    const num = `SRI-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
    await prisma.stockMovement.create({
      data: {
        movementNumber: num,
        inventoryItemId: itemId,
        warehouseId: whId,
        quantity: s.qty,
        movementType: "RECEIPT",
        referenceType: "opening_stock",
        referenceId: `opening-${itemId}-${whId}`,
        reason: "Opening stock (seed)",
        performedById: mdUser.id,
      },
    });
  }
  console.log(`  ✓ ${seedStock.length} stock balances + opening receipts ensured`);

  // 3e. Audit log
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "inventory",
      recordType: "seed",
      description: "LBMS Phase 8 inventory & warehouse management seeded.",
      newValue: JSON.stringify({ phase: 8, categories: categories.length, warehouses: warehouses.length, items: items.length, stockEntries: seedStock.length, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Phase 8 inventory audit log entry created`);

  console.log("\n✅ Phase 8 focused seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
