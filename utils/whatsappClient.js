const axios = require("axios");

const getApiVersion = () => process.env.WHATSAPP_API_VERSION || "v19.0";

// Build the "header" object for an ad-hoc INTERACTIVE message. Unlike an
// approved Meta TEMPLATE, an interactive message's header media is just a
// link — no upload/handle needed.
function buildInteractiveHeader(headerType, header, headerMediaUrl) {
  if (headerType === "TEXT" && header) return { type: "text", text: header };
  if (headerType === "IMAGE" && headerMediaUrl) return { type: "image", image: { link: headerMediaUrl } };
  if (headerType === "VIDEO" && headerMediaUrl) return { type: "video", video: { link: headerMediaUrl } };
  if (headerType === "DOCUMENT" && headerMediaUrl) return { type: "document", document: { link: headerMediaUrl, filename: "document" } };
  return null;
}

const sendWhatsAppMessage = async ({
  to,
  content,
  messageType = "TEXT",
  mediaUrl = null,
  buttons = null,
  headerType = null,
  header = null,
  headerMediaUrl = null,
  footer = null,
  templateName = null,
  language = "en_US",
  templateVariables = [],
  quotedWhatsappMessageId = null,
}) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: messageType.toLowerCase(),
    ...(quotedWhatsappMessageId ? { context: { message_id: quotedWhatsappMessageId } } : {}),
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
    case "INTERACTIVE": {
      // WhatsApp's ad-hoc interactive message only supports two button shapes:
      // up to 3 Quick Reply buttons, OR a single CTA URL button. A Call Number
      // button, or a mix of CTA buttons, only renders as real tappable buttons
      // inside an approved Meta TEMPLATE — for an immediate/ad-hoc send we
      // degrade gracefully to plain text lines instead of dropping the info.
      const list = buttons || [];
      const interactiveHeader = buildInteractiveHeader(headerType, header, headerMediaUrl);
      const allQuickReply = list.length > 0 && list.every((b) => (b.type || "QUICK_REPLY") === "QUICK_REPLY");
      const singleUrlButton = list.length === 1 && list[0].type === "URL";

      payload.type = "interactive";
      if (allQuickReply) {
        payload.interactive = {
          type: "button",
          ...(interactiveHeader && { header: interactiveHeader }),
          body: { text: content },
          ...(footer && { footer: { text: footer } }),
          action: { buttons: list.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        };
      } else if (singleUrlButton) {
        payload.interactive = {
          type: "cta_url",
          ...(interactiveHeader && { header: interactiveHeader }),
          body: { text: content },
          ...(footer && { footer: { text: footer } }),
          action: { name: "cta_url", parameters: { display_text: list[0].title, url: list[0].url } },
        };
      } else if (list.length > 0) {
        const lines = list.map((b) =>
          b.type === "PHONE_NUMBER" ? `📞 ${b.title}: ${b.phoneNumber}` : b.type === "URL" ? `🔗 ${b.title}: ${b.url}` : `• ${b.title}`
        );
        payload.type = "text";
        payload.text = { body: [content, "", ...lines].join("\n") };
      } else {
        payload.interactive = {
          type: "button",
          ...(interactiveHeader && { header: interactiveHeader }),
          body: { text: content },
          ...(footer && { footer: { text: footer } }),
          action: { buttons: [] },
        };
      }
      break;
    }
    case "TEMPLATE": {
      payload.type = "template";
      const components = [];
      if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && headerMediaUrl) {
        const key = headerType.toLowerCase();
        components.push({ type: "header", parameters: [{ type: key, [key]: { link: headerMediaUrl } }] });
      }
      if (templateVariables.length) {
        components.push({ type: "body", parameters: templateVariables.map((v) => ({ type: "text", text: v })) });
      }
      // Static URL/Call/Quick-Reply buttons need no component override at
      // send time — they're already baked into the approved template. A URL
      // button with a dynamic {{1}} placeholder would need one, but that
      // requires resolving the button's own variable (distinct from the body
      // vars) which isn't modeled yet, so it's intentionally left as-is
      // rather than guessing a value.
      payload.template = { name: templateName, language: { code: language }, components };
      break;
    }
    default:
      payload.text = { body: content };
  }

  const response = await axios.post(
    `https://graph.facebook.com/${getApiVersion()}/${phoneNumberId}/messages`,
    payload,
    {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      // Fail fast instead of letting one hung request stall the whole campaign loop.
      timeout: 30_000,
    },
  );

  const whatsappMessageId = response.data?.messages?.[0]?.id;
  return { whatsappMessageId };
};

module.exports = { sendWhatsAppMessage, getApiVersion };
