/**
 * Meta Conversions API Service
 * Server-side event tracking for Facebook/Meta to complement browser-side Pixel
 * 
 * Required Environment Variables:
 * - META_PIXEL_ID: Facebook Pixel ID
 * - META_CONVERSIONS_ACCESS_TOKEN: Conversions API access token (system user token)
 * - META_TEST_EVENT_CODE: (optional) Test event code for testing in Events Manager
 * - META_GRAPH_API_VERSION: (optional) Graph API version, defaults to v22.0
 */

import crypto from 'crypto';

const DEFAULT_GRAPH_VERSION = String(process.env.META_GRAPH_API_VERSION || 'v22.0').trim();
const GRAPH_API_BASE = 'https://graph.facebook.com';

/**
 * SHA256 hash helper for user data normalization
 */
const sha256Hash = (value) => {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Normalize and hash email
 */
const hashEmail = (email) => sha256Hash(email);

/**
 * Normalize and hash phone number (E.164 format without +)
 */
const hashPhone = (phone) => {
  if (!phone) return null;
  // Remove all non-digits and leading zeros
  const digits = String(phone).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits || digits.length < 7) return null;
  return sha256Hash(digits);
};

/**
 * Normalize country code to ISO 3166-1 alpha-2 lowercase
 */
const hashCountry = (country) => {
  if (!country) return null;
  const code = String(country).toLowerCase().trim().slice(0, 2);
  return code.length === 2 ? sha256Hash(code) : null;
};

/**
 * Normalize and hash city name
 */
const hashCity = (city) => sha256Hash(city);

/**
 * Normalize and hash first name
 */
const hashFirstName = (name) => sha256Hash(name);

/**
 * Normalize and hash last name
 */
const hashLastName = (name) => sha256Hash(name);

/**
 * Build user_data object for Conversions API
 * All PII must be hashed using SHA256
 */
const buildUserData = (userData = {}, request = {}) => {
  const result = {};

  // Email (required for best match rate)
  if (userData.email) {
    result.em = [hashEmail(userData.email)];
  }

  // Phone (highly recommended)
  if (userData.phone) {
    result.ph = [hashPhone(userData.phone)];
  }

  // First name
  if (userData.firstName) {
    result.fn = [hashFirstName(userData.firstName)];
  }

  // Last name
  if (userData.lastName) {
    result.ln = [hashLastName(userData.lastName)];
  }

  // City
  if (userData.city) {
    result.ct = [hashCity(userData.city)];
  }

  // Country
  if (userData.country) {
    result.country = [hashCountry(userData.country)];
  }

  // Client IP address (from request)
  if (request.ip || request.clientIp) {
    result.client_ip_address = request.ip || request.clientIp;
  }

  // User agent (from request)
  if (request.userAgent) {
    result.client_user_agent = request.userAgent;
  }

  // External ID (for advanced matching)
  if (userData.externalId) {
    result.external_id = [sha256Hash(userData.externalId)];
  }

  // FBC (Facebook Click ID) - passed from browser
  if (userData.fbc) {
    result.fbc = userData.fbc;
  }

  // FBP (Facebook Browser ID) - passed from browser
  if (userData.fbp) {
    result.fbp = userData.fbp;
  }

  return result;
};

/**
 * Build custom_data object for ecommerce events
 */
const buildCustomData = (eventData = {}) => {
  const result = {};

  // Currency (required for Purchase, AddToCart, etc.)
  if (eventData.currency) {
    result.currency = String(eventData.currency).toUpperCase();
  }

  // Value (required for Purchase)
  if (typeof eventData.value === 'number') {
    result.value = eventData.value;
  }

  // Content IDs
  if (eventData.contentIds && Array.isArray(eventData.contentIds)) {
    result.content_ids = eventData.contentIds.map(String);
  }

  // Content Type
  if (eventData.contentType) {
    result.content_type = eventData.contentType;
  }

  // Contents array (detailed product info)
  if (eventData.contents && Array.isArray(eventData.contents)) {
    result.contents = eventData.contents.map((item) => ({
      id: String(item.id || ''),
      quantity: Number(item.quantity) || 1,
      item_price: typeof item.price === 'number' ? item.price : undefined
    }));
  }

  // Number of items
  if (typeof eventData.numItems === 'number') {
    result.num_items = eventData.numItems;
  }

  // Content name (for ViewContent)
  if (eventData.contentName) {
    result.content_name = eventData.contentName;
  }

  // Content category
  if (eventData.contentCategory) {
    result.content_category = eventData.contentCategory;
  }

  // Order ID (for deduplication)
  if (eventData.orderId) {
    result.order_id = eventData.orderId;
  }

  // Search string
  if (eventData.searchString) {
    result.search_string = eventData.searchString;
  }

  // Registration method
  if (eventData.registrationMethod) {
    result.registration_method = eventData.registrationMethod;
  }

  return result;
};

/**
 * Resolve configuration from environment and optional settings override
 */
const resolveConfig = (settingsOverride = {}) => {
  return {
    pixelId: String(settingsOverride.pixelId || process.env.META_PIXEL_ID || '').trim(),
    accessToken: String(
      settingsOverride.conversionsAccessToken ||
      settingsOverride.accessToken ||
      process.env.META_CONVERSIONS_ACCESS_TOKEN ||
      ''
    ).trim(),
    testEventCode: String(
      settingsOverride.testEventCode ||
      process.env.META_TEST_EVENT_CODE ||
      ''
    ).trim(),
    graphVersion: String(
      settingsOverride.graphVersion ||
      process.env.META_GRAPH_API_VERSION ||
      DEFAULT_GRAPH_VERSION
    ).trim()
  };
};

/**
 * Check if Conversions API is properly configured
 */
export const isConversionsApiConfigured = (config) => {
  return !!(String(config?.pixelId || '').trim() && String(config?.accessToken || '').trim());
};

/**
 * Send event to Meta Conversions API
 * 
 * @param {string} eventName - Standard or custom event name (e.g., 'Purchase', 'AddToCart')
 * @param {object} options - Event options
 * @param {string} options.eventId - Unique event ID for deduplication (must match browser Pixel event_id)
 * @param {string} options.eventSourceUrl - URL where the event occurred
 * @param {object} options.userData - User data for matching (email, phone, etc.)
 * @param {object} options.customData - Event-specific data (value, currency, contents, etc.)
 * @param {object} options.request - HTTP request object for IP/user-agent extraction
 * @param {object} options.settings - Optional settings override (pixelId, accessToken, etc.)
 * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
 */
export const sendConversionEvent = async (eventName, options = {}) => {
  const {
    eventId,
    eventSourceUrl,
    userData = {},
    customData = {},
    request = {},
    settings = {}
  } = options;

  const config = resolveConfig(settings);

  if (!isConversionsApiConfigured(config)) {
    console.warn('[MetaConversions] Not configured - skipping event:', eventName);
    return { success: false, error: 'Conversions API not configured' };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const finalEventId = eventId || `${eventName}_${eventTime}_${crypto.randomUUID()}`;

  // Build the event payload
  const eventPayload = {
    event_name: eventName,
    event_time: eventTime,
    event_id: finalEventId,
    action_source: 'website',
    user_data: buildUserData(userData, request),
    custom_data: buildCustomData(customData)
  };

  // Add event source URL if provided
  if (eventSourceUrl) {
    eventPayload.event_source_url = eventSourceUrl;
  }

  // Full request payload
  const payload = {
    data: [eventPayload]
  };

  // Add test event code if in test mode
  if (config.testEventCode) {
    payload.test_event_code = config.testEventCode;
  }

  const url = `${GRAPH_API_BASE}/${config.graphVersion}/${config.pixelId}/events`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...payload,
        access_token: config.accessToken
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[MetaConversions] API error:', result);
      return {
        success: false,
        eventId: finalEventId,
        error: result.error?.message || `HTTP ${response.status}`
      };
    }

    console.log('[MetaConversions] Event sent successfully:', eventName, finalEventId, result);
    return {
      success: true,
      eventId: finalEventId,
      eventsReceived: result.events_received
    };
  } catch (error) {
    console.error('[MetaConversions] Network error:', error);
    return {
      success: false,
      eventId: finalEventId,
      error: error?.message || 'Network error'
    };
  }
};

/**
 * Send Purchase event after successful order
 */
export const trackPurchase = async (order, request = {}, settings = {}) => {
  if (!order) return { success: false, error: 'No order provided' };

  const customerInfo = order.customerInfo || {};
  const shippingAddress = order.shippingAddress || {};
  const items = order.items || [];

  const userData = {
    email: customerInfo.email,
    phone: customerInfo.mobile || customerInfo.phone,
    firstName: customerInfo.firstName,
    lastName: customerInfo.lastName,
    city: shippingAddress.city,
    country: shippingAddress.country,
    externalId: order.userId || order.user || customerInfo.email,
    fbc: order.fbc,
    fbp: order.fbp
  };

  const contents = items.map((item) => ({
    id: String(item.product?._id || item.product || item.productId || ''),
    quantity: Number(item.quantity) || 1,
    price: Number(item.price) || 0
  }));

  const customData = {
    currency: order.currency || 'ILS',
    value: Number(order.totalAmount) || contents.reduce((sum, c) => sum + c.price * c.quantity, 0),
    contentIds: contents.map((c) => c.id),
    contentType: 'product',
    contents,
    numItems: contents.reduce((sum, c) => sum + c.quantity, 0),
    orderId: String(order._id || order.orderId || '')
  };

  return sendConversionEvent('Purchase', {
    eventId: order.eventId || `Purchase_${order._id}`,
    eventSourceUrl: order.sourceUrl || settings.publicWebUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send AddToCart event
 */
export const trackAddToCart = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    currency: data.currency || 'ILS',
    value: Number(data.value) || Number(data.price) || 0,
    contentIds: data.contentIds || [data.productId],
    contentType: 'product',
    contentName: data.productName,
    contents: data.contents || [{
      id: String(data.productId || ''),
      quantity: Number(data.quantity) || 1,
      price: Number(data.price) || 0
    }]
  };

  return sendConversionEvent('AddToCart', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send ViewContent event
 */
export const trackViewContent = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    currency: data.currency || 'ILS',
    value: Number(data.value) || Number(data.price) || 0,
    contentIds: data.contentIds || [data.productId],
    contentType: 'product',
    contentName: data.productName,
    contentCategory: data.category
  };

  return sendConversionEvent('ViewContent', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send InitiateCheckout event
 */
export const trackInitiateCheckout = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    currency: data.currency || 'ILS',
    value: Number(data.value) || 0,
    contentIds: data.contentIds,
    contentType: 'product',
    contents: data.contents,
    numItems: Number(data.numItems) || data.contents?.length || 0
  };

  return sendConversionEvent('InitiateCheckout', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send CompleteRegistration event
 */
export const trackCompleteRegistration = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    firstName: data.firstName,
    lastName: data.lastName,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    registrationMethod: data.registrationMethod || 'website'
  };

  return sendConversionEvent('CompleteRegistration', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send Search event
 */
export const trackSearch = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    searchString: data.searchString || data.query,
    contentIds: data.contentIds,
    contentCategory: data.category
  };

  return sendConversionEvent('Search', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

/**
 * Send Lead event
 */
export const trackLead = async (data, request = {}, settings = {}) => {
  const userData = {
    email: data.email,
    phone: data.phone,
    firstName: data.firstName,
    lastName: data.lastName,
    externalId: data.userId,
    fbc: data.fbc,
    fbp: data.fbp
  };

  const customData = {
    currency: data.currency,
    value: data.value,
    contentName: data.contentName,
    contentCategory: data.contentCategory
  };

  return sendConversionEvent('Lead', {
    eventId: data.eventId,
    eventSourceUrl: data.sourceUrl,
    userData,
    customData,
    request,
    settings
  });
};

export default {
  sendConversionEvent,
  trackPurchase,
  trackAddToCart,
  trackViewContent,
  trackInitiateCheckout,
  trackCompleteRegistration,
  trackSearch,
  trackLead,
  isConversionsApiConfigured
};
