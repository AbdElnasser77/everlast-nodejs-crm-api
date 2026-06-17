const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });

const required = ["DATABASE_URL", "JWT_SECRET", "PORT"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
