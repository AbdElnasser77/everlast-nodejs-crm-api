const axios = require("axios");
const prisma = require("../../config/prisma");
const cloudinary = require("../../utils/cloudinary");
const { getIO } = require("../../utils/socket");

const CLOUDINARY_RESOURCE_TYPE = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "video", // Cloudinary uses "video" for audio
  DOCUMENT: "raw",
};

const uploadReceivedMediaToCloudinary = async (messageId, mediaId, messageType) => {
  try {
    // 1. Get the temporary download URL from Meta
    const metaRes = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } },
    );
    const downloadUrl = metaRes.data?.url;
    if (!downloadUrl) return;

    // 2. Download the file from Meta as a stream
    const fileRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      responseType: "stream",
    });

    // 3. Upload stream directly to Cloudinary
    const resourceType = CLOUDINARY_RESOURCE_TYPE[messageType] || "raw";
    const cloudinaryResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType, folder: "everlast-crm/received" },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      fileRes.data.pipe(uploadStream);
    });

    // 4. Save Cloudinary URL on the message
    await prisma.message.update({
      where: { id: messageId },
      data: { mediaUrl: cloudinaryResult.secure_url },
    });

    // 5. Notify frontend the media is ready
    getIO().emit("message.media_ready", {
      messageId,
      mediaUrl: cloudinaryResult.secure_url,
    });

    console.log(`Webhook: media uploaded to Cloudinary for message ${messageId}`);
  } catch (err) {
    console.error(`Webhook: Cloudinary upload failed for message ${messageId}:`, err.message);
  }
};

const MESSAGE_TYPE_MAP = {
  text: "TEXT",
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
};

const extractFromPayload = (body) => {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  const contact = change?.contacts?.[0];

  if (!msg) return null;

  // Scenario 1 & 3: phone from msg.from or contact.wa_id
  // Scenario 2: no phone — use user_id as unique identifier instead
  const phone =
    msg.from ||
    contact?.wa_id ||
    contact?.user_id ||
    msg.from_user_id ||
    null;

  if (!phone) return null;

  // Scenario 1 & 3: use profile.name; Scenario 2: fall back to profile.username
  const name = contact?.profile?.name || contact?.profile?.username || null;

  const content =
    msg.text?.body ||
    msg.image?.caption ||
    msg.video?.caption ||
    msg.audio?.caption ||
    msg.document?.caption ||
    "[media message]";

  const mediaId =
    msg.image?.id ||
    msg.video?.id ||
    msg.audio?.id ||
    msg.document?.id ||
    null;

  return {
    phone,
    name,
    content,
    mediaId,
    messageType: MESSAGE_TYPE_MAP[msg.type] || "TEXT",
    whatsappMessageId: msg.id,
  };
};

const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.send(challenge);
  }
  res.sendStatus(403);
};

const STATUS_MAP = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

const handleStatusUpdate = async (value) => {
  const statusEntry = value?.statuses?.[0];
  if (!statusEntry) return;

  const { id: whatsappMessageId, status } = statusEntry;
  const mapped = STATUS_MAP[status];
  if (!mapped) return;

  const message = await prisma.message.findFirst({ where: { whatsappMessageId } });
  if (!message) return;

  await prisma.message.update({
    where: { id: message.id },
    data: { status: mapped },
  });

  console.log(`Webhook: message ${whatsappMessageId} status → ${mapped}`);

  getIO().emit("message.status_updated", { messageId: message.id, status: mapped });
};

const receiveWhatsAppMessage = async (req, res, next) => {
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (value?.statuses?.length) {
      await handleStatusUpdate(value);
      return;
    }

    const extracted = extractFromPayload(req.body);
    if (!extracted) {
      console.log("Webhook: no message extracted from payload — skipping");
      return;
    }

    const { phone, name, content, mediaId, messageType, whatsappMessageId } = extracted;
    console.log("Webhook: processing message from", phone, "| type:", messageType);

    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone, name } });
      console.log("Webhook: created customer id", customer.id);
    } else {
      console.log("Webhook: found customer id", customer.id);
    }

    let conversation = await prisma.conversation.findUnique({ where: { customerId: customer.id } });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { customerId: customer.id } });
      console.log("Webhook: created conversation id", conversation.id);
    } else {
      console.log("Webhook: found conversation id", conversation.id);
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "CUSTOMER",
        senderId: null,
        content,
        messageType,
        mediaId,
        whatsappMessageId,
        status: null,
      },
    });
    console.log("Webhook: saved message id", message.id);

    // Fire-and-forget: upload media to Cloudinary in background
    if (mediaId) {
      uploadReceivedMediaToCloudinary(message.id, mediaId, messageType);
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        lastMessage: content,
        lastMessageAt: new Date(),
        lastSenderType: "CUSTOMER",
      },
    });

    const io = getIO();
    io.emit("message.created", { message, conversationId: conversation.id });
    io.emit("conversation.updated", { conversationId: conversation.id });
    console.log("Webhook: done ✓");
  } catch (err) {
    console.error("=== WEBHOOK PROCESSING ERROR ===");
    console.error(err);
  }
};

module.exports = { verifyWebhook, receiveWhatsAppMessage };
