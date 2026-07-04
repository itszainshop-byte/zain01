import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const mcgItemBlockSchema = new mongoose.Schema({
  barcode: { type: String, trim: true },
  mcgItemId: { type: String, trim: true },
  reason: { type: String, default: 'hard_delete' },
  notes: { type: String, default: '' },
  lastProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  lastProductName: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

mcgItemBlockSchema.pre('validate', function(next) {
  if (!this.barcode && !this.mcgItemId) {
    return next(new Error('McgItemBlock requires either barcode or mcgItemId.'));
  }
  next();
});

mcgItemBlockSchema.index(
  { tenantId: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $type: 'string', $ne: '' } }
  }
);

mcgItemBlockSchema.index(
  { tenantId: 1, mcgItemId: 1 },
  {
    unique: true,
    partialFilterExpression: { mcgItemId: { $type: 'string', $ne: '' } }
  }
);

mcgItemBlockSchema.plugin(tenantScopedModel);

export default mongoose.models.McgItemBlock || mongoose.model('McgItemBlock', mcgItemBlockSchema);
