import mongoose from 'mongoose';

export const BULK_STATUSES = ['Pending', 'Reviewing', 'Quoted', 'Approved', 'Processing', 'Completed', 'Rejected', 'Cancelled'];
export const BULK_ORDER_TYPES = ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'];

// Allowed status changes. Rejected, Completed and Cancelled are final.
export const BULK_TRANSITIONS = {
  Pending: ['Reviewing', 'Quoted', 'Rejected', 'Cancelled'],
  Reviewing: ['Quoted', 'Rejected', 'Cancelled'],
  Quoted: ['Reviewing', 'Approved', 'Rejected', 'Cancelled'],
  Approved: ['Processing', 'Rejected'],
  Processing: ['Completed'],
  Completed: [],
  Rejected: [],
  Cancelled: [],
};

// A customer may withdraw a request only until the business has approved it.
export const CUSTOMER_CANCELLABLE = ['Pending', 'Reviewing', 'Quoted'];
// A quotation can be created or revised only while the request is still being negotiated.
export const QUOTABLE = ['Pending', 'Reviewing', 'Quoted'];

export const MAX_PRODUCT_LINES = 50;
export const MAX_QUANTITY = 10000;
export const MAX_UNIT_PRICE = 1_000_000;
export const MAX_MESSAGE_LENGTH = 1000;

export const canTransition = (from, to) => (BULK_TRANSITIONS[from] || []).includes(to);

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const money = (value) => Math.round(value * 100) / 100;

// 10-digit Indian mobile number; a leading 91 on a 12-digit value is dropped.
export function normalizeBulkPhone(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : null;
}

// Validates and normalises the lines of a new request. Only fields this function returns are ever stored,
// and a product picked from the catalogue takes its name and unit from the catalogue, not from the client.
export function validateRequestLines(products, catalogue = new Map()) {
  if (!Array.isArray(products) || !products.length) return { error: 'Add at least one product with a quantity.' };
  if (products.length > MAX_PRODUCT_LINES) return { error: `A request can include at most ${MAX_PRODUCT_LINES} products.` };
  const lines = [];
  for (const entry of products) {
    if (!entry || typeof entry !== 'object') return { error: 'Add products with valid quantities.' };
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return { error: `Quantities must be whole numbers between 1 and ${MAX_QUANTITY}.` };
    const listed = entry.productId !== undefined && entry.productId !== null && entry.productId !== '' ? catalogue.get(String(entry.productId)) : null;
    if (entry.productId && !listed) return { error: 'One of the selected products is no longer available for bulk orders.' };
    const name = listed ? listed.name : text(entry.name);
    const unit = listed ? listed.unit : (text(entry.unit) || 'kg');
    if (!name || name.length > 140) return { error: 'Each product needs a name of up to 140 characters.' };
    if (unit.length > 30) return { error: 'Units can be at most 30 characters.' };
    lines.push({ ...(listed ? { product: listed._id } : {}), name, quantity, unit });
  }
  return { lines };
}

// Builds the stored quotation. Quantities, names and units come from the saved request; the client only
// supplies selling prices per line, a delivery charge, an optional validity date and a message. Totals are
// always computed here.
export function buildQuotation(request, body, now = new Date()) {
  const allowed = ['items', 'deliveryCharge', 'validUntil', 'message'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the quotation details.' };
  const unsupported = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unsupported.length) return { error: `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.` };
  if (!Array.isArray(body.items) || body.items.length !== request.products.length) return { error: 'Enter a price for every requested product.' };

  const items = [];
  let subtotal = 0;
  for (const [index, line] of request.products.entries()) {
    const unitPrice = Number(body.items[index]?.unitPrice);
    if (body.items[index]?.unitPrice === '' || body.items[index]?.unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_UNIT_PRICE) {
      return { error: `Enter a valid price (0 to ${MAX_UNIT_PRICE}) for ${line.name}.` };
    }
    const lineTotal = money(unitPrice * line.quantity);
    subtotal += lineTotal;
    items.push({ name: line.name, quantity: line.quantity, unit: line.unit, unitPrice: money(unitPrice), lineTotal });
  }

  let deliveryCharge = 0;
  if (body.deliveryCharge !== undefined && body.deliveryCharge !== '' && body.deliveryCharge !== null) {
    deliveryCharge = Number(body.deliveryCharge);
    if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0 || deliveryCharge > MAX_UNIT_PRICE) return { error: 'Enter a valid delivery charge.' };
  }

  let validUntil = null;
  if (body.validUntil !== undefined && body.validUntil !== '' && body.validUntil !== null) {
    validUntil = new Date(body.validUntil);
    if (Number.isNaN(validUntil.getTime()) || validUntil <= now) return { error: 'The quotation validity date must be in the future.' };
  }

  const message = body.message === undefined ? '' : text(body.message);
  if (typeof (body.message ?? '') !== 'string' || message.length > MAX_MESSAGE_LENGTH) return { error: `The message can be at most ${MAX_MESSAGE_LENGTH} characters.` };

  return { quotation: { items, deliveryCharge: money(deliveryCharge), totalAmount: money(subtotal + deliveryCharge), validUntil, message, quotedAt: now } };
}

// Optional customer-visible note attached to a status change.
export function readAdminMessage(value) {
  if (value === undefined || value === null) return { value: '' };
  if (typeof value !== 'string' || value.trim().length > MAX_MESSAGE_LENGTH) return { error: `The message can be at most ${MAX_MESSAGE_LENGTH} characters.` };
  return { value: value.trim() };
}

// What a customer may see. An explicit whitelist: anything added to the model later (staff IDs, internal
// notes, history) stays hidden until it is deliberately listed here.
export function presentBulkForCustomer(request) {
  const plain = request && typeof request.toObject === 'function' ? request.toObject() : request;
  if (!plain) return plain;
  const quotation = plain.quotation && Array.isArray(plain.quotation.items) && plain.quotation.items.length
    ? {
      items: plain.quotation.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, lineTotal: item.lineTotal })),
      deliveryCharge: plain.quotation.deliveryCharge,
      totalAmount: plain.quotation.totalAmount,
      validUntil: plain.quotation.validUntil || null,
      message: plain.quotation.message || '',
      quotedAt: plain.quotation.quotedAt,
    }
    : null;
  return {
    _id: plain._id,
    name: plain.name,
    phone: plain.phone,
    email: plain.email,
    organization: plain.organization,
    orderType: plain.orderType,
    products: (plain.products || []).map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })),
    requiredDate: plain.requiredDate,
    deliveryAddress: plain.deliveryAddress,
    additionalRequirements: plain.additionalRequirements,
    status: plain.status,
    quotation,
    adminResponse: plain.adminResponse && plain.adminResponse.message ? { message: plain.adminResponse.message, at: plain.adminResponse.at || null } : null,
    canCancel: CUSTOMER_CANCELLABLE.includes(plain.status),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

export const isValidId = (id) => mongoose.isValidObjectId(id);
