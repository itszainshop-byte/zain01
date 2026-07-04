import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const currencyRateSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  exchangeRate: {
    type: Number,
    required: true,
    min: 0
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

currencyRateSchema.index({ tenantId: 1, code: 1 }, { unique: true });

currencyRateSchema.plugin(tenantScopedModel);

const CurrencyRate = mongoose.model('CurrencyRate', currencyRateSchema);
export default CurrencyRate;
