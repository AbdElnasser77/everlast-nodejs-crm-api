const crypto = require("crypto");
const AppError = require("../utils/AppError");

const verifyWebhookSignature = (req, res, next) => {
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.warn("WHATSAPP_APP_SECRET not set — skipping signature verification (dev mode)");
    return next();
  }

  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return next(new AppError("Missing webhook signature", 401));

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  if (sig !== expected) return next(new AppError("Invalid webhook signature", 401));
  next();
};

module.exports = verifyWebhookSignature;
