import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const mobilePushTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  expoPushToken: { type: String, required: true },
  device: {
    manufacturer: String,
    modelName: String,
    osName: String,
    osVersion: String,
    appVersion: String
  },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

mobilePushTokenSchema.index({ tenantId: 1, expoPushToken: 1 }, { unique: true });
mobilePushTokenSchema.index({ user: 1, updatedAt: -1 });

mobilePushTokenSchema.plugin(tenantScopedModel);

const MobilePushToken = mongoose.model('MobilePushToken', mobilePushTokenSchema);

export default MobilePushToken;
