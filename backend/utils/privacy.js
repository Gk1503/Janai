import { hasPermission } from '../config/permissions.js';

// Staff without customers:view_contact see masked email and phone. The owner and customers (who only
// ever receive their own data) are never masked.
export const shouldMaskContact = (viewer) => viewer?.role === 'staff' && !hasPermission(viewer, 'customers:view_contact');

export function maskEmail(email) {
  if (typeof email !== 'string' || !email) return email;
  const [local, domain] = email.split('@');
  return domain ? `${local[0] || ''}***@${domain}` : '***';
}

export function maskPhone(phone) {
  if (typeof phone !== 'string' || !phone) return phone;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 2 ? `${'*'.repeat(Math.max(6, digits.length - 2))}${digits.slice(-2)}` : '**';
}

export const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

function maskContactFields(person) {
  if (!person || typeof person !== 'object') return person;
  const masked = { ...person };
  if ('email' in masked) masked.email = maskEmail(masked.email);
  if ('phone' in masked) masked.phone = maskPhone(masked.phone);
  return masked;
}

export function maskOrder(order, viewer) {
  const plain = toPlain(order);
  if (!shouldMaskContact(viewer) || !plain) return plain;
  const masked = { ...plain };
  if (masked.user && typeof masked.user === 'object' && !Array.isArray(masked.user) && ('email' in masked.user || 'phone' in masked.user)) masked.user = maskContactFields(masked.user);
  if (masked.deliveryAddress) masked.deliveryAddress = { ...masked.deliveryAddress, phone: maskPhone(masked.deliveryAddress.phone) };
  return masked;
}

// Rider-only exception to maskOrder, used solely by the rider-facing endpoints in deliveryController.js
// (listMyDeliveryOrders / updateMyDeliveryOrderStatus). A delivery staff member needs the real customer
// phone number to actually complete a delivery, even without customers:view_contact — but only for the
// exact order currently assigned to them. This never grants it globally: maskOrder itself is untouched,
// every other caller (admin delivery listing, admin orders, bulk orders, etc.) keeps masking exactly as
// before, and this function re-checks the assignment itself rather than trusting the caller to have
// filtered correctly, so reusing it anywhere else can never leak a phone number by accident. Email is
// deliberately left masked — only the phone, which is what a delivery actually requires, is revealed.
export function maskOrderForAssignedRider(order, viewer) {
  const masked = maskOrder(order, viewer);
  if (!masked || !viewer?._id) return masked;
  const assignedId = masked.assignedDeliveryStaff && typeof masked.assignedDeliveryStaff === 'object'
    ? masked.assignedDeliveryStaff._id
    : masked.assignedDeliveryStaff;
  if (!assignedId || String(assignedId) !== String(viewer._id)) return masked;
  const plain = toPlain(order);
  const revealed = { ...masked };
  if (revealed.deliveryAddress) revealed.deliveryAddress = { ...revealed.deliveryAddress, phone: plain.deliveryAddress?.phone };
  if (revealed.user && typeof revealed.user === 'object' && !Array.isArray(revealed.user) && 'phone' in revealed.user) {
    revealed.user = { ...revealed.user, phone: plain.user?.phone };
  }
  return revealed;
}

export function maskBulkOrder(request, viewer) {
  const plain = toPlain(request);
  if (!shouldMaskContact(viewer) || !plain) return plain;
  return maskContactFields(plain);
}

// For user documents already converted with toSafeJSON().
export function maskUser(user, viewer) {
  if (!shouldMaskContact(viewer) || !user) return user;
  const masked = maskContactFields(user);
  if (Array.isArray(masked.addresses)) masked.addresses = masked.addresses.map((address) => ({ ...address, phone: maskPhone(address.phone) }));
  return masked;
}
