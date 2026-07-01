const { Prisma } = require("@prisma/client");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");
const { sendWhatsAppMessage } = require("../../utils/whatsappClient");
const { getIO } = require("../../utils/socket");
const { buildTemplateParams, resolveNamedVars } = require("../../utils/templateVars");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Exported for scheduler ──────────────────────────────────────────────────

async function processCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: true,
      recipients: {
        where: { status: "PENDING" },
        include: { customer: true },
      },
    },
  });
  if (!campaign) return;

  getIO().emit("campaign.started", { campaignId });

  for (const recipient of campaign.recipients) {
    // Stop immediately if the campaign was cancelled mid-run. Without this the
    // loop would keep sending and then overwrite CANCELLED with COMPLETED.
    const current = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!current || current.status === "CANCELLED") {
      console.log(`[Campaign ${campaignId}] Cancelled — stopping send loop`);
      getIO().emit("campaign.cancelled", { campaignId });
      return;
    }

    try {
      if (recipient.customer.optedOut) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "SKIPPED" },
        });
        continue;
      }

      // Get or create conversation
      let conversation = await prisma.conversation.findUnique({
        where: { customerId: recipient.customerId },
        include: { assignedAgent: { select: { id: true, name: true, username: true } } },
      });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { customerId: recipient.customerId, status: "OPEN", unreadCount: 0 },
          include: { assignedAgent: { select: { id: true, name: true, username: true } } },
        });
        getIO().emit("conversation.created", { conversationId: conversation.id });
      }

      const template = campaign.template;
      const customer = recipient.customer;

      const resolvedBody = resolveNamedVars(template.body, customer, null);
      const resolvedHeader = template.header ? resolveNamedVars(template.header, customer, null) : null;
      const hasButtons = template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0;
      const needsMetaTemplate = template.category !== "GENERAL" && template.approvalStatus === "APPROVED" && !!template.metaTemplateName;
      const messageType = needsMetaTemplate ? "TEMPLATE" : (hasButtons ? "INTERACTIVE" : "TEXT");

      const templateContent = JSON.stringify({
        header: resolvedHeader || undefined,
        body: resolvedBody,
        footer: template.footer || undefined,
        buttons: hasButtons ? template.buttons : undefined,
      });

      // Positional params matching the submitted Meta template (order of appearance).
      const templateVariables = buildTemplateParams(template.body, customer, null);

      let message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: "AGENT",
          senderId: null,
          content: templateContent,
          messageType: "INTERACTIVE",
          status: "PENDING",
        },
      });

      try {
        const { whatsappMessageId } = await sendWhatsAppMessage({
          to: customer.phone,
          content: resolvedBody,
          messageType,
          buttons: hasButtons ? template.buttons : null,
          header: resolvedHeader,
          footer: template.footer || null,
          templateName: template.metaTemplateName,
          language: template.language,
          templateVariables,
        });
        message = await prisma.message.update({
          where: { id: message.id },
          data: { whatsappMessageId, status: "SENT" },
        });
      } catch (waErr) {
        console.error(`[Campaign ${campaignId}] WhatsApp send failed for customer ${customer.id}:`, waErr.response?.data || waErr.message);
        await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED" } });
        throw waErr;
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: resolvedBody, lastMessageAt: new Date(), lastSenderType: "AGENT" },
      });

      getIO().emit("message.created", { message, conversationId: conversation.id });
      getIO().emit("conversation.updated", { conversationId: conversation.id });

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", messageId: message.id, sentAt: new Date() },
      });
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sentCount: { increment: 1 } },
      });
    } catch (err) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: err.message },
      });
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 } },
      });
    }

    const updated = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { sentCount: true, failedCount: true, totalRecipients: true },
    });
    getIO().emit("campaign.progress", { campaignId, ...updated });

    await sleep(400);
  }

  // Only mark COMPLETED if still RUNNING — a cancel that landed after the last
  // iteration's check must not be overwritten.
  const finished = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "RUNNING" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (finished.count > 0) {
    getIO().emit("campaign.completed", { campaignId });
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

const getCampaigns = async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { id: true, name: true, category: true } },
        _count: { select: { recipients: true } },
      },
    });

    if (campaigns.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const campaignIds = campaigns.map((c) => c.id);

    // Single query for delivered + read counts across all campaigns
    const deliveredRaw = await prisma.$queryRaw`
      SELECT cr."campaignId",
        COUNT(CASE WHEN m.status IN ('DELIVERED', 'READ') THEN 1 END)::int AS delivered,
        COUNT(CASE WHEN m.status = 'READ' THEN 1 END)::int AS read_count
      FROM "CampaignRecipient" cr
      JOIN "Message" m ON m.id = cr."messageId"
      WHERE cr."campaignId" IN (${Prisma.join(campaignIds)})
      GROUP BY cr."campaignId"
    `;

    // Single query for replied counts for campaigns that have started
    const repliedRaw = await prisma.$queryRaw`
      SELECT cr."campaignId", COUNT(DISTINCT cr."customerId")::int AS replied
      FROM "CampaignRecipient" cr
      JOIN "Campaign" cam ON cam.id = cr."campaignId"
      JOIN "Conversation" conv ON conv."customerId" = cr."customerId"
      WHERE cr."campaignId" IN (${Prisma.join(campaignIds)})
        AND cam."startedAt" IS NOT NULL
        AND conv."lastSenderType" = 'CUSTOMER'
        AND conv."lastCustomerMessageAt" > cam."startedAt"
      GROUP BY cr."campaignId"
    `;

    const deliveredMap = {};
    deliveredRaw.forEach((r) => { deliveredMap[r.campaignId] = r; });

    const repliedMap = {};
    repliedRaw.forEach((r) => { repliedMap[r.campaignId] = Number(r.replied); });

    const enriched = campaigns.map((c) => ({
      ...c,
      deliveredCount: Number(deliveredMap[c.id]?.delivered || 0),
      readCount: Number(deliveredMap[c.id]?.read_count || 0),
      repliedCount: repliedMap[c.id] || 0,
    }));

    res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
};

const getCampaign = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        template: true,
        recipients: {
          include: { customer: { select: { id: true, name: true, phone: true, tags: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!campaign) return next(new AppError("Campaign not found", 404));
    res.status(200).json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
};

const createCampaign = async (req, res, next) => {
  try {
    const { name, templateId, recipientIds, scheduledAt } = req.body;
    if (!name) return next(new AppError("name is required", 400));
    if (!templateId) return next(new AppError("templateId is required", 400));
    const ids = Array.isArray(recipientIds) ? recipientIds : [];

    const template = await prisma.template.findUnique({ where: { id: parseInt(templateId) } });
    if (!template || !template.isActive) return next(new AppError("Template not found", 404));
    if (template.approvalStatus !== "APPROVED") return next(new AppError("Template must be APPROVED before creating a campaign", 400));

    // Only enforce recipients when actually sending/scheduling
    if (scheduledAt && ids.length === 0) {
      return next(new AppError("recipientIds are required when scheduling a campaign", 400));
    }

    const status = scheduledAt ? "SCHEDULED" : "DRAFT";

    const campaign = await prisma.campaign.create({
      data: {
        name,
        templateId: parseInt(templateId),
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        totalRecipients: ids.length,
        createdById: req.user.id,
        recipients: {
          create: ids.map((cid) => ({ customerId: parseInt(cid) })),
        },
      },
      include: {
        template: { select: { id: true, name: true, category: true } },
      },
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
};

const updateCampaign = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) return next(new AppError("Campaign not found", 404));
    if (existing.status !== "DRAFT") return next(new AppError("Only DRAFT campaigns can be updated", 400));

    const { name, templateId, recipientIds, scheduledAt } = req.body;

    const data = {};
    if (name) data.name = name;
    if (templateId) data.templateId = parseInt(templateId);
    if (scheduledAt !== undefined) data.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledAt) data.status = "SCHEDULED";

    if (recipientIds && Array.isArray(recipientIds)) {
      await prisma.campaignRecipient.deleteMany({ where: { campaignId: id } });
      data.totalRecipients = recipientIds.length;
      data.recipients = { create: recipientIds.map((cid) => ({ customerId: parseInt(cid) })) };
    }

    const campaign = await prisma.campaign.update({
      where: { id },
      data,
      include: { template: { select: { id: true, name: true, category: true } } },
    });

    res.status(200).json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
};

const deleteCampaign = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) return next(new AppError("Campaign not found", 404));
    if (existing.status !== "DRAFT") return next(new AppError("Only DRAFT campaigns can be deleted", 400));

    await prisma.campaign.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Campaign deleted" });
  } catch (err) {
    next(err);
  }
};

const sendCampaignNow = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return next(new AppError("Campaign not found", 404));
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      return next(new AppError("Campaign cannot be sent in its current state", 400));
    }
    if (campaign.totalRecipients === 0) {
      return next(new AppError("Campaign has no recipients", 400));
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    // Fire-and-forget
    processCampaign(id).catch((err) => console.error(`[Campaign ${id}] Fatal error:`, err.message));

    res.status(200).json({ success: true, message: "Campaign send started" });
  } catch (err) {
    next(err);
  }
};

const cancelCampaign = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return next(new AppError("Campaign not found", 404));
    if (campaign.status !== "SCHEDULED" && campaign.status !== "RUNNING") {
      return next(new AppError("Only SCHEDULED or RUNNING campaigns can be cancelled", 400));
    }

    await prisma.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
    getIO().emit("campaign.cancelled", { campaignId: id });

    res.status(200).json({ success: true, message: "Campaign cancelled" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaignNow,
  cancelCampaign,
  processCampaign,
};
