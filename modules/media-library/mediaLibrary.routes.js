const express = require("express");
const multer = require("multer");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const { getAllMedia, uploadMedia, updateMedia, deleteMedia } = require("./mediaLibrary.controller");
const { MAX_FILE_SIZE, mediaFileFilter } = require("../../utils/mediaHelpers");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: mediaFileFilter,
});

const router = express.Router();

router.use(protect);

router.get("/", getAllMedia);
router.post("/", requireRole("ADMIN"), upload.single("file"), uploadMedia);
router.put("/:id", requireRole("ADMIN"), updateMedia);
router.delete("/:id", requireRole("ADMIN"), deleteMedia);

module.exports = router;
