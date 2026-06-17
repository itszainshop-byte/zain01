import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  createOrder,
  getUserOrders,
  getAllOrders,
  getOrderPublic,
  updateOrderStatus,
  updateOrderStatusByNumber,
  recalculateShipping,
  updateOrder,
  deleteOrder
} from '../controllers/orderController.js';

const router = express.Router();

// Public routes (guest checkout)
router.post('/', (req, res, next) => {
  console.log('POST /orders route hit');
  next();
}, createOrder);

// Protected routes
router.get('/my-orders', auth, getUserOrders);

// Admin routes (must be before catch-all '/:id')
router.get('/all', adminAuth, getAllOrders);
router.put('/status-by-number', adminAuth, updateOrderStatusByNumber);
router.patch('/status-by-number', adminAuth, updateOrderStatusByNumber);
router.put('/status/by-number', adminAuth, updateOrderStatusByNumber);
router.patch('/status/by-number', adminAuth, updateOrderStatusByNumber);

// Public order details (guest checkout flow)
router.get('/:id', getOrderPublic);
router.put('/:id/status', adminAuth, updateOrderStatus);
// Full admin update (customer info, shipping address, status, fee)
router.put('/:id', adminAuth, updateOrder);
router.post('/:id/recalculate-shipping', adminAuth, recalculateShipping);
router.delete('/:id', adminAuth, deleteOrder);

export default router;