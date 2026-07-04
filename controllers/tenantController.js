import Tenant from '../models/Tenant.js';

function normalizeTenantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

export const createTenant = async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const name = String(req.body?.name || '').trim();
    const status = String(req.body?.status || 'active').toLowerCase();
    const notes = String(req.body?.notes || '').trim();
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const rawDomains = Array.isArray(req.body?.domains) ? req.body.domains : [];

    if (!tenantId || tenantId.length < 2) {
      return badRequest(res, 'tenantId is required (min 2 chars, lowercase letters/numbers/_/-).');
    }
    if (!name) {
      return badRequest(res, 'name is required.');
    }
    if (!['active', 'suspended'].includes(status)) {
      return badRequest(res, 'status must be active or suspended.');
    }

    const domains = rawDomains
      .map((d) => ({
        host: normalizeHost(typeof d === 'string' ? d : d?.host),
        isPrimary: typeof d === 'object' && d?.isPrimary === true
      }))
      .filter((d) => d.host);

    const tenant = await Tenant.create({
      tenantId,
      name,
      status,
      notes,
      metadata,
      domains,
      createdBy: req.user?._id,
      updatedBy: req.user?._id
    });

    return res.status(201).json(tenant);
  } catch (error) {
    if (error?.code === 11000) {
      if (error?.keyPattern?.tenantId) {
        return res.status(409).json({ message: 'tenantId already exists.' });
      }
      if (error?.keyPattern?.['domains.host']) {
        return res.status(409).json({ message: 'domain is already assigned to another tenant.' });
      }
      return res.status(409).json({ message: 'Duplicate key conflict.' });
    }
    console.error('[tenant][createTenant] error:', error);
    return res.status(500).json({ message: 'Failed to create tenant.' });
  }
};

export const listTenants = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();

    const query = {};
    if (status && ['active', 'suspended'].includes(status)) query.status = status;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { tenantId: rx },
        { name: rx },
        { 'domains.host': rx }
      ];
    }

    const [items, total] = await Promise.all([
      Tenant.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Tenant.countDocuments(query)
    ]);

    return res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    console.error('[tenant][listTenants] error:', error);
    return res.status(500).json({ message: 'Failed to list tenants.' });
  }
};

export const getTenant = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const query = id.match(/^[a-fA-F0-9]{24}$/)
      ? { _id: id }
      : { tenantId: normalizeTenantId(id) };

    const tenant = await Tenant.findOne(query).lean();
    if (!tenant) return res.status(404).json({ message: 'Tenant not found.' });
    return res.json(tenant);
  } catch (error) {
    console.error('[tenant][getTenant] error:', error);
    return res.status(500).json({ message: 'Failed to get tenant.' });
  }
};

export const updateTenant = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const tenant = await Tenant.findOne(id.match(/^[a-fA-F0-9]{24}$/) ? { _id: id } : { tenantId: normalizeTenantId(id) });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found.' });

    const nextName = req.body?.name;
    const nextStatus = req.body?.status;
    const nextNotes = req.body?.notes;
    const nextMetadata = req.body?.metadata;

    if (nextName !== undefined) {
      const name = String(nextName || '').trim();
      if (!name) return badRequest(res, 'name cannot be empty.');
      tenant.name = name;
    }

    if (nextStatus !== undefined) {
      const status = String(nextStatus || '').toLowerCase();
      if (!['active', 'suspended'].includes(status)) return badRequest(res, 'status must be active or suspended.');
      tenant.status = status;
    }

    if (nextNotes !== undefined) {
      tenant.notes = String(nextNotes || '').trim();
    }

    if (nextMetadata !== undefined) {
      if (!nextMetadata || typeof nextMetadata !== 'object' || Array.isArray(nextMetadata)) {
        return badRequest(res, 'metadata must be an object.');
      }
      tenant.metadata = nextMetadata;
    }

    if (req.body?.domains !== undefined) {
      if (!Array.isArray(req.body.domains)) return badRequest(res, 'domains must be an array.');
      tenant.domains = req.body.domains
        .map((d) => ({
          host: normalizeHost(typeof d === 'string' ? d : d?.host),
          isPrimary: typeof d === 'object' && d?.isPrimary === true
        }))
        .filter((d) => d.host);
    }

    tenant.updatedBy = req.user?._id;
    await tenant.save();

    return res.json(tenant);
  } catch (error) {
    if (error?.code === 11000) {
      if (error?.keyPattern?.['domains.host']) {
        return res.status(409).json({ message: 'domain is already assigned to another tenant.' });
      }
      return res.status(409).json({ message: 'Duplicate key conflict.' });
    }
    console.error('[tenant][updateTenant] error:', error);
    return res.status(500).json({ message: 'Failed to update tenant.' });
  }
};

export const setTenantStatus = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').toLowerCase();
    if (!['active', 'suspended'].includes(status)) {
      return badRequest(res, 'status must be active or suspended.');
    }

    const tenant = await Tenant.findOneAndUpdate(
      id.match(/^[a-fA-F0-9]{24}$/) ? { _id: id } : { tenantId: normalizeTenantId(id) },
      { $set: { status, updatedBy: req.user?._id } },
      { new: true }
    );

    if (!tenant) return res.status(404).json({ message: 'Tenant not found.' });
    return res.json(tenant);
  } catch (error) {
    console.error('[tenant][setTenantStatus] error:', error);
    return res.status(500).json({ message: 'Failed to update tenant status.' });
  }
};

export const addTenantDomain = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const host = normalizeHost(req.body?.host);
    const isPrimary = req.body?.isPrimary === true;

    if (!host) return badRequest(res, 'host is required.');

    const tenant = await Tenant.findOne(id.match(/^[a-fA-F0-9]{24}$/) ? { _id: id } : { tenantId: normalizeTenantId(id) });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found.' });

    if (!tenant.domains.some((d) => d.host === host)) {
      tenant.domains.push({ host, isPrimary });
    }

    if (isPrimary) {
      tenant.domains = tenant.domains.map((d) => ({ host: d.host, isPrimary: d.host === host }));
    }

    tenant.updatedBy = req.user?._id;
    await tenant.save();

    return res.json(tenant);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.['domains.host']) {
      return res.status(409).json({ message: 'domain is already assigned to another tenant.' });
    }
    console.error('[tenant][addTenantDomain] error:', error);
    return res.status(500).json({ message: 'Failed to add domain.' });
  }
};

export const removeTenantDomain = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const host = normalizeHost(req.body?.host || req.query?.host);
    if (!host) return badRequest(res, 'host is required.');

    const tenant = await Tenant.findOne(id.match(/^[a-fA-F0-9]{24}$/) ? { _id: id } : { tenantId: normalizeTenantId(id) });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found.' });

    tenant.domains = tenant.domains.filter((d) => d.host !== host);
    if (tenant.domains.length > 0 && !tenant.domains.some((d) => d.isPrimary)) {
      tenant.domains[0].isPrimary = true;
    }

    tenant.updatedBy = req.user?._id;
    await tenant.save();

    return res.json(tenant);
  } catch (error) {
    console.error('[tenant][removeTenantDomain] error:', error);
    return res.status(500).json({ message: 'Failed to remove domain.' });
  }
};
