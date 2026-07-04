import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const mcgArchivedItemSchema = new mongoose.Schema({
  barcode: { type: String, trim: true },
  mcgItemId: { type: String, trim: true },
  reason: { type: String, default: 'manual_archive' },
  notes: { type: String, default: '' },
  lastProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  lastProductName: { type: String, default: '' },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archivedAt: { type: Date, default: () => new Date() }
}, {
  timestamps: true
});

mcgArchivedItemSchema.pre('validate', function(next) {
  if (!this.barcode && !this.mcgItemId) {
    return next(new Error('McgArchivedItem requires either barcode or mcgItemId.'));
  }
  next();
});

mcgArchivedItemSchema.index(
  { tenantId: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $type: 'string', $ne: '' } }
  }
);

mcgArchivedItemSchema.index(
  { tenantId: 1, mcgItemId: 1 },
  {
    unique: true,
    partialFilterExpression: { mcgItemId: { $type: 'string', $ne: '' } }
  }
);

mcgArchivedItemSchema.plugin(tenantScopedModel);

export default mongoose.models.McgArchivedItem || mongoose.model('McgArchivedItem', mcgArchivedItemSchema);
