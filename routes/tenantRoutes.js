import express from 'express';
import {
  addTenantDomain,
  createTenant,
  getTenant,
  listTenants,
  removeTenantDomain,
  setTenantStatus,
  updateTenant
} from '../controllers/tenantController.js';
import { superAdminAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', superAdminAuth, listTenants);
router.post('/', superAdminAuth, createTenant);
router.get('/:id', superAdminAuth, getTenant);
router.patch('/:id', superAdminAuth, updateTenant);
router.patch('/:id/status', superAdminAuth, setTenantStatus);
router.post('/:id/domains', superAdminAuth, addTenantDomain);
router.delete('/:id/domains', superAdminAuth, removeTenantDomain);

export default router;
