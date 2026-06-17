const express = require("express");
const verifyWebhookSignature = require("../../middleware/webhookSignature");
const { verifyWebhook, receiveWhatsAppMessage } = require("./webhook.controller");

const router = express.Router();

router.get("/whatsapp/messages", verifyWebhook);
router.post("/whatsapp/messages", (req, res, next) => {
  console.log("=== WEBHOOK HIT ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
}, verifyWebhookSignature, receiveWhatsAppMessage);

module.exports = router;
