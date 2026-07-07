const express = require("express");
const multer = require("multer");
const protect = require("../../middleware/auth");
const { uploadMedia } = require("./media.controller");
const { MAX_FILE_SIZE, mediaFileFilter } = require("../../utils/mediaHelpers");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: mediaFileFilter,
});

router.use(protect);
router.post("/upload", upload.single("file"), uploadMedia);

module.exports = router;
