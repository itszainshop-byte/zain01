import mongoose from 'mongoose';

const whatsappInboundSchema = new mongoose.Schema({
  direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound', index: true },
  status: { type: String, default: 'received', index: true },
  errorMessage: { type: String },
  from: { type: String, index: true },
  waId: { type: String, index: true },
  profileName: { type: String },
  body: { type: String },
  to: { type: String },
  messageSid: { type: String, index: true },
  numMedia: { type: Number, default: 0 },
  media: [{
    url: { type: String },
    contentType: { type: String }
  }],
  matchedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  raw: { type: Object },
  receivedAt: { type: Date, default: Date.now }
}, { timestamps: true });

whatsappInboundSchema.index({ createdAt: -1 });

const WhatsAppInboundMessage = mongoose.model('WhatsAppInboundMessage', whatsappInboundSchema);

export default WhatsAppInboundMessage;
