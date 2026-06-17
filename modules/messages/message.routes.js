const express = require("express");
const protect = require("../../middleware/auth");
const { sendMessage, searchMessages, getMessageMedia } = require("./message.controller");

const router = express.Router();

router.use(protect);

router.get("/search", searchMessages);
router.post("/send", sendMessage);
router.get("/:id/media", getMessageMedia);

module.exports = router;
