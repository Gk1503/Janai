import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
	line1: { type: String, trim: true, default: '' },
	line2: { type: String, trim: true, default: '' },
	city: { type: String, trim: true, default: '' },
	state: { type: String, trim: true, default: '' },
	postalCode: { type: String, trim: true, default: '' },
}, { _id: false });

const dayHoursSchema = new mongoose.Schema({
	closed: { type: Boolean, default: false },
	open: { type: String, default: '09:00' },
	close: { type: String, default: '21:00' },
}, { _id: false });

const operatingHoursSchema = new mongoose.Schema({
	monday: { type: dayHoursSchema, default: () => ({}) },
	tuesday: { type: dayHoursSchema, default: () => ({}) },
	wednesday: { type: dayHoursSchema, default: () => ({}) },
	thursday: { type: dayHoursSchema, default: () => ({}) },
	friday: { type: dayHoursSchema, default: () => ({}) },
	saturday: { type: dayHoursSchema, default: () => ({}) },
	sunday: { type: dayHoursSchema, default: () => ({}) },
}, { _id: false });

// Defaults here (true/25/500/0) are exactly today's hardcoded rule in orderController.js
// (₹25 delivery below a ₹500 subtotal, delivery always on, no minimum), so a never-configured store
// behaves identically to before this category existed.
const orderSettingsSchema = new mongoose.Schema({
	deliveryEnabled: { type: Boolean, default: true },
	deliveryFee: { type: Number, min: 0, default: 25 },
	freeDeliveryThreshold: { type: Number, min: 0, default: 500 },
	minimumOrderValue: { type: Number, min: 0, default: 0 },
}, { _id: false });

// Customer SMS notifications. Every switch defaults to false: no customer is ever messaged until the
// owner explicitly turns notifications on, including on an existing settings document that predates
// this category (a missing sub-object reads as all-off).
const notificationSettingsSchema = new mongoose.Schema({
	enabled: { type: Boolean, default: false },
	orderPlaced: { type: Boolean, default: false },
	outForDelivery: { type: Boolean, default: false },
	delivered: { type: Boolean, default: false },
	orderCancelled: { type: Boolean, default: false },
}, { _id: false });

// Universal Pricing: owner-configured markup rules matched against a product's purchase price.
// Boundary convention: minPurchasePrice is inclusive, maxPurchasePrice is exclusive; a rule with no
// maxPurchasePrice (null) is the open-ended final range. Keeps a normal auto-assigned _id (like
// Product.js's vendorSchema) since this is a repeatable, owner-editable list — unlike the single
// fixed-shape sub-objects below (address, operating hours, orderSettings), which use `_id: false`.
const pricingRuleSchema = new mongoose.Schema({
	minPurchasePrice: { type: Number, required: true, min: 0 },
	maxPurchasePrice: { type: Number, min: 0, default: null },
	fixedProfit: { type: Number, min: 0, default: 0 },
	profitPercent: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

// Single canonical business-settings document. Controllers always read/write via Settings.findOne({})
// (or an upsert against {}), never by a caller-supplied id, so a second document can never be created
// through normal use. `general`, `orderSettings`, `notifications` and `pricingRules` are the categories
// implemented so far (Payments and Security & System are later steps) but each lives in its own
// sub-object so those can be added as siblings later without disturbing these.
const settingsSchema = new mongoose.Schema({
	general: {
		businessName: { type: String, trim: true, default: 'Janai' },
		// Base64 data URL, same storage pattern as Product.images (see models/Product.js) — no separate
		// file-upload/CDN infrastructure exists in this project, so this reuses the established approach.
		logo: { type: String, default: '' },
		phone: { type: String, trim: true, default: '' },
		email: { type: String, trim: true, lowercase: true, default: '' },
		address: { type: addressSchema, default: () => ({}) },
		operatingHours: { type: operatingHoursSchema, default: () => ({}) },
	},
	orderSettings: { type: orderSettingsSchema, default: () => ({}) },
	notifications: { type: notificationSettingsSchema, default: () => ({}) },
	// Never configured = no universal rules = no universal suggestion shown anywhere. Existing product
	// prices are never touched by this field; nothing reads it except the Settings API itself.
	pricingRules: { type: [pricingRuleSchema], default: [] },
	updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
