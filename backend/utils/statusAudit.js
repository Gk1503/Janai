import mongoose from 'mongoose';

// One entry per successful status change, stored on the order / bulk request document itself and
// written in the same atomic update as the status. The array is `select: false` on the models, so
// nothing returns it unless a query asks for it with `+statusHistory`.
export const statusEntrySchema = new mongoose.Schema({
  orderType: { type: String, enum: ['normal', 'preorder', 'bulk'], required: true },
  fromStatus: { type: String, required: true },
  toStatus: { type: String, required: true },
  at: { type: Date, required: true },
  actor: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: '' },
    loginId: { type: String, default: '' },
    role: { type: String, enum: ['owner', 'staff', 'customer'], required: true },
  },
}, { _id: false });

// `default: undefined` keeps the field absent (rather than []) on documents that have no history.
export const statusHistoryField = { type: [statusEntrySchema], default: undefined, select: false };

const ROLE_LABEL = { admin: 'owner', staff: 'staff', customer: 'customer' };

// The actor is always the authenticated account loaded by the auth middleware and the time is the
// server clock: nothing from the request body is read here.
export function buildStatusEntry(user, orderType, fromStatus, toStatus, now = new Date()) {
  return {
    orderType,
    fromStatus,
    toStatus,
    at: now,
    actor: {
      id: user._id ?? user.id,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      loginId: user.adminId || '',
      role: ROLE_LABEL[user.role] || 'customer',
    },
  };
}

// MongoDB update that changes the status and appends the audit entry in one document write.
export function statusUpdateWithAudit(field, toStatus, entry) {
  return { $set: { [field]: toStatus }, $push: { statusHistory: entry } };
}

// Shape history for a response. Only the owner receives the raw actor user ID.
export function presentStatusHistory(history, viewer) {
  if (!Array.isArray(history)) return undefined;
  const isOwner = viewer?.role === 'admin';
  return history.map((entry) => ({
    orderType: entry.orderType,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    at: entry.at,
    actor: { ...(isOwner ? { id: entry.actor?.id } : {}), name: entry.actor?.name || '', loginId: entry.actor?.loginId || '', role: entry.actor?.role },
  }));
}

// Applies presentStatusHistory to a plain order/request object; removes the field when absent or not allowed.
export function withPresentedHistory(plain, viewer, allowed) {
  if (!plain) return plain;
  const { statusHistory, ...rest } = plain;
  if (!allowed) return rest;
  return { ...rest, statusHistory: presentStatusHistory(statusHistory, viewer) || [] };
}

// For customer-facing responses: guarantees the field is never present.
export function withoutStatusHistory(doc) {
  const plain = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  if (!plain) return plain;
  const { statusHistory, ...rest } = plain;
  return rest;
}
