const prisma = require("./prisma");

const connectDB = async () => {
  await prisma.$connect();
  console.log("Database connected successfully");
};

module.exports = connectDB;
