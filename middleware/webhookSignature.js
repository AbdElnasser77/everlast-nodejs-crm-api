const crypto = require("crypto");
const AppError = require("../utils/AppError");

const verifyWebhookSignature = (req, res, next) => {
  if (!process.env.WHATSAPP_APP_SECRET) {
    return next(new AppError("WHATSAPP_APP_SECRET is not configured — webhook rejected", 500));
  }

  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return next(new AppError("Missing webhook signature", 401));

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return next(new AppError("Invalid webhook signature", 401));
  }

  next();
};

module.exports = verifyWebhookSignature;
