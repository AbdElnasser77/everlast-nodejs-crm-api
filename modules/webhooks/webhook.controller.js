const axios = require("axios");
const prisma = require("../../config/prisma");
const cloudinary = require("../../utils/cloudinary");
const { getIO } = require("../../utils/socket");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0";

const CLOUDINARY_RESOURCE_TYPE = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "video", // Cloudinary uses "video" for audio
  DOCUMENT: "raw",
  STICKER: "image", // WebP stickers are images
};

const uploadReceivedMediaToCloudinary = async (messageId, mediaId, messageType) => {
  try {
    // 1. Get the temporary download URL from Meta
    const metaRes = await axios.get(
      `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
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
    const uploadOptions = { resource_type: resourceType, folder: "everlast-crm/received" };
    if (messageType === "STICKER") {
      uploadOptions.flags = ["animated"];
      uploadOptions.format = "webp";
    }
    const cloudinaryResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
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
  interactive: "TEXT",
  sticker: "STICKER",
};

const extractFromPayload = (body) => {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  const contact = change?.contacts?.[0];

  if (!msg) return null;

  const phone =
    msg.from ||
    contact?.wa_id ||
    contact?.user_id ||
    msg.from_user_id ||
    null;

  if (!phone) return null;

  const name = contact?.profile?.name || contact?.profile?.username || null;

  const content =
    msg.text?.body ||
    msg.interactive?.button_reply?.title ||
    msg.interactive?.list_reply?.title ||
    msg.image?.caption ||
    msg.video?.caption ||
    msg.audio?.caption ||
    msg.document?.caption ||
    (msg.type === "sticker" ? "[sticker]" : null) ||
    "[media message]";

  const mediaId =
    msg.image?.id ||
    msg.video?.id ||
    msg.audio?.id ||
    msg.document?.id ||
    msg.sticker?.id ||
    null;

  // WA ID of the message being quoted (present when customer replies to a specific message)
  const quotedWhatsappMessageId = msg.context?.id || null;

  return {
    phone,
    name,
    content,
    mediaId,
    messageType: MESSAGE_TYPE_MAP[msg.type] || "TEXT",
    whatsappMessageId: msg.id,
    quotedWhatsappMessageId,
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

const handleReaction = async (value) => {
  const msg = value?.messages?.[0];
  if (!msg || msg.type !== "reaction") return;

  const { message_id: targetWaId, emoji } = msg.reaction;

  const target = await prisma.message.findFirst({ where: { whatsappMessageId: targetWaId } });
  if (!target) {
    console.log("Webhook: reaction target not found, skipping");
    return;
  }

  // reactions stored as { "👍": count, "❤️": count, ... }
  const reactions = (target.reactions && typeof target.reactions === "object") ? { ...target.reactions } : {};

  if (emoji) {
    reactions[emoji] = (reactions[emoji] || 0) + 1;
    console.log(`Webhook: reaction ${emoji} on message ${target.id}`);
  } else {
    // Empty emoji = customer removed their reaction — no per-sender tracking, so skip decrement
    console.log(`Webhook: reaction removed on message ${target.id} (skipped)`);
  }

  await prisma.message.update({ where: { id: target.id }, data: { reactions } });
  getIO().emit("message.reaction", { messageId: target.id, reactions });
};

const receiveWhatsAppMessage = async (req, res) => {
  // Return 200 immediately — Meta requires a fast response or it will retry
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (value?.statuses?.length) {
      await handleStatusUpdate(value);
      return;
    }

    // Reaction webhooks: type === "reaction" inside messages array
    if (value?.messages?.[0]?.type === "reaction") {
      await handleReaction(value);
      return;
    }

    const extracted = extractFromPayload(req.body);
    if (!extracted) {
      console.log("Webhook: no message extracted from payload — skipping");
      return;
    }

    const { phone, name, content, mediaId, messageType, whatsappMessageId, quotedWhatsappMessageId } = extracted;
    console.log("Webhook: processing message from", phone, "| type:", messageType);

    // Deduplicate: if we already saved this WhatsApp message ID, skip it
    if (whatsappMessageId) {
      const duplicate = await prisma.message.findFirst({ where: { whatsappMessageId } });
      if (duplicate) {
        console.log("Webhook: duplicate message ignored, id:", whatsappMessageId);
        return;
      }
    }

    // Use upsert to avoid race condition when two webhooks arrive simultaneously for the same customer
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: name ? { name } : {},
      create: { phone, name },
    });
    console.log("Webhook: customer id", customer.id);

    // Use upsert to avoid race condition when creating conversation
    const conversation = await prisma.conversation.upsert({
      where: { customerId: customer.id },
      update: {},
      create: { customerId: customer.id },
    });
    console.log("Webhook: conversation id", conversation.id);

    // Resolve quoted message: look up by WA ID to get our local DB id
    let quotedMessageId = null;
    if (quotedWhatsappMessageId) {
      const quoted = await prisma.message.findFirst({ where: { whatsappMessageId: quotedWhatsappMessageId } });
      quotedMessageId = quoted?.id ?? null;
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
        quotedMessageId,
        status: null,
      },
    });
    console.log("Webhook: saved message id", message.id, quotedMessageId ? `(reply to ${quotedMessageId})` : "");

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
        lastCustomerMessageAt: new Date(),
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
