-- Phase 8 asset register
CREATE TABLE "AssetRefCounter" (
  "id" TEXT NOT NULL,
  "prefix" TEXT NOT NULL DEFAULT 'AST',
  "year" INTEGER NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AssetRefCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetRefCounter_prefix_year_key"
ON "AssetRefCounter"("prefix", "year");

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "assetNumber" TEXT NOT NULL,
  "assetTag" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "serialNumber" TEXT,
  "condition" TEXT NOT NULL DEFAULT 'good',
  "status" TEXT NOT NULL DEFAULT 'active',
  "location" TEXT,
  "acquisitionDate" TIMESTAMP(3),
  "acquisitionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currentValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "usefulLifeMonths" INTEGER,
  "depreciationMethod" TEXT NOT NULL DEFAULT 'none',
  "warrantyExpiry" TIMESTAMP(3),
  "custodianId" TEXT,
  "supplierId" TEXT,
  "projectId" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_assetNumber_key" ON "Asset"("assetNumber");
CREATE UNIQUE INDEX "Asset_assetTag_key" ON "Asset"("assetTag");
CREATE INDEX "Asset_category_idx" ON "Asset"("category");
CREATE INDEX "Asset_status_idx" ON "Asset"("status");
CREATE INDEX "Asset_condition_idx" ON "Asset"("condition");
CREATE INDEX "Asset_custodianId_idx" ON "Asset"("custodianId");
CREATE INDEX "Asset_supplierId_idx" ON "Asset"("supplierId");
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");
CREATE INDEX "Asset_acquisitionDate_idx" ON "Asset"("acquisitionDate");
CREATE INDEX "Asset_warrantyExpiry_idx" ON "Asset"("warrantyExpiry");

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_custodianId_fkey"
  FOREIGN KEY ("custodianId") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
