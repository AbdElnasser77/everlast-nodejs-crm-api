const axios = require("axios");

const sendWhatsAppMessage = async ({ to, content, messageType = "TEXT", mediaUrl = null, buttons = null, templateName = null, language = "en_US", templateVariables = [] }) => {
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
    case "INTERACTIVE":
      payload.type = "interactive";
      payload.interactive = {
        type: "button",
        body: { text: content },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      };
      break;
    case "TEMPLATE":
      payload.type = "template";
      payload.template = {
        name: templateName,
        language: { code: language },
        components: templateVariables.length
          ? [{ type: "body", parameters: templateVariables.map((v) => ({ type: "text", text: v })) }]
          : [],
      };
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
