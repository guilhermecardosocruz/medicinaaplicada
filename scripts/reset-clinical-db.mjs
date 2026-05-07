import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Limpando banco clínico...");

  await prisma.message.deleteMany({});
  await prisma.consultMemory.deleteMany({});
  await prisma.evaluation.deleteMany({});
  await prisma.consultSession.deleteMany({});
  await prisma.case.deleteMany({});

  console.log("✅ Banco clínico resetado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
