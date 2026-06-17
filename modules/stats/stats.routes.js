const express = require("express");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const {
  getOverview,
  getMessageStats,
  getConversationStats,
  getAgentStats,
  getCustomerStats,
} = require("./stats.controller");

const router = express.Router();

router.use(protect, requireRole("ADMIN"));

router.get("/overview", getOverview);
router.get("/messages", getMessageStats);
router.get("/conversations", getConversationStats);
router.get("/agents", getAgentStats);
router.get("/customers", getCustomerStats);

module.exports = router;
