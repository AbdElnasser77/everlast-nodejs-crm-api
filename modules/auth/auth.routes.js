const express = require("express");
const protect = require("../../middleware/auth");
const { login, logout } = require("./auth.controller");

const router = express.Router();

router.post("/login", login);
router.post("/logout", protect, logout);

module.exports = router;
