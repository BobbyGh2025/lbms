-- Operational control modules
CREATE TABLE "DocumentRefCounter" (
 "id" TEXT NOT NULL, "prefix" TEXT NOT NULL DEFAULT 'DOC', "year" INTEGER NOT NULL,
 "nextNumber" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "DocumentRefCounter_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "DocumentRefCounter_prefix_year_key" ON "DocumentRefCounter"("prefix","year");

CREATE TABLE "Document" (
 "id" TEXT NOT NULL, "documentNumber" TEXT NOT NULL, "title" TEXT NOT NULL, "category" TEXT NOT NULL,
 "description" TEXT, "fileName" TEXT, "mimeType" TEXT, "fileSize" INTEGER, "fileData" BYTEA, "externalUrl" TEXT,
 "entityType" TEXT, "entityId" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "uploadedById" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 "deletedAt" TIMESTAMP(3), CONSTRAINT "Document_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Document_documentNumber_key" ON "Document"("documentNumber");
CREATE INDEX "Document_category_idx" ON "Document"("category");
CREATE INDEX "Document_entityType_entityId_idx" ON "Document"("entityType","entityId");
CREATE INDEX "Document_status_idx" ON "Document"("status");
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");

CREATE TABLE "DecisionRefCounter" (
 "id" TEXT NOT NULL, "prefix" TEXT NOT NULL DEFAULT 'DEC', "year" INTEGER NOT NULL,
 "nextNumber" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "DecisionRefCounter_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "DecisionRefCounter_prefix_year_key" ON "DecisionRefCounter"("prefix","year");
CREATE TABLE "MDDecision" (
 "id" TEXT NOT NULL, "decisionNumber" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
 "priority" TEXT NOT NULL DEFAULT 'medium', "status" TEXT NOT NULL DEFAULT 'draft', "decisionDate" TIMESTAMP(3),
 "dueDate" TIMESTAMP(3), "requestedById" TEXT, "assignedToId" TEXT, "outcome" TEXT, "notes" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 "deletedAt" TIMESTAMP(3), CONSTRAINT "MDDecision_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MDDecision_decisionNumber_key" ON "MDDecision"("decisionNumber");
CREATE INDEX "MDDecision_status_idx" ON "MDDecision"("status");
CREATE INDEX "MDDecision_priority_idx" ON "MDDecision"("priority");
CREATE INDEX "MDDecision_dueDate_idx" ON "MDDecision"("dueDate");
CREATE INDEX "MDDecision_requestedById_idx" ON "MDDecision"("requestedById");
CREATE INDEX "MDDecision_assignedToId_idx" ON "MDDecision"("assignedToId");

CREATE TABLE "ApprovalRefCounter" (
 "id" TEXT NOT NULL, "prefix" TEXT NOT NULL DEFAULT 'APR', "year" INTEGER NOT NULL,
 "nextNumber" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "ApprovalRefCounter_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ApprovalRefCounter_prefix_year_key" ON "ApprovalRefCounter"("prefix","year");
CREATE TABLE "ApprovalRequest" (
 "id" TEXT NOT NULL, "approvalNumber" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
 "entityType" TEXT, "entityId" TEXT, "status" TEXT NOT NULL DEFAULT 'pending', "requestedById" TEXT,
 "approverId" TEXT, "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actedAt" TIMESTAMP(3),
 "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ApprovalRequest_approvalNumber_key" ON "ApprovalRequest"("approvalNumber");
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");
CREATE INDEX "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType","entityId");
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");
CREATE INDEX "ApprovalRequest_approverId_idx" ON "ApprovalRequest"("approverId");

CREATE TABLE "PipelineRefCounter" (
 "id" TEXT NOT NULL, "prefix" TEXT NOT NULL DEFAULT 'OPP', "year" INTEGER NOT NULL,
 "nextNumber" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "PipelineRefCounter_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "PipelineRefCounter_prefix_year_key" ON "PipelineRefCounter"("prefix","year");
CREATE TABLE "PipelineOpportunity" (
 "id" TEXT NOT NULL, "opportunityNumber" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
 "customerId" TEXT, "stage" TEXT NOT NULL DEFAULT 'lead', "probability" INTEGER NOT NULL DEFAULT 10,
 "value" DECIMAL(18,2) NOT NULL DEFAULT 0, "currency" TEXT NOT NULL DEFAULT 'GHS',
 "expectedCloseDate" TIMESTAMP(3), "ownerId" TEXT, "source" TEXT, "notes" TEXT, "createdById" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 "deletedAt" TIMESTAMP(3), CONSTRAINT "PipelineOpportunity_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "PipelineOpportunity_opportunityNumber_key" ON "PipelineOpportunity"("opportunityNumber");
CREATE INDEX "PipelineOpportunity_stage_idx" ON "PipelineOpportunity"("stage");
CREATE INDEX "PipelineOpportunity_customerId_idx" ON "PipelineOpportunity"("customerId");
CREATE INDEX "PipelineOpportunity_ownerId_idx" ON "PipelineOpportunity"("ownerId");
CREATE INDEX "PipelineOpportunity_expectedCloseDate_idx" ON "PipelineOpportunity"("expectedCloseDate");
