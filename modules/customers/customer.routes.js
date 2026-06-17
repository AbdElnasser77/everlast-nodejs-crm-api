const express = require("express");
const protect = require("../../middleware/auth");
const { getAllCustomers, getCustomerById, createCustomer, updateCustomer } = require("./customer.controller");

const router = express.Router();

router.use(protect);

router.get("/", getAllCustomers);
router.get("/:id", getCustomerById);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);

module.exports = router;
