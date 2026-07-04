import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const searchLogSchema = new mongoose.Schema(
  {
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    source: {
      type: String,
      enum: ['web', 'web-header', 'web-modal', 'mobile'],
      default: 'web',
      index: true,
    },
    resultsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// TTL: auto-delete logs older than 365 days
searchLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

searchLogSchema.plugin(tenantScopedModel);

const SearchLog = mongoose.model('SearchLog', searchLogSchema);
export default SearchLog;
