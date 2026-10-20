import mongoose from 'mongoose';
import { statusHistoryField } from '../utils/statusAudit.js';

const itemSchema = new mongoose.Schema({
	product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
	name: { type: String, required: true },
	image: { type: String, default: '' },
	price: { type: Number, min: 0, required: true },
	unit: { type: String, required: true },
	quantity: { type: Number, min: 1, required: true },
}, { _id: false });

const addressSchema = new mongoose.Schema({
	recipient: { type: String, required: true, trim: true },
	phone: { type: String, required: true, trim: true },
	house: { type: String, trim: true, default: '' },
	street: { type: String, required: true, trim: true },
	landmark: { type: String, trim: true, default: '' },
	city: { type: String, trim: true, default: '' },
	state: { type: String, trim: true, default: '' },
	postalCode: { type: String, required: true, trim: true },
}, { _id: false });

const orderSchema = new mongoose.Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
	items: { type: [itemSchema], validate: [(items) => items.length > 0, 'An order needs at least one item'] },
	totalAmount: { type: Number, min: 0, required: true },
	orderType: { type: String, enum: ['normal', 'preorder', 'bulk'], default: 'normal', index: true },
	deliveryAddress: { type: addressSchema, required: true },
	deliveryDate: { type: Date, required: true },
	preferredTimeSlot: { type: String, trim: true, default: '' },
	deliveryInstructions: { type: String, trim: true, maxlength: 300, default: '' },
	paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
	paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
	orderStatus: { type: String, enum: ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'], default: 'placed', index: true },
	// Who is currently assigned to deliver this order, and when. Assignment is independent of orderStatus —
	// setting it never changes the status, and it is never set automatically by a status change either.
	assignedDeliveryStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
	assignedAt: { type: Date, default: null },
	// Append-only audit trail of status changes; excluded from queries unless explicitly selected.
	statusHistory: statusHistoryField,
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
