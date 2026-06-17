/**
 * Meta Conversions API Routes
 * Server-side endpoints for receiving events from the frontend
 * and forwarding them to Meta Conversions API
 */

import express from 'express';
import {
  sendConversionEvent,
  trackAddToCart,
  trackViewContent,
  trackInitiateCheckout,
  trackSearch,
  trackLead,
  isConversionsApiConfigured
} from '../services/metaConversionsService.js';
import Settings from '../models/Settings.js';

const router = express.Router();

/**
 * Helper to extract client info from request
 */
const extractRequestInfo = (req) => ({
  ip: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  userAgent: req.headers['user-agent'],
  clientIp: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
});

/**
 * Helper to get Conversions API settings
 */
const getSettings = async (body = {}) => {
  try {
    const settings = await Settings.findOne().lean();
    const facebookPixel = settings?.facebookPixel || {};
    
    return {
      pixelId: facebookPixel.pixelId || process.env.META_PIXEL_ID || '',
      accessToken: facebookPixel.conversionsAccessToken || process.env.META_CONVERSIONS_ACCESS_TOKEN || '',
      testEventCode: facebookPixel.testEventCode || process.env.META_TEST_EVENT_CODE || '',
      publicWebUrl: process.env.PUBLIC_WEB_URL || ''
    };
  } catch (error) {
    console.error('[MetaConversions] Error loading settings:', error);
    return {
      pixelId: process.env.META_PIXEL_ID || '',
      accessToken: process.env.META_CONVERSIONS_ACCESS_TOKEN || '',
      testEventCode: process.env.META_TEST_EVENT_CODE || '',
      publicWebUrl: process.env.PUBLIC_WEB_URL || ''
    };
  }
};

/**
 * POST /api/conversions/event
 * Generic event endpoint for any standard or custom event
 */
router.post('/event', async (req, res) => {
  try {
    const { eventName, eventId, userData, customData, sourceUrl } = req.body;

    if (!eventName) {
      return res.status(400).json({ success: false, error: 'eventName is required' });
    }

    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ 
        success: false, 
        error: 'Conversions API not configured',
        skipped: true 
      });
    }

    const result = await sendConversionEvent(eventName, {
      eventId,
      eventSourceUrl: sourceUrl,
      userData: userData || {},
      customData: customData || {},
      request: extractRequestInfo(req),
      settings
    });

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /event error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Internal error' });
  }
});

/**
 * POST /api/conversions/view-content
 * Track product view
 */
router.post('/view-content', async (req, res) => {
  try {
    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ success: false, skipped: true });
    }

    const result = await trackViewContent(
      { ...req.body, sourceUrl: req.body.sourceUrl },
      extractRequestInfo(req),
      settings
    );

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /view-content error:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * POST /api/conversions/add-to-cart
 * Track add to cart
 */
router.post('/add-to-cart', async (req, res) => {
  try {
    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ success: false, skipped: true });
    }

    const result = await trackAddToCart(
      { ...req.body, sourceUrl: req.body.sourceUrl },
      extractRequestInfo(req),
      settings
    );

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /add-to-cart error:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * POST /api/conversions/initiate-checkout
 * Track checkout initiation
 */
router.post('/initiate-checkout', async (req, res) => {
  try {
    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ success: false, skipped: true });
    }

    const result = await trackInitiateCheckout(
      { ...req.body, sourceUrl: req.body.sourceUrl },
      extractRequestInfo(req),
      settings
    );

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /initiate-checkout error:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * POST /api/conversions/search
 * Track search
 */
router.post('/search', async (req, res) => {
  try {
    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ success: false, skipped: true });
    }

    const result = await trackSearch(
      { ...req.body, sourceUrl: req.body.sourceUrl },
      extractRequestInfo(req),
      settings
    );

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /search error:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * POST /api/conversions/lead
 * Track lead submission
 */
router.post('/lead', async (req, res) => {
  try {
    const settings = await getSettings();
    
    if (!isConversionsApiConfigured(settings)) {
      return res.status(200).json({ success: false, skipped: true });
    }

    const result = await trackLead(
      { ...req.body, sourceUrl: req.body.sourceUrl },
      extractRequestInfo(req),
      settings
    );

    res.json(result);
  } catch (error) {
    console.error('[MetaConversions] /lead error:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * GET /api/conversions/status
 * Check if Conversions API is configured (for diagnostics)
 */
router.get('/status', async (req, res) => {
  try {
    const settings = await getSettings();
    const configured = isConversionsApiConfigured(settings);
    
    res.json({
      configured,
      hasPixelId: !!settings.pixelId,
      hasAccessToken: !!settings.accessToken,
      testMode: !!settings.testEventCode
    });
  } catch (error) {
    res.status(500).json({ configured: false, error: error?.message });
  }
});

export default router;
