const express = require("express");
const verifyWebhookSignature = require("../../middleware/webhookSignature");
const { verifyWebhook, receiveWhatsAppMessage } = require("./webhook.controller");

const router = express.Router();

router.get("/whatsapp/messages", verifyWebhook);
// Do NOT log raw headers/body here — the payload contains customer PII (message
// content, phone numbers). Signature verification runs before the handler.
router.post("/whatsapp/messages", verifyWebhookSignature, receiveWhatsAppMessage);

module.exports = router;
