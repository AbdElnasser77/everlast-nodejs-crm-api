const express = require("express");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitForApproval,
  syncApprovalStatus,
  sendTemplate,
} = require("./template.controller");

const router = express.Router();

router.get("/", protect, getTemplates);
router.post("/sync", protect, requireRole("ADMIN"), syncApprovalStatus);
router.post("/", protect, requireRole("ADMIN"), createTemplate);
router.put("/:id", protect, requireRole("ADMIN"), updateTemplate);
router.delete("/:id", protect, requireRole("ADMIN"), deleteTemplate);
router.post("/:id/submit", protect, requireRole("ADMIN"), submitForApproval);

// Send a template in a conversation — :id is conversationId
router.post("/conversations/:id/send-template", protect, sendTemplate);

module.exports = router;
