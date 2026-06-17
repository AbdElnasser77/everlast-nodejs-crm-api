const axios = require("axios");

const sendWhatsAppMessage = async ({ to, content, messageType = "TEXT", mediaUrl = null }) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: messageType.toLowerCase(),
  };

  switch (messageType) {
    case "TEXT":
      payload.text = { body: content };
      break;
    case "IMAGE":
      payload.image = { link: mediaUrl, caption: content || "" };
      break;
    case "VIDEO":
      payload.video = { link: mediaUrl, caption: content || "" };
      break;
    case "AUDIO":
      payload.audio = { link: mediaUrl };
      break;
    case "DOCUMENT":
      payload.document = { link: mediaUrl, caption: content || "", filename: content || "document" };
      break;
    default:
      payload.text = { body: content };
  }

  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
  );

  const whatsappMessageId = response.data?.messages?.[0]?.id;
  return { whatsappMessageId };
};

module.exports = { sendWhatsAppMessage };
