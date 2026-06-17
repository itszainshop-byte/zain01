import express from 'express';
import multer from 'multer';
import {
  createMeshulamSessionFromCartHandler,
  meshulamCallbackHandler,
  confirmMeshulamSessionHandler,
  getMeshulamSessionOrderHandler,
  manualApproveMeshulamHandler
} from '../controllers/meshulamController.js';

const router = express.Router();
const upload = multer();

// Create Meshulam payment session from cart payload
router.post('/session-from-cart', createMeshulamSessionFromCartHandler);

// Grow/Meshulam server-to-server callback
router.post('/callback', upload.none(), meshulamCallbackHandler);

// Manually approve a transaction (iframe Grow flows)
router.post('/approve', upload.none(), manualApproveMeshulamHandler);

// Confirm a paid session (idempotent)
router.post('/session/confirm', confirmMeshulamSessionHandler);

// Fetch session + order linkage
router.get('/session/:sessionId/order', getMeshulamSessionOrderHandler);

export default router;
