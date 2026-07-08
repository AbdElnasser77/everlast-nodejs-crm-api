const express = require("express");
const protect = require("../../middleware/auth");
const { sendMessage, searchMessages, getMessageMedia, deleteMessage } = require("./message.controller");

const router = express.Router();

router.use(protect);

router.get("/search", searchMessages);
router.post("/send", sendMessage);
router.get("/:id/media", getMessageMedia);
router.delete("/:id", deleteMessage);

module.exports = router;
