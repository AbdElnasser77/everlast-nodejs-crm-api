const express = require("express");
const protect = require("../../middleware/auth");
const {
  getCampaigns,
  getActiveCampaignProgress,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaignNow,
  cancelCampaign,
  pauseCampaign,
  resumeCampaign,
} = require("./campaign.controller");

const router = express.Router();

router.use(protect);

router.get("/", getCampaigns);
router.post("/", createCampaign);
// Must come before "/:id" — otherwise Express would match "active-progress"
// as an :id param and route it to getCampaign instead.
router.get("/active-progress", getActiveCampaignProgress);
router.get("/:id", getCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
router.post("/:id/send", sendCampaignNow);
router.post("/:id/cancel", cancelCampaign);
router.post("/:id/pause", pauseCampaign);
router.post("/:id/resume", resumeCampaign);

module.exports = router;
