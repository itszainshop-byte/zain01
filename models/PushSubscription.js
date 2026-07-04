import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

pushSubscriptionSchema.index({ tenantId: 1, endpoint: 1 }, { unique: true });

pushSubscriptionSchema.plugin(tenantScopedModel);

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export default PushSubscription;
