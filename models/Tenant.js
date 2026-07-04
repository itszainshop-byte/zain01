import mongoose from 'mongoose';

const tenantDomainSchema = new mongoose.Schema({
  host: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  isPrimary: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const tenantSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active'
  },
  domains: {
    type: [tenantDomainSchema],
    default: []
  },
  notes: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

tenantSchema.index({ tenantId: 1 }, { unique: true });
tenantSchema.index({ status: 1 });
tenantSchema.index({ name: 1 });
tenantSchema.index({ 'domains.host': 1 }, { unique: true, sparse: true });

tenantSchema.pre('save', function(next) {
  if (Array.isArray(this.domains)) {
    const seen = new Set();
    this.domains = this.domains
      .map((d) => ({
        host: String(d?.host || '').trim().toLowerCase(),
        isPrimary: !!d?.isPrimary
      }))
      .filter((d) => d.host)
      .filter((d) => {
        if (seen.has(d.host)) return false;
        seen.add(d.host);
        return true;
      });

    if (this.domains.length > 0 && !this.domains.some((d) => d.isPrimary)) {
      this.domains[0].isPrimary = true;
    }
    if (this.domains.filter((d) => d.isPrimary).length > 1) {
      let first = true;
      this.domains = this.domains.map((d) => {
        if (!d.isPrimary) return d;
        if (first) {
          first = false;
          return d;
        }
        return { ...d, isPrimary: false };
      });
    }
  }
  next();
});

export default mongoose.model('Tenant', tenantSchema);
