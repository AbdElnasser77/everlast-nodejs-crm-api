require("../config/env");
const prisma = require("../config/prisma");

prisma.template.updateMany({
  where: { name: { startsWith: "[TEST]" } },
  data: { approvalStatus: "APPROVED" },
}).then((r) => {
  console.log("Updated:", r.count, "templates → APPROVED");
  prisma.$disconnect();
});
