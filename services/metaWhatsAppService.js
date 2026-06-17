import { ApiError } from '../utils/ApiError.js';

const DEFAULT_GRAPH_VERSION = String(process.env.META_GRAPH_API_VERSION || 'v22.0').trim();
const DEFAULT_COUNTRY_CODE = String(
  process.env.META_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_COUNTRY_CODE || '972'
)
  .replace(/\D/g, '')
  .trim();

const parseBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const normalizeE164 = (phone) => {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (DEFAULT_COUNTRY_CODE && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `+${digits}`;
  }

  if (DEFAULT_COUNTRY_CODE && digits.startsWith('0')) {
    return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }

  if (DEFAULT_COUNTRY_CODE && digits.length >= 7 && digits.length <= 11) {
    return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  }

  return `+${digits}`;
};

export const normalizeMetaRecipient = (phone) => {
  const e164 = normalizeE164(phone);
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
};

export const resolveMetaWhatsAppConfig = (checkoutForm = {}) => {
  const envEnabled = parseBoolean(process.env.META_WHATSAPP_ENABLED, false);
  return {
    enabled: envEnabled || !!checkoutForm.reminderWhatsAppEnabled,
    accessToken: String(checkoutForm.metaAccessToken || process.env.META_WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(checkoutForm.metaPhoneNumberId || process.env.META_WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    verifyToken: String(checkoutForm.metaVerifyToken || process.env.META_WHATSAPP_VERIFY_TOKEN || '').trim(),
    templateName: String(checkoutForm.metaTemplateName || process.env.META_WHATSAPP_TEMPLATE_NAME || '').trim(),
    templateLanguage: String(
      checkoutForm.metaTemplateLanguage || process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'he'
    ).trim(),
    autoReply: String(process.env.META_WHATSAPP_AUTOREPLY || process.env.META_WHATSAPP_AUTO_REPLY || '').trim(),
    publicWebUrl: String(process.env.PUBLIC_WEB_URL || '').replace(/\/$/, ''),
    graphVersion: DEFAULT_GRAPH_VERSION
  };
};

export const isMetaWhatsAppConfigured = (config) => {
  return !!String(config?.accessToken || '').trim() && !!String(config?.phoneNumberId || '').trim();
};

const buildTemplateComponents = (templateParameters = [], headerParameters = [], buttonUrlSuffix = '') => {
  const components = [];

  // Header parameters (if any)
  const headerParams = headerParameters
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .map((text) => ({ type: 'text', text }));
  if (headerParams.length) {
    components.push({ type: 'header', parameters: headerParams });
  }

  // Body parameters
  const bodyParams = templateParameters
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .map((text) => ({ type: 'text', text }));
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams });
  }

  // Button URL suffix (for dynamic URL buttons)
  if (buttonUrlSuffix) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: String(buttonUrlSuffix).trim() }]
    });
  }

  return components.length ? components : undefined;
};

const buildTemplateVariants = (templateParameters = [], headerParameters = [], buttonUrlSuffix = '') => {
  const bodyAll = templateParameters.map((value) => String(value ?? '').trim()).filter(Boolean);
  const bodyFirst = bodyAll.slice(0, 1);
  const headerAll = headerParameters.map((value) => String(value ?? '').trim()).filter(Boolean);
  const buttonValue = String(buttonUrlSuffix || '').trim();

  const variants = [
    { templateParameters: bodyAll, headerParameters: headerAll, buttonUrlSuffix: buttonValue },
    { templateParameters: bodyAll, headerParameters: [], buttonUrlSuffix: buttonValue },
    { templateParameters: bodyFirst, headerParameters: headerAll, buttonUrlSuffix: buttonValue },
    { templateParameters: bodyFirst, headerParameters: [], buttonUrlSuffix: buttonValue },
    { templateParameters: bodyAll, headerParameters: headerAll, buttonUrlSuffix: '' },
    { templateParameters: bodyAll, headerParameters: [], buttonUrlSuffix: '' },
    { templateParameters: bodyFirst, headerParameters: headerAll, buttonUrlSuffix: '' },
    { templateParameters: bodyFirst, headerParameters: [], buttonUrlSuffix: '' }
  ];

  const seen = new Set();
  return variants.filter((variant) => {
    const key = JSON.stringify(variant);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const postMetaWhatsAppPayload = async ({ accessToken, phoneNumberId, graphVersion, payload }) => {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  return { response, parsed, rawText };
};

export const sendMetaWhatsAppMessage = async ({
  accessToken,
  phoneNumberId,
  to,
  body,
  templateName,
  templateLanguage = 'en_US',
  templateParameters = [],
  headerParameters = [],
  buttonUrlSuffix = '',
  previewUrl = true,
  graphVersion = DEFAULT_GRAPH_VERSION
}) => {
  if (!accessToken || !phoneNumberId) {
    throw new ApiError(400, 'Meta WhatsApp is not configured (access token / phone number ID missing)');
  }
  if (!to) {
    throw new ApiError(400, 'Meta WhatsApp destination number is invalid');
  }
  if (!body && !templateName) {
    throw new ApiError(400, 'Meta WhatsApp body or template name is required');
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to
  };

  if (templateName) {
    payload.type = 'template';
    payload.template = {
      name: templateName,
      language: { code: templateLanguage || 'he' }
    };
    const variants = buildTemplateVariants(templateParameters, headerParameters, buttonUrlSuffix);
    let lastFailure = null;

    for (const variant of variants) {
      const attemptPayload = {
        ...payload,
        template: {
          ...payload.template
        }
      };
      const components = buildTemplateComponents(
        variant.templateParameters,
        variant.headerParameters,
        variant.buttonUrlSuffix
      );
      if (components) {
        attemptPayload.template.components = components;
      } else {
        delete attemptPayload.template.components;
      }

      const { response, parsed, rawText } = await postMetaWhatsAppPayload({
        accessToken,
        phoneNumberId,
        graphVersion,
        payload: attemptPayload
      });

      if (response.ok) {
        return parsed || {};
      }

      const metaCode = parsed?.error?.code || null;
      const detail = parsed?.error?.message || rawText || response.statusText || 'Unknown error';
      const err = new ApiError(response.status, `Meta WhatsApp send failed: ${detail}`);
      err.metaData = parsed;
      lastFailure = err;

      if (metaCode !== 132000) {
        throw err;
      }
    }

    throw lastFailure || new ApiError(400, 'Meta WhatsApp send failed: template parameter mismatch');
  } else {
    payload.type = 'text';
    payload.text = {
      preview_url: !!previewUrl,
      body: String(body || '')
    };
  }

  const { response, parsed, rawText } = await postMetaWhatsAppPayload({
    accessToken,
    phoneNumberId,
    graphVersion,
    payload
  });

  if (!response.ok) {
    const detail = parsed?.error?.message || rawText || response.statusText || 'Unknown error';
    const err = new ApiError(response.status, `Meta WhatsApp send failed: ${detail}`);
    err.metaData = parsed;
    throw err;
  }

  return parsed || {};
};
