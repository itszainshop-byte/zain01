import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
	singleLink,
	bulkLinksByIds,
	bulkLinksByFilter,
	handleInbound,
	handleMetaWebhook,
	handleMetaWebhookVerify,
	listInbound,
	sendOutbound
} from '../controllers/whatsappController.js';
import WhatsAppAudit from '../models/WhatsAppAudit.js';

const router = express.Router();

// Meta WhatsApp Cloud API webhook verification + inbound events
router.get('/webhook', handleMetaWebhookVerify);
router.post('/webhook', handleMetaWebhook);
// Legacy incoming endpoint (now forwards to Meta webhook handler)
router.post('/incoming', handleInbound);
// Admin listing of inbound messages
router.get('/incoming', adminAuth, listInbound);
// Admin send outbound WhatsApp via Meta Cloud API
router.post('/send', adminAuth, sendOutbound);

// Generate a single WhatsApp chat link
router.post('/link', adminAuth, singleLink);
// Generate links for selected customer IDs
router.post('/links/ids', adminAuth, bulkLinksByIds);
// Generate links for all (optionally limited) filtered users
router.post('/links/filter', adminAuth, bulkLinksByFilter);

// List audits (simple)
router.get('/audits', adminAuth, async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);
		const audits = await WhatsAppAudit.find().sort({ createdAt: -1 }).limit(limit).select('-messageHash').lean();
		res.json({ audits });
	} catch (e) {
		res.status(500).json({ message: 'Failed to load audits' });
	}
});

export default router;
