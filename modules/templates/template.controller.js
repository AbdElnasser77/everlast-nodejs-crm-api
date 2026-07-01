const axios = require("axios");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");
const { sendWhatsAppMessage } = require("../../utils/whatsappClient");
const { getIO } = require("../../utils/socket");
const { toMetaPositionalBody, buildTemplateParams, resolveNamedVars } = require("../../utils/templateVars");

const VALID_CATEGORIES = ["GENERAL", "RE_ENGAGEMENT", "CAMPAIGN"];
const VALID_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const getApiVersion = () => process.env.WHATSAPP_API_VERSION || "v19.0";

const validateButtons = (buttons) => {
  if (!buttons) return null;
  if (!Array.isArray(buttons)) throw new AppError("buttons must be an array", 400);
  if (buttons.length > 3) throw new AppError("Maximum 3 buttons allowed", 400);
  for (const b of buttons) {
    if (!b.id || !b.title) throw new AppError("Each button must have id and title", 400);
    if (b.title.length > 20) throw new AppError(`Button title "${b.title}" exceeds 20 characters`, 400);
  }
  return buttons;
};

const toMetaName = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const getTemplates = async (req, res, next) => {
  try {
    const where = { isActive: true };
    if (req.query.category) {
      if (!VALID_CATEGORIES.includes(req.query.category)) {
        return next(new AppError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`, 400));
      }
      where.category = req.query.category;
    }
    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400));
      }
      where.approvalStatus = req.query.status;
    }

    const templates = await prisma.template.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
};

const createTemplate = async (req, res, next) => {
  try {
    const { name, category, language, header, body, footer, buttons } = req.body;
    if (!name) return next(new AppError("name is required", 400));
    if (!body) return next(new AppError("body is required", 400));
    if (category && !VALID_CATEGORIES.includes(category)) {
      return next(new AppError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`, 400));
    }

    const validatedButtons = validateButtons(buttons);

    const template = await prisma.template.create({
      data: {
        name,
        category: category || "GENERAL",
        language: language || "en_US",
        header: header || null,
        body,
        footer: footer || null,
        buttons: validatedButtons,
      },
    });

    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
};

const updateTemplate = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing || !existing.isActive) return next(new AppError("Template not found", 404));

    if (existing.approvalStatus === "SUBMITTED" || existing.approvalStatus === "APPROVED") {
      return next(new AppError("Cannot edit a SUBMITTED or APPROVED template", 400));
    }

    const { name, category, language, header, body, footer, buttons } = req.body;
    if (category && !VALID_CATEGORIES.includes(category)) {
      return next(new AppError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`, 400));
    }

    const validatedButtons = buttons !== undefined ? validateButtons(buttons) : existing.buttons;

    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(category && { category }),
        ...(language && { language }),
        header: header !== undefined ? header : existing.header,
        ...(body && { body }),
        footer: footer !== undefined ? footer : existing.footer,
        buttons: validatedButtons,
        approvalStatus: "DRAFT",
        rejectionReason: null,
      },
    });

    res.status(200).json({ success: true, data: template });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Template not found", 404));
    next(err);
  }
};

const deleteTemplate = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing || !existing.isActive) return next(new AppError("Template not found", 404));

    await prisma.template.update({ where: { id }, data: { isActive: false } });

    res.status(200).json({ success: true, message: "Template deleted" });
  } catch (err) {
    next(err);
  }
};

const submitForApproval = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template || !template.isActive) return next(new AppError("Template not found", 404));

    if (template.approvalStatus !== "DRAFT" && template.approvalStatus !== "REJECTED") {
      return next(new AppError("Only DRAFT or REJECTED templates can be submitted", 400));
    }

    const wabaId = process.env.WHATSAPP_WABA_ID;
    if (!wabaId) return next(new AppError("WHATSAPP_WABA_ID is not configured", 500));

    const metaName = template.metaTemplateName || toMetaName(template.name);

    // Build Meta components
    const components = [];
    if (template.header) {
      components.push({ type: "HEADER", format: "TEXT", text: template.header });
    }

    // Convert named placeholders to Meta positional {{1}},{{2}} (by order of
    // appearance) and attach example values so Meta can validate on submit.
    const metaBody = toMetaPositionalBody(template.body);
    const bodyComponent = { type: "BODY", text: metaBody };
    const sampleParams = buildTemplateParams(template.body, { name: "Sarah Ahmed" }, { name: "Alex" });
    if (sampleParams.length > 0) {
      bodyComponent.example = { body_text: [sampleParams] };
    }
    components.push(bodyComponent);

    if (template.footer) {
      components.push({ type: "FOOTER", text: template.footer });
    }

    if (template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0) {
      components.push({
        type: "BUTTONS",
        buttons: template.buttons.map((b) => ({ type: "QUICK_REPLY", text: b.title })),
      });
    }

    let metaRes;
    try {
      metaRes = await axios.post(
        `https://graph.facebook.com/${getApiVersion()}/${wabaId}/message_templates`,
        {
          name: metaName,
          language: template.language,
          category: "MARKETING",
          components,
        },
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } },
      );
    } catch (metaErr) {
      const detail = metaErr.response?.data || metaErr.message;
      console.error("Meta template submission failed:", JSON.stringify(detail));
      return next(new AppError("Failed to submit template to Meta", 502));
    }

    const updated = await prisma.template.update({
      where: { id },
      data: {
        approvalStatus: "SUBMITTED",
        metaTemplateName: metaName,
        metaTemplateId: String(metaRes.data?.id || ""),
        rejectionReason: null,
      },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const syncApprovalStatus = async (req, res, next) => {
  try {
    const submitted = await prisma.template.findMany({
      where: { approvalStatus: "SUBMITTED", isActive: true },
    });

    if (submitted.length === 0) {
      return res.status(200).json({ success: true, message: "No submitted templates to sync", updated: 0 });
    }

    let approved = 0;
    let rejected = 0;

    await Promise.all(
      submitted.map(async (t) => {
        if (!t.metaTemplateId) return;
        try {
          const metaRes = await axios.get(
            `https://graph.facebook.com/${getApiVersion()}/${t.metaTemplateId}`,
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } },
          );
          const status = metaRes.data?.status;
          if (status === "APPROVED") {
            await prisma.template.update({ where: { id: t.id }, data: { approvalStatus: "APPROVED" } });
            approved++;
          } else if (status === "REJECTED") {
            const reason = metaRes.data?.rejected_reason || null;
            await prisma.template.update({
              where: { id: t.id },
              data: { approvalStatus: "REJECTED", rejectionReason: reason },
            });
            rejected++;
          }
        } catch (err) {
          console.error(`Sync failed for template ${t.id}:`, err.message);
        }
      }),
    );

    res.status(200).json({ success: true, updated: approved + rejected, approved, rejected });
  } catch (err) {
    next(err);
  }
};

const sendTemplate = async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id);
    const { templateId } = req.body;
    if (!templateId) return next(new AppError("templateId is required", 400));

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        assignedAgent: { select: { id: true, name: true, username: true } },
      },
    });
    if (!conversation) return next(new AppError("Conversation not found", 404));

    const template = await prisma.template.findUnique({ where: { id: parseInt(templateId) } });
    if (!template || !template.isActive) return next(new AppError("Template not found", 404));

    // RE_ENGAGEMENT and CAMPAIGN require APPROVED status
    if (template.category !== "GENERAL" && template.approvalStatus !== "APPROVED") {
      return next(new AppError(`${template.category} templates must be APPROVED before sending`, 400));
    }

    // 24h window check for RE_ENGAGEMENT
    if (template.category === "RE_ENGAGEMENT") {
      if (!conversation.lastCustomerMessageAt) {
        return next(new AppError("No customer message found in this conversation", 400));
      }
      const elapsed = Date.now() - new Date(conversation.lastCustomerMessageAt).getTime();
      if (elapsed < WINDOW_MS) {
        return next(new AppError("24-hour window is still open — send a regular message instead", 400));
      }
    }

    const resolvedBody = resolveNamedVars(template.body, conversation.customer, req.user);
    const hasButtons = template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0;
    // Only RE_ENGAGEMENT and CAMPAIGN with a valid metaTemplateName use Meta's template format
    // GENERAL templates always send as regular text/interactive regardless of approval status
    const needsMetaTemplate = template.category !== "GENERAL" && template.approvalStatus === "APPROVED" && !!template.metaTemplateName;
    const messageType = needsMetaTemplate ? "TEMPLATE" : (hasButtons ? "INTERACTIVE" : "TEXT");

    // Store full template structure as JSON so the frontend can render header/body/footer/buttons
    const resolvedHeader = template.header ? resolveNamedVars(template.header, conversation.customer, req.user) : null;
    const templateContent = JSON.stringify({
      header: resolvedHeader || undefined,
      body: resolvedBody,
      footer: template.footer || undefined,
      buttons: hasButtons ? template.buttons : undefined,
    });

    // Positional params matching the submitted template (order of appearance).
    const templateVariables = buildTemplateParams(template.body, conversation.customer, req.user);

    let message = await prisma.message.create({
      data: {
        conversationId,
        senderType: "AGENT",
        senderId: parseInt(req.user.id),
        content: templateContent,
        messageType: "INTERACTIVE",
        status: "PENDING",
      },
    });

    try {
      const { whatsappMessageId } = await sendWhatsAppMessage({
        to: conversation.customer.phone,
        content: resolvedBody,
        messageType,
        buttons: hasButtons ? template.buttons : null,
        header: template.header || null,
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
      console.error("WhatsApp template send failed:", waErr.response?.data || waErr.message);
      message = await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED" } });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessage: resolvedBody,
        lastMessageAt: new Date(),
        lastSenderType: "AGENT",
      },
    });

    const io = getIO();
    io.emit("message.created", { message, conversationId });
    io.emit("conversation.updated", { conversationId });

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitForApproval,
  syncApprovalStatus,
  sendTemplate,
};
