import mongoose from 'mongoose';

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
	street: { type: String, required: true, trim: true },
	city: { type: String, required: true, trim: true },
	state: { type: String, required: true, trim: true },
	postalCode: { type: String, required: true, trim: true },
}, { _id: false });

const orderSchema = new mongoose.Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
	items: { type: [itemSchema], validate: [(items) => items.length > 0, 'An order needs at least one item'] },
	totalAmount: { type: Number, min: 0, required: true },
	orderType: { type: String, enum: ['normal', 'preorder', 'bulk'], default: 'normal', index: true },
	deliveryAddress: { type: addressSchema, required: true },
	deliveryDate: { type: Date, required: true },
	paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
	paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
	orderStatus: { type: String, enum: ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'], default: 'placed', index: true },
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
