import { resolveTenantIdFromRequest, runWithTenantContext } from '../utils/tenantContext.js';

export function tenantContext(req, res, next) {
  const tenantId = resolveTenantIdFromRequest(req);
  req.tenantId = tenantId;
  res.setHeader('X-Tenant-Id', tenantId);

  return runWithTenantContext(tenantId, () => next());
}
