import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: false, trim: true },
    name_i18n: { type: Map, of: String, default: undefined },
    // SEO-friendly identifier; optional historically, now recommended
    slug: { type: String, required: false, trim: true, lowercase: true, index: true, sparse: true },
  label: { type: String, required: false, trim: true },
  label_i18n: { type: Map, of: String, default: undefined },
  labelImageUrl: { type: String, required: false },
    imageUrl: { type: String, required: false },
    linkUrl: { type: String, required: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

brandSchema.index({ tenantId: 1, slug: 1 }, { unique: true, sparse: true });
brandSchema.plugin(tenantScopedModel);

export default mongoose.model('Brand', brandSchema);
