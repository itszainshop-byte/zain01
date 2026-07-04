import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const cancellationRequestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  order: { type: String, trim: true },
  content: { type: String, required: true, trim: true },
  optIn: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'resolved'], default: 'pending', index: true }
}, { timestamps: true });

cancellationRequestSchema.plugin(tenantScopedModel);

const CancellationRequest = mongoose.model('CancellationRequest', cancellationRequestSchema);
export default CancellationRequest;
