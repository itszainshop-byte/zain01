import mongoose from 'mongoose';
import tenantScopedModel from './plugins/tenantScopedModel.js';

const formSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    key: { type: String, required: true }, // used in shortcode id
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

formSchema.index({ tenantId: 1, key: 1 }, { unique: true });

formSchema.statics.createDefaultForms = async function() {
  const count = await this.countDocuments();
  if (count > 0) return;
  await this.insertMany([
    { name: 'Contact Us', key: 'contact', description: 'Basic contact form' },
    { name: 'Newsletter Signup', key: 'newsletter', description: 'Email newsletter form' }
  ]);
};

formSchema.plugin(tenantScopedModel);

export default mongoose.model('Form', formSchema);
