const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });

const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "PORT",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const recommended = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "WHATSAPP_WABA_ID"];
for (const key of recommended) {
  if (!process.env[key]) {
    console.warn(`[Config] Warning: ${key} is not set — some features will be unavailable`);
  }
}

// Expose API version so all modules use the same one
process.env.WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0";
