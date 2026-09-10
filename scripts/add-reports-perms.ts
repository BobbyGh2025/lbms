import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Ensure reports permissions exist
  for (const action of ["view", "export"]) {
    await prisma.permission.upsert({
      where: { module_action: { module: "reports", action } },
      update: {},
      create: { module: "reports", action, description: `Reports: ${action}` },
    });
  }
  // Assign reports:view + reports:export to administrator, operations_manager, hr_manager, project_manager
  for (const roleName of ["administrator", "operations_manager", "hr_manager", "project_manager"]) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of ["view", "export"]) {
      const perm = await prisma.permission.findUnique({ where: { module_action: { module: "reports", action } } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log("✓ Reports permissions assigned to administrator, operations_manager, hr_manager, project_manager");
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
