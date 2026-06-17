const express = require("express");
const protect = require("../../middleware/auth");
const requireRole = require("../../middleware/roles");
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  getMe,
  updateMyStatus,
  changeMyPassword,
} = require("./user.controller");

const router = express.Router();

router.use(protect);

// Self-service (any logged-in user)
router.get("/me", getMe);
router.put("/me/status", updateMyStatus);
router.put("/me/password", changeMyPassword);

// Admin only
router.get("/", requireRole("ADMIN"), getAllUsers);
router.post("/", requireRole("ADMIN"), createUser);
router.get("/:id", requireRole("ADMIN"), getUserById);
router.put("/:id", requireRole("ADMIN"), updateUser);
router.put("/:id/password", requireRole("ADMIN"), resetPassword);
router.delete("/:id", requireRole("ADMIN"), deleteUser);

module.exports = router;
