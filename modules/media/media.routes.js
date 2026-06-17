const express = require("express");
const multer = require("multer");
const protect = require("../../middleware/auth");
const { uploadMedia } = require("./media.controller");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/3gpp",
      "audio/aac", "audio/mpeg", "audio/ogg", "audio/opus", "audio/amr",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not supported`));
    }
  },
});

router.use(protect);
router.post("/upload", upload.single("file"), uploadMedia);

module.exports = router;
