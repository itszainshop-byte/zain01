import { getCurrentTenantId } from '../../utils/tenantContext.js';

const QUERY_METHODS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne'
];

function hasTenantConstraint(filter, field) {
  if (!filter || typeof filter !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(filter, field)) return true;
  if (Array.isArray(filter.$and)) {
    return filter.$and.some((entry) => hasTenantConstraint(entry, field));
  }
  return false;
}

export default function tenantScopedModel(schema, options = {}) {
  const fieldName = options.fieldName || 'tenantId';
  const defaultTenant = options.defaultTenant || (() => getCurrentTenantId());
  const required = options.required !== false;

  if (!schema.path(fieldName)) {
    schema.add({
      [fieldName]: {
        type: String,
        required,
        index: true,
        default: defaultTenant,
        trim: true,
        lowercase: true
      }
    });
  }

  schema.pre('validate', function(next) {
    if (!this[fieldName]) {
      this[fieldName] = defaultTenant();
    }
    next();
  });

  for (const method of QUERY_METHODS) {
    schema.pre(method, function(next) {
      if (this.getOptions?.()?.bypassTenantScope) return next();
      const tenantId = getCurrentTenantId();
      const filter = this.getFilter?.() || {};
      if (!hasTenantConstraint(filter, fieldName)) {
        this.where({ [fieldName]: tenantId });
      }
      next();
    });
  }

  schema.pre('aggregate', function(next) {
    if (this.options?.bypassTenantScope) return next();
    const tenantId = getCurrentTenantId();
    const pipeline = this.pipeline();
    const alreadyScoped = pipeline.some((stage) => stage?.$match && hasTenantConstraint(stage.$match, fieldName));
    if (!alreadyScoped) {
      if (pipeline[0]?.$geoNear) {
        pipeline.splice(1, 0, { $match: { [fieldName]: tenantId } });
      } else {
        pipeline.unshift({ $match: { [fieldName]: tenantId } });
      }
    }
    next();
  });

  schema.pre('save', function(next) {
    if (!this[fieldName]) {
      this[fieldName] = getCurrentTenantId();
    }
    next();
  });
}
