require("../config/env");
const prisma = require("../config/prisma");
const bcryptjs = require("bcryptjs");

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "Admin@1234";

const seed = async () => {
  const existing = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  if (existing) {
    console.log("Admin user already exists — skipping seed.");
    await prisma.$disconnect();
    process.exit(0);
  }

  const passwordHash = await bcryptjs.hash(ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: { username: ADMIN_USERNAME, passwordHash, role: "ADMIN" },
  });

  console.log(`Admin user created. Username: ${ADMIN_USERNAME}, Password: ${ADMIN_PASSWORD}`);
  await prisma.$disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  prisma.$disconnect();
  process.exit(1);
});
