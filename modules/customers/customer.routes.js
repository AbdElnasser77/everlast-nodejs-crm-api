const express = require("express");
const multer = require("multer");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const { getAllCustomers, getCustomerById, createCustomer, updateCustomer, importCustomers, deleteCustomer, bulkDeleteCustomers } = require("./customer.controller");

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

router.get("/", getAllCustomers);
router.post("/import", requireRole("ADMIN"), upload.single("file"), importCustomers);
router.post("/bulk-delete", requireRole("ADMIN"), bulkDeleteCustomers);
router.get("/:id", getCustomerById);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);
router.delete("/:id", requireRole("ADMIN"), deleteCustomer);

module.exports = router;
