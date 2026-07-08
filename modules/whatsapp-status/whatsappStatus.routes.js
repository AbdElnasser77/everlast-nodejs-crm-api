const express = require("express");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const { getPhoneNumberStatus, getAllPhoneNumbers } = require("./whatsappStatus.controller");

const router = express.Router();

router.use(protect);

router.get("/status", requireRole("ADMIN"), getPhoneNumberStatus);
router.get("/numbers", requireRole("ADMIN"), getAllPhoneNumbers);

module.exports = router;
