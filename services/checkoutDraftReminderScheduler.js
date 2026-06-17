import CheckoutDraft from '../models/CheckoutDraft.js';
import Settings from '../models/Settings.js';
import {
  isMetaWhatsAppConfigured,
  normalizeMetaRecipient,
  resolveMetaWhatsAppConfig,
  sendMetaWhatsAppMessage
} from './metaWhatsAppService.js';

const REMINDER_DELAY_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const SETTINGS_CACHE_MS = 60 * 1000;
const envWhatsApp = resolveMetaWhatsAppConfig();

// Default country code to rewrite local numbers (e.g. 059 -> +97259)
const DEFAULT_WHATSAPP_COUNTRY_CODE = (process.env.META_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_COUNTRY_CODE || '972')
  .replace(/\D/g, '')
  .trim();

let timer = null;
let cachedSettings = null;
let cachedAt = 0;

const getSettings = async () => {
  const now = Date.now();
  if (cachedSettings && now - cachedAt < SETTINGS_CACHE_MS) return cachedSettings;
  cachedSettings = await Settings.findOne({}).lean();
  cachedAt = now;
  return cachedSettings;
};

const resolveName = (draft) => {
  const contactName = draft?.contact?.name || `${draft?.contact?.firstName || ''} ${draft?.contact?.lastName || ''}`.trim();
  if (contactName) return contactName;
  const payloadName = `${draft?.payload?.firstName || ''} ${draft?.payload?.lastName || ''}`.trim();
  return payloadName || 'Guest';
};

const resolvePhone = (draft) => {
  return draft?.contact?.mobile || draft?.payload?.mobile || draft?.payload?.phone || '';
};

const buildMessage = (template, name, discountCode, checkoutUrl) => {
  const fallback = [
    'היי {{name}} 👋',
    '',
    'שמנו לב שהתחלת הזמנה אבל לא השלמת אותה 🛒',
    'רק רצינו להזכיר לך – העגלה שלך עדיין מחכה ⏱️',
    '',
    '🎁 אם תסיים את ההזמנה עכשיו, תקבל:',
    '🚚 משלוח מהיר עד דלת הבית – מתנה',
    '💸 בנוסף, תוכל להשתמש בקוד {{discountCode}} ולקבל 10% הנחה על ההזמנה שלך',
    '',
    '⏳ המוצרים שמורים עבורך והקישור עדיין פעיל 👇',
    '{{checkoutUrl}}',
    '',
    'יש שאלה או משהו לא ברור?',
    'אני כאן בשבילך 😊'
  ].join('\n');
  const msg = (template && String(template).trim()) ? template : fallback;
  return msg
    .replace(/\{\{name\}\}/g, name || 'Guest')
    .replace(/\{\{discountCode\}\}/g, discountCode || '')
    .replace(/\{\{checkoutUrl\}\}/g, checkoutUrl || '');
};

const appendDraftKeyToUrl = (url, draftKey) => {
  if (!url || !draftKey) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('draft', draftKey);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}draft=${encodeURIComponent(draftKey)}`;
  }
};

const buildWhatsappLink = (phone, message) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

const normalizeE164 = (phone) => {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // Remove leading 00 (international dial prefix) if present
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // If already starts with default country code (e.g. 972...), trust it
  if (DEFAULT_WHATSAPP_COUNTRY_CODE && digits.startsWith(DEFAULT_WHATSAPP_COUNTRY_CODE)) {
    return `+${digits}`;
  }

  // Convert local numbers that start with a leading 0 to E.164 using default country
  if (DEFAULT_WHATSAPP_COUNTRY_CODE && digits.startsWith('0')) {
    return `+${DEFAULT_WHATSAPP_COUNTRY_CODE}${digits.slice(1)}`;
  }

  // Handle local numbers missing the leading 0 (e.g. 598..., 2598...)
  if (DEFAULT_WHATSAPP_COUNTRY_CODE && digits.length >= 7 && digits.length <= 11) {
    return `+${DEFAULT_WHATSAPP_COUNTRY_CODE}${digits}`;
  }

  return `+${digits}`;
};

export function startCheckoutDraftReminderScheduler() {
  if (timer) return;

  const tick = async () => {
    try {
      const cutoff = new Date(Date.now() - REMINDER_DELAY_MS);
      const due = await CheckoutDraft.find({
        $and: [
          { lastSeenAt: { $lte: cutoff } },
          { $or: [{ reminderCount: { $exists: false } }, { reminderCount: 0 }] },
          {
            $or: [
              { 'contact.mobile': { $exists: true, $ne: '' } },
              { 'payload.mobile': { $exists: true, $ne: '' } },
              { 'payload.phone': { $exists: true, $ne: '' } }
            ]
          }
        ]
      })
        .sort({ lastSeenAt: 1 })
        .limit(10);

      if (!due.length) return;

      const settings = await getSettings();
      const cf = settings?.checkoutForm || {};
      const template = cf.reminderMessageTemplate || '';
      const checkoutUrlBase = (cf.reminderCheckoutUrl && String(cf.reminderCheckoutUrl).trim())
        || (envWhatsApp?.publicWebUrl ? `${envWhatsApp.publicWebUrl}/checkout` : '')
        || '';
      const discountCode = cf.reminderDiscountCode || '';
      const whatsappConfig = resolveMetaWhatsAppConfig(cf);

      if (!whatsappConfig.enabled || !isMetaWhatsAppConfigured(whatsappConfig)) {
        console.warn('[reminder] Meta WhatsApp not configured; skipping auto reminders');
        return;
      }

      for (const draft of due) {
        try {
          const phone = resolvePhone(draft);
          const to = normalizeMetaRecipient(phone);
          if (!to) {
            console.warn('[reminder] Skipping draft due to invalid phone', {
              id: draft?._id,
              rawPhone: phone
            });
            continue;
          }
          const checkoutUrl = appendDraftKeyToUrl(checkoutUrlBase, draft?.draftKey || '');
          const message = buildMessage(template, resolveName(draft), discountCode, checkoutUrl);
          // Template expects: Body={{1}}=name, Body={{2}}=checkoutUrl, Button={{1}}=draftKey
          const customerName = resolveName(draft);
          const draftKey = draft?.draftKey || '';
          const result = await sendMetaWhatsAppMessage({
            accessToken: whatsappConfig.accessToken,
            phoneNumberId: whatsappConfig.phoneNumberId,
            to,
            body: message,
            templateName: whatsappConfig.templateName,
            templateLanguage: whatsappConfig.templateLanguage,
            templateParameters: [customerName, checkoutUrl],
            buttonUrlSuffix: draftKey
          });

          const link = buildWhatsappLink(phone, message);
          const note = `Auto WhatsApp sent (Meta): ${result?.messages?.[0]?.id || 'unknown'}${link ? `\n${link}` : ''}`;
          draft.lastReminderAt = new Date();
          draft.lastReminderChannel = 'whatsapp-auto';
          draft.reminderCount = Number(draft.reminderCount || 0) + 1;
          draft.reminderNote = draft.reminderNote ? `${draft.reminderNote}\n${note}` : note;
          await draft.save();

          console.log('[reminder] WhatsApp sent via Meta', { id: draft._id, messageId: result?.messages?.[0]?.id || '' });
        } catch (e) {
          const metaData = e?.metaData || {};
          const status = e?.statusCode || e?.status || null;
          const metaMsg = metaData?.error?.message || '';
          const metaCode = metaData?.error?.code || null;
          const detail = metaMsg || e?.message || 'Unknown error';
          console.warn('[reminder] Failed to process draft', {
            id: draft?._id,
            status,
            metaCode,
            detail,
            rawPhone: resolvePhone(draft),
            to: normalizeMetaRecipient(resolvePhone(draft)),
            hasAccessToken: !!whatsappConfig.accessToken,
            hasPhoneNumberId: !!whatsappConfig.phoneNumberId,
            hasTemplate: !!whatsappConfig.templateName
          });
        }
      }
    } catch (e) {
      console.warn('[reminder] scheduler tick failed', e?.message || e);
    }
  };

  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopCheckoutDraftReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
