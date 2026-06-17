const express = require("express");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const { getAuditLogs } = require("./audit.controller");

const router = express.Router();

router.use(protect, requireRole("ADMIN"));

router.get("/", getAuditLogs);

module.exports = router;
