const express = require("express");
const protect = require("../../middleware/auth");
const {
  getAllConversations,
  getConversationMessages,
  markConversationRead,
  assignConversation,
  changeConversationStatus,
  createOrGetConversation,
} = require("./conversation.controller");

const router = express.Router();

router.use(protect);

router.get("/", getAllConversations);
router.post("/", createOrGetConversation);
router.get("/:id/messages", getConversationMessages);
router.post("/:id/read", markConversationRead);
router.put("/:id/assign", assignConversation);
router.put("/:id/status", changeConversationStatus);

module.exports = router;
