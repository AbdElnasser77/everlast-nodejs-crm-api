const express = require("express");
const protect = require("../../middleware/auth");
const {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaignNow,
  cancelCampaign,
} = require("./campaign.controller");

const router = express.Router();

router.use(protect);

router.get("/", getCampaigns);
router.post("/", createCampaign);
router.get("/:id", getCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
router.post("/:id/send", sendCampaignNow);
router.post("/:id/cancel", cancelCampaign);

module.exports = router;
