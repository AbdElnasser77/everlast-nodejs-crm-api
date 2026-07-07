const express = require("express");
const multer = require("multer");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const {
  getAllLists,
  createList,
  getListById,
  updateList,
  deleteList,
  addMembers,
  getListMemberIds,
  removeMember,
  validateListImport,
  importListMembers,
} = require("./list.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
});

const router = express.Router();

router.use(protect);

router.get("/", getAllLists);
router.post("/", createList);
router.get("/:id", getListById);
router.put("/:id", updateList);
router.delete("/:id", requireRole("ADMIN"), deleteList);

router.post("/:id/members", addMembers);
router.get("/:id/members/ids", getListMemberIds);
router.delete("/:id/members/:customerId", removeMember);

router.post("/:id/import/validate", upload.single("file"), validateListImport);
router.post("/:id/import", upload.single("file"), importListMembers);

module.exports = router;
