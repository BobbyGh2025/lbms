-- Add journal correction metadata
ALTER TABLE "Journal"
ADD COLUMN "correctedFromId" TEXT,
ADD COLUMN "correctionReason" TEXT;

-- Ensure one correction journal can reference a source journal only once
CREATE UNIQUE INDEX "Journal_correctedFromId_key"
ON "Journal"("correctedFromId");

-- Link correction journals back to the original journal
ALTER TABLE "Journal"
ADD CONSTRAINT "Journal_correctedFromId_fkey"
FOREIGN KEY ("correctedFromId")
REFERENCES "Journal"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
