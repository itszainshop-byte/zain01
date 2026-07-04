import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

function normalizeTenantId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  // Restrict tenant ids to URL/header safe characters.
  return raw.replace(/[^a-z0-9_-]/g, '');
}

export function getDefaultTenantId() {
  return normalizeTenantId(process.env.DEFAULT_TENANT_ID) || 'default';
}

export function resolveTenantIdFromRequest(req) {
  const headerTenant = normalizeTenantId(req.header('x-tenant-id'));
  if (headerTenant) return headerTenant;

  const queryTenant = normalizeTenantId(req.query?.tenant);
  if (queryTenant) return queryTenant;

  // Support subdomain-based tenant resolution: tenant.example.com
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const hostname = host.split(':')[0];
  if (hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length >= 3 && parts[0] !== 'www') {
      const subdomainTenant = normalizeTenantId(parts[0]);
      if (subdomainTenant) return subdomainTenant;
    }
  }

  return getDefaultTenantId();
}

export function runWithTenantContext(tenantId, fn) {
  const normalized = normalizeTenantId(tenantId) || getDefaultTenantId();
  return storage.run({ tenantId: normalized }, fn);
}

export function getCurrentTenantId() {
  const current = storage.getStore()?.tenantId;
  return normalizeTenantId(current) || getDefaultTenantId();
}

export function getTenantContext() {
  return storage.getStore() || { tenantId: getDefaultTenantId() };
}
