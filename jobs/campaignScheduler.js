const cron = require("node-cron");
const prisma = require("../config/prisma");
const { processCampaign } = require("../modules/campaigns/campaign.controller");

function startCampaignScheduler() {
  // Recover campaigns left in RUNNING by a crash/restart. processCampaign only
  // sends to recipients still marked PENDING, so resuming is safe and idempotent.
  // NOTE: assumes a single server instance (as does node-cron below).
  (async () => {
    try {
      const stuck = await prisma.campaign.findMany({
        where: { status: "RUNNING" },
        select: { id: true },
      });
      for (const c of stuck) {
        console.log(`[Scheduler] Resuming interrupted campaign ${c.id}`);
        processCampaign(c.id).catch((err) =>
          console.error(`[Scheduler] Resume of campaign ${c.id} failed:`, err.message)
        );
      }
    } catch (err) {
      console.error("[Scheduler] Failed to recover running campaigns:", err.message);
    }
  })();

  cron.schedule("* * * * *", async () => {
    try {
      const due = await prisma.campaign.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
        select: { id: true },
      });

      for (const c of due) {
        await prisma.campaign.update({
          where: { id: c.id },
          data: { status: "RUNNING", startedAt: new Date() },
        });
        processCampaign(c.id).catch((err) =>
          console.error(`[Scheduler] Campaign ${c.id} failed:`, err.message)
        );
      }
    } catch (err) {
      console.error("[Scheduler] Error checking scheduled campaigns:", err.message);
    }
  });

  console.log("[Scheduler] Campaign scheduler started");
}

module.exports = { startCampaignScheduler };
