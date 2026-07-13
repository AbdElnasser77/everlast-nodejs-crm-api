const axios = require("axios");
const AppError = require("../../utils/AppError");
const { getApiVersion } = require("../../utils/whatsappClient");

// Fields documented on Meta's WhatsApp Business phone number object that
// carry reputation/health signal: `status` is the ban/flag/restriction state
// (CONNECTED / FLAGGED / RESTRICTED / BANNED), `quality_rating` is the
// GREEN/YELLOW/RED rating that drives it.
const CORE_FIELDS = [
  "verified_name",
  "display_phone_number",
  "quality_rating",
  "status",
  "name_status",
  "code_verification_status",
  "throughput",
].join(",");

const getPhoneNumberStatus = async (req, res, next) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return next(new AppError("WhatsApp is not configured (missing WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)", 500));
  }

  const url = `https://graph.facebook.com/${getApiVersion()}/${phoneNumberId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const { data } = await axios.get(url, { params: { fields: CORE_FIELDS }, headers });

    // messaging_limit_tier is being phased out in favor of a Business
    // Portfolio-level field this account isn't configured for yet — fetched
    // best-effort in its own call so its removal can't break the rest of
    // the dashboard if Meta rejects the field for this app version.
    let messagingLimitTier = null;
    try {
      const tierRes = await axios.get(url, { params: { fields: "messaging_limit_tier" }, headers });
      messagingLimitTier = tierRes.data.messaging_limit_tier || null;
    } catch {
      messagingLimitTier = null;
    }

    res.status(200).json({
      success: true,
      data: {
        verifiedName: data.verified_name || null,
        displayPhoneNumber: data.display_phone_number || null,
        qualityRating: data.quality_rating || "UNKNOWN",
        status: data.status || "UNKNOWN",
        nameStatus: data.name_status || null,
        codeVerificationStatus: data.code_verification_status || null,
        throughputLevel: data.throughput?.level || null,
        messagingLimitTier,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    if (metaError) {
      // Never relay Meta's own status code as-is — Meta returns 401 for an
      // expired/invalid WhatsApp access token, and the frontend treats ANY
      // 401 as "your CRM session expired," force-logging the user out. That
      // would turn a dead WhatsApp token into a false CRM logout. Always
      // surface this as a distinct upstream-failure status instead.
      return next(new AppError(`WhatsApp API error: ${metaError.message}`, 502));
    }
    next(err);
  }
};

// Lists every phone number on the WhatsApp Business Account (WABA) — not
// just the single number this app sends from. Needs WHATSAPP_WABA_ID, which
// this codebase already expects for template submission (see
// modules/templates/template.controller.js); not yet configured, so this
// fails with a clear message until it is rather than guessing/crashing.
const getAllPhoneNumbers = async (req, res, next) => {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!wabaId) {
    return next(new AppError("WHATSAPP_WABA_ID is not configured — add it to see every number on your WhatsApp Business Account", 500));
  }
  if (!accessToken) {
    return next(new AppError("WhatsApp is not configured (missing WHATSAPP_ACCESS_TOKEN)", 500));
  }

  try {
    const { data } = await axios.get(`https://graph.facebook.com/${getApiVersion()}/${wabaId}/phone_numbers`, {
      params: { fields: CORE_FIELDS },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const numbers = (data.data || []).map((n) => ({
      id: n.id,
      verifiedName: n.verified_name || null,
      displayPhoneNumber: n.display_phone_number || null,
      qualityRating: n.quality_rating || "UNKNOWN",
      status: n.status || "UNKNOWN",
      nameStatus: n.name_status || null,
      codeVerificationStatus: n.code_verification_status || null,
      throughputLevel: n.throughput?.level || null,
      isPrimary: n.id === process.env.WHATSAPP_PHONE_NUMBER_ID,
    }));

    res.status(200).json({ success: true, data: numbers, fetchedAt: new Date().toISOString() });
  } catch (err) {
    const metaError = err.response?.data?.error;
    if (metaError) {
      // Never relay Meta's own status code as-is — Meta returns 401 for an
      // expired/invalid WhatsApp access token, and the frontend treats ANY
      // 401 as "your CRM session expired," force-logging the user out. That
      // would turn a dead WhatsApp token into a false CRM logout. Always
      // surface this as a distinct upstream-failure status instead.
      return next(new AppError(`WhatsApp API error: ${metaError.message}`, 502));
    }
    next(err);
  }
};

module.exports = { getPhoneNumberStatus, getAllPhoneNumbers };
