import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const warehouseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  address: {
    type: String
  },
  contact: {
    type: String
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

warehouseSchema.index({ tenantId: 1, name: 1 }, { unique: true });

warehouseSchema.plugin(tenantScopedModel);

export default mongoose.model('Warehouse', warehouseSchema);
