const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");
const { getIO } = require("../../utils/socket");
const logAudit = require("../../utils/audit");

const VALID_STATUSES = ["OPEN", "PENDING", "RESOLVED"];

const getAllConversations = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.assignedAgentId) where.assignedAgentId = parseInt(req.query.assignedAgentId);
    if (req.query.lastSenderType) where.lastSenderType = req.query.lastSenderType;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          customer: { select: { name: true, phone: true } },
          assignedAgent: { select: { id: true, username: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.conversation.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: conversations,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const getConversationMessages = async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id);
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return next(new AppError("Conversation not found", 404));

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId },
        include: {
          quotedMessage: {
            select: { id: true, content: true, messageType: true, senderType: true, mediaUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.message.count({ where: { conversationId } }),
    ]);

    res.status(200).json({
      success: true,
      data: messages,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const markConversationRead = async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.update({
      where: { id: parseInt(req.params.id) },
      data: { unreadCount: 0 },
    });

    getIO().emit("conversation.updated", { conversationId: parseInt(req.params.id) });

    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Conversation not found", 404));
    next(err);
  }
};

const assignConversation = async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id);
    const { agentId } = req.body;

    if (agentId !== null && agentId !== undefined) {
      const agent = await prisma.user.findUnique({ where: { id: parseInt(agentId) } });
      if (!agent) return next(new AppError("Agent not found", 404));
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedAgentId: agentId ? parseInt(agentId) : null },
      include: {
        customer: { select: { name: true, phone: true } },
        assignedAgent: { select: { id: true, username: true } },
      },
    });

    getIO().emit("conversation.assigned", {
      conversationId,
      agentId: conversation.assignedAgentId,
      agentUsername: conversation.assignedAgent?.username || null,
    });

    logAudit({
      action: "conversation.assigned",
      actor: req.user,
      targetType: "conversation",
      targetId: conversationId,
      details: { agentId: conversation.assignedAgentId, agentUsername: conversation.assignedAgent?.username || null },
    });

    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Conversation not found", 404));
    next(err);
  }
};

const changeConversationStatus = async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Status must be one of: ${VALID_STATUSES.join(", ")}`, 400));
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
      include: {
        customer: { select: { name: true, phone: true } },
        assignedAgent: { select: { id: true, username: true } },
      },
    });

    getIO().emit("conversation.status_changed", { conversationId, status });

    logAudit({
      action: "conversation.status_changed",
      actor: req.user,
      targetType: "conversation",
      targetId: conversationId,
      details: { status },
    });

    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Conversation not found", 404));
    next(err);
  }
};

const createOrGetConversation = async (req, res, next) => {
  try {
    const { customerId } = req.body;
    if (!customerId) return next(new AppError("customerId is required", 400));

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(customerId) } });
    if (!customer || customer.isActive === false) return next(new AppError("Customer not found", 404));

    // Return existing conversation if one already exists (1-to-1 constraint)
    const existing = await prisma.conversation.findUnique({
      where: { customerId: parseInt(customerId) },
      include: {
        customer: { select: { name: true, phone: true } },
        assignedAgent: { select: { id: true, username: true } },
      },
    });
    if (existing) return res.status(200).json({ success: true, data: existing, created: false });

    // Create fresh conversation
    const conversation = await prisma.conversation.create({
      data: {
        customerId: parseInt(customerId),
        status: "OPEN",
        unreadCount: 0,
      },
      include: {
        customer: { select: { name: true, phone: true } },
        assignedAgent: { select: { id: true, username: true } },
      },
    });

    getIO().emit("conversation.created", { conversationId: conversation.id });

    logAudit({
      action: "conversation.created",
      actor: req.user,
      targetType: "conversation",
      targetId: conversation.id,
      details: { customerId: conversation.customerId, initiatedBy: "agent" },
    });

    res.status(201).json({ success: true, data: conversation, created: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllConversations,
  getConversationMessages,
  markConversationRead,
  assignConversation,
  changeConversationStatus,
  createOrGetConversation,
};
