-- CreateEnum
CREATE TYPE "ConsultPhase" AS ENUM ('TRIAGE', 'CONSULT', 'FOLLOWUP', 'FINALIZED');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "blueprint" JSONB;

-- AlterTable
ALTER TABLE "ConsultSession" ADD COLUMN     "followup" JSONB,
ADD COLUMN     "orders" JSONB,
ADD COLUMN     "phase" "ConsultPhase" NOT NULL DEFAULT 'TRIAGE',
ADD COLUMN     "physicalData" JSONB,
ADD COLUMN     "results" JSONB,
ADD COLUMN     "triageData" JSONB;
