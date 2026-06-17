import crypto from 'crypto';
import { ApiError } from '../utils/ApiError.js';
import { buildWhatsAppLink, buildLinksForUsers, buildLinksByFilter } from '../services/whatsappService.js';
import WhatsAppInboundMessage from '../models/WhatsAppInboundMessage.js';
import User from '../models/User.js';
import { normalizePhoneE164ish } from '../utils/phone.js';
import mongoose from 'mongoose';
import Settings from '../models/Settings.js';
import {
  isMetaWhatsAppConfigured,
  normalizeMetaRecipient,
  resolveMetaWhatsAppConfig,
  sendMetaWhatsAppMessage
} from '../services/metaWhatsAppService.js';

// Meta WhatsApp webhook signature validation
const isMetaSignatureValid = (req) => {
  const appSecret = process.env.META_APP_SECRET || process.env.META_WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // Skip validation if secret is not configured
  const signature = req.get('X-Hub-Signature-256');
  if (!signature) return false;
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', appSecret)
    .update(JSON.stringify(req.body) || '')
    .digest('hex');
  const providedBuf = Buffer.from(signature || '', 'utf8');
  const expectedBuf = Buffer.from(expectedSignature || '', 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

const normalizeWhatsAppPhone = (value) => {
  if (!value) return '';
  const stripped = String(value).replace(/^whatsapp:/i, '');
  return normalizePhoneE164ish(stripped);
};

const resolveMatchedUserId = async (phone) => {
  if (!phone) return null;
  const user = await User.findOne({ phoneNumber: phone }).select('_id');
  return user?._id || null;
};

const touchMatchedUser = async (matchedUser, body) => {
  if (!matchedUser) return;
  await User.updateOne(
    { _id: matchedUser },
    { $set: { lastWhatsAppContactAt: new Date(), lastWhatsAppMessagePreview: String(body || '').slice(0, 160) } }
  );
};

const getMetaWebhookConfig = async () => {
  const settings = await Settings.findOne().select('checkoutForm').lean();
  return resolveMetaWhatsAppConfig(settings?.checkoutForm || {});
};

export const singleLink = async (req, res, next) => {
  try {
    const { phoneNumber, message } = req.body;
    if (!phoneNumber) throw new ApiError(400, 'phoneNumber required');
    const url = buildWhatsAppLink(phoneNumber, message || '');
    res.json({ success: true, url });
  } catch (e) { next(e); }
};

export const bulkLinksByIds = async (req, res, next) => {
  try {
    const { userIds, message, onlyOptIn } = req.body;
  const result = await buildLinksForUsers({ userIds, message, onlyOptIn: onlyOptIn !== false, adminId: req.user?._id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};

export const bulkLinksByFilter = async (req, res, next) => {
  try {
    const { message, onlyOptIn, limit } = req.body;
  const result = await buildLinksByFilter({ message, onlyOptIn: onlyOptIn !== false, limit, adminId: req.user?._id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};

// Legacy inbound handler - now redirects to Meta webhook
// Kept for backward compatibility, use /webhook endpoint instead
export const handleInbound = async (req, res, next) => {
  try {
    // Validate Meta signature if provided
    if (req.get('X-Hub-Signature-256') && !isMetaSignatureValid(req)) {
      return res.status(403).json({ message: 'Invalid signature' });
    }

    // Forward to Meta webhook handler if it looks like Meta format
    const payload = req.body || {};
    if (payload.object === 'whatsapp_business_account' || payload.entry) {
      return handleMetaWebhook(req, res, next);
    }

    // Handle generic incoming message format
    const fromRaw = payload.from || payload.From || '';
    const to = payload.to || payload.To || '';
    const waId = payload.wa_id || payload.WaId || '';
    const profileName = payload.profile_name || payload.ProfileName || '';
    const body = payload.body || payload.Body || payload.text?.body || '';
    const messageSid = payload.id || payload.MessageSid || '';

    const normalizedFrom = normalizeWhatsAppPhone(fromRaw || waId);
    const now = new Date();
    const matchedUser = await resolveMatchedUserId(normalizedFrom);
    await touchMatchedUser(matchedUser, body);

    await WhatsAppInboundMessage.create({
      direction: 'inbound',
      status: 'received',
      from: fromRaw,
      waId: waId || normalizedFrom,
      profileName,
      body,
      to,
      messageSid,
      numMedia: 0,
      media: [],
      raw: payload,
      matchedUser,
      receivedAt: now
    });

    res.status(200).json({ success: true });
  } catch (e) { next(e); }
};

export const handleMetaWebhookVerify = async (req, res, next) => {
  try {
    const mode = String(req.query['hub.mode'] || '').trim();
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '').trim();
    const whatsappConfig = await getMetaWebhookConfig();
    const expectedToken = String(whatsappConfig.verifyToken || '').trim();

    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
      return res.status(200).type('text/plain').send(challenge);
    }

    return res.status(403).json({ message: 'Meta webhook verification failed' });
  } catch (e) { next(e); }
};

export const handleMetaWebhook = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    const whatsappConfig = await getMetaWebhookConfig();

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const metadata = value?.metadata || {};
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        for (const message of messages) {
          const fromRaw = String(message?.from || '').trim();
          const profileName = String(value?.contacts?.find((c) => c?.wa_id === fromRaw)?.profile?.name || '').trim();
          const textBody = String(message?.text?.body || '').trim();
          const imageCaption = String(message?.image?.caption || '').trim();
          const documentCaption = String(message?.document?.caption || '').trim();
          const body = textBody || imageCaption || documentCaption || '';
          const media = [];

          if (message?.image?.id) {
            media.push({ url: message.image.id, contentType: 'image' });
          }
          if (message?.document?.id) {
            media.push({ url: message.document.id, contentType: message.document.mime_type || 'document' });
          }
          if (message?.video?.id) {
            media.push({ url: message.video.id, contentType: 'video' });
          }
          if (message?.audio?.id) {
            media.push({ url: message.audio.id, contentType: 'audio' });
          }

          const normalizedFrom = normalizeWhatsAppPhone(fromRaw);
          const matchedUser = await resolveMatchedUserId(normalizedFrom);
          await touchMatchedUser(matchedUser, body);

          await WhatsAppInboundMessage.create({
            direction: 'inbound',
            status: 'received',
            from: fromRaw,
            waId: normalizedFrom || fromRaw,
            profileName,
            body,
            to: String(metadata?.display_phone_number || metadata?.phone_number_id || '').trim(),
            messageSid: String(message?.id || '').trim(),
            numMedia: media.length,
            media,
            raw: payload,
            matchedUser,
            receivedAt: new Date()
          });

          // Send auto-reply if configured
          const autoReply = whatsappConfig.autoReply;
          if (autoReply && isMetaWhatsAppConfigured(whatsappConfig) && fromRaw) {
            try {
              await sendMetaWhatsAppMessage({
                accessToken: whatsappConfig.accessToken,
                phoneNumberId: whatsappConfig.phoneNumberId,
                to: fromRaw,
                body: autoReply
              });
            } catch (autoReplyErr) {
              console.error('[Meta WhatsApp] Auto-reply failed:', autoReplyErr.message);
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) { next(e); }
};

export const listInbound = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const cursor = req.query.before;
    const q = (req.query.q || '').toString().trim();

    const match = {};
    if (cursor && mongoose.isValidObjectId(cursor)) {
      match._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [
        { from: regex },
        { waId: regex },
        { body: regex },
        { profileName: regex }
      ];
    }

    const messages = await WhatsAppInboundMessage.find(match)
      .sort({ _id: -1 })
      .limit(limit)
      .populate({ path: 'matchedUser', select: 'name image phoneNumber' })
      .lean({ virtuals: false });

    res.json({ messages, nextCursor: messages.length === limit ? messages[messages.length - 1]._id : null });
  } catch (e) { next(e); }
};

export const sendOutbound = async (req, res, next) => {
  try {
    const toRaw = req.body?.to || req.body?.phoneNumber;
    const body = req.body?.body || req.body?.message || '';
    const templateName = String(req.body?.templateName || '').trim();
    const templateLanguage = String(req.body?.templateLanguage || '').trim() || 'en_US';
    const templateParameters = Array.isArray(req.body?.templateParameters)
      ? req.body.templateParameters
      : [];
    const headerParameters = Array.isArray(req.body?.headerParameters)
      ? req.body.headerParameters
      : [];
    const buttonUrlSuffix = String(req.body?.buttonUrlSuffix || '').trim();

    if (!toRaw) throw new ApiError(400, 'to required');
    if (!body && !templateName) throw new ApiError(400, 'body or templateName required');

    const settings = await Settings.findOne().select('checkoutForm').lean();
    const whatsappConfig = resolveMetaWhatsAppConfig(settings?.checkoutForm || {});

    if (!isMetaWhatsAppConfigured(whatsappConfig)) {
      throw new ApiError(400, 'Meta WhatsApp is not configured (access token / phone number ID missing)');
    }

    const to = normalizeMetaRecipient(toRaw);
    if (!to) throw new ApiError(400, 'Invalid destination number');

    const result = await sendMetaWhatsAppMessage({
      accessToken: whatsappConfig.accessToken,
      phoneNumberId: whatsappConfig.phoneNumberId,
      to,
      body,
      templateName,
      templateLanguage,
      templateParameters,
      headerParameters,
      buttonUrlSuffix
    });

    const waId = normalizeWhatsAppPhone(toRaw);

    let matchedUser = null;
    if (waId) {
      const user = await User.findOne({ phoneNumber: waId }).select('_id');
      matchedUser = user?._id || null;
    }

    await WhatsAppInboundMessage.create({
      direction: 'outbound',
      status: 'sent',
      from: whatsappConfig.phoneNumberId,
      to,
      waId,
      body,
      messageSid: result?.messages?.[0]?.id || '',
      numMedia: 0,
      media: [],
      matchedUser,
      raw: { toRaw, body, templateName, templateLanguage, templateParameters, headerParameters, buttonUrlSuffix }
    });

    res.json({ success: true, messageId: result?.messages?.[0]?.id || null, to, waId });
  } catch (e) { next(e); }
};
