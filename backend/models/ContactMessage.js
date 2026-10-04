import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  subject: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true, maxlength: 3000 },
  status: { type: String, enum: ['new', 'resolved'], default: 'new' },
}, { timestamps: true });

export default mongoose.model('ContactMessage', contactMessageSchema);
