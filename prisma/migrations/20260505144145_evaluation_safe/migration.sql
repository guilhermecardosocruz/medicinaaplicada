-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "anamnesis" INTEGER,
ADD COLUMN     "closing" INTEGER,
ADD COLUMN     "communication" INTEGER,
ADD COLUMN     "correctDiagnosis" TEXT,
ADD COLUMN     "diagnosisCorrect" BOOLEAN,
ADD COLUMN     "exams" INTEGER,
ADD COLUMN     "organization" INTEGER,
ADD COLUMN     "reasoning" INTEGER,
ADD COLUMN     "safety" INTEGER,
ADD COLUMN     "studentDiagnosis" TEXT;
