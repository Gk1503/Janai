// Customer SMS notifications for order lifecycle events. Secondary to every order operation: this
// module never creates, cancels or prices an order, never touches stock or the cart, and its failures
// can never fail the request that triggered it (see dispatchOrderNotification below).
import Settings from '../models/Settings.js';
import User from '../models/User.js';
import { normalizeOptionalPhone } from './settingsValidation.js';
import { MAX_SMS_BODY_LENGTH, queueSms } from './smsGateway.js';

export const ORDER_NOTIFICATION_EVENTS = ['orderPlaced', 'outForDelivery', 'delivered', 'orderCancelled'];

// Fail-closed: if the settings document cannot be read, every switch reads as off and nothing is sent.
const ALL_OFF = { enabled: false, orderPlaced: false, outForDelivery: false, delivered: false, orderCancelled: false };

export async function loadNotificationSettings() {
  try {
    const doc = await Settings.findOne({}, 'notifications').lean();
    const saved = doc?.notifications || {};
    return {
      enabled: saved.enabled === true,
      orderPlaced: saved.orderPlaced === true,
      outForDelivery: saved.outForDelivery === true,
      delivered: saved.delivered === true,
      orderCancelled: saved.orderCancelled === true,
    };
  } catch {
    return { ...ALL_OFF };
  }
}

// The reference customers already see in the app for an order (pages/OrderPages.jsx and the admin order
// views both render `String(order._id).slice(-8).toUpperCase()`), so the SMS matches the UI instead of
// introducing a second order-reference format. Bounded to 8 characters by construction.
export function orderReference(order) {
  const id = order?._id ?? order?.id;
  return id ? String(id).slice(-8).toUpperCase() : '';
}

// Only a genuinely valid, unambiguous Indian mobile number is ever used. normalizeOptionalPhone is the
// backend's existing exported Indian-number normaliser (utils/settingsValidation.js, covered by
// test/phase8.test.js): it strips separators, drops a leading 91 country code on a 12-digit number and
// requires a 10-digit number starting 6-9. Anything else returns null here rather than being guessed at.
export function toE164India(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const result = normalizeOptionalPhone(String(raw));
  if (result.error || !result.value) return null;
  return `+91${result.value}`;
}

// deliveryAddress.phone first (it is required on every order and is the number the delivery itself is
// for), then the account's registered number as a fallback. An invalid delivery number falls through to
// the account number rather than being "corrected" into a different one.
export async function resolveRecipient(order) {
  const fromAddress = toE164India(order?.deliveryAddress?.phone);
  if (fromAddress) return { phone: fromAddress, source: 'deliveryAddress' };

  const user = order?.user;
  if (!user) return { phone: null, source: null };

  // Already-populated account (the admin and rider handlers both populate `phone`): use what is loaded.
  if (typeof user === 'object' && typeof user.phone === 'string') {
    const fromPopulated = toE164India(user.phone);
    if (fromPopulated) return { phone: fromPopulated, source: 'account' };
  }

  // Otherwise `user` is still a reference, not a document — note an ObjectId is also `typeof 'object'`,
  // which is exactly the case straight after Order.create and in the pre-order cancellation path. One
  // narrow lookup that selects nothing but the phone number.
  const id = typeof user === 'object' ? (user._id ?? user.id ?? user) : user;
  if (!id) return { phone: null, source: null };
  try {
    const found = await User.findById(id).select('phone').lean();
    const fromAccount = toE164India(found?.phone);
    if (fromAccount) return { phone: fromAccount, source: 'account' };
  } catch {
    return { phone: null, source: null };
  }
  return { phone: null, source: null };
}

function scheduledDateText(order) {
  const date = order?.deliveryDate ? new Date(order.deliveryDate) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Every customer-facing message, in one place. Deliberately free of the delivery address, customer
// name, item list, payment details and totals.
export function buildMessage(order, event) {
  const reference = orderReference(order);
  if (!reference) return null;
  switch (event) {
    case 'orderPlaced': {
      if (order?.orderType === 'preorder') {
        const scheduled = scheduledDateText(order);
        return scheduled
          ? `Janai: Your pre-order ${reference} is confirmed for delivery on ${scheduled}. Thank you for shopping with us!`
          : `Janai: Your pre-order ${reference} has been confirmed. Thank you for shopping with us!`;
      }
      return `Janai: Your order ${reference} has been placed successfully. Thank you for shopping with us!`;
    }
    case 'outForDelivery':
      return `Janai: Your order ${reference} is out for delivery. Please keep your phone available.`;
    case 'delivered':
      return `Janai: Your order ${reference} has been marked delivered. Thank you for shopping with Janai!`;
    case 'orderCancelled':
      return `Janai: Your order ${reference} has been cancelled. Please contact Janai if you need assistance.`;
    default:
      return null;
  }
}

/**
 * Attempts one notification. Resolves to a privacy-safe result object and never rejects, so no caller
 * can be broken by it. `queued: true` means the gateway accepted the message for its paired Android
 * phone to send — never proof that the customer received it.
 */
export async function notifyOrderEvent(order, event) {
  try {
    if (!ORDER_NOTIFICATION_EVENTS.includes(event)) return { queued: false, reason: 'unknown_event' };
    // Bulk orders are out of scope for this version, and they use their own separate workflow.
    if (order?.orderType === 'bulk') return { queued: false, reason: 'unsupported_order_type' };

    const settings = await loadNotificationSettings();
    if (!settings.enabled) return { queued: false, reason: 'notifications_disabled' };
    if (!settings[event]) return { queued: false, reason: 'event_disabled' };

    const body = buildMessage(order, event);
    if (!body) return { queued: false, reason: 'no_message' };
    // Templates plus an 8-character reference and a short date can't reach this, but a malformed order
    // must never produce a message the gateway would reject outright.
    if (body.length > MAX_SMS_BODY_LENGTH) return { queued: false, reason: 'body_too_long' };

    const { phone, source } = await resolveRecipient(order);
    if (!phone) return { queued: false, reason: 'no_valid_recipient' };

    const result = await queueSms({ to: phone, body });
    return { ...result, event, source };
  } catch (error) {
    // Defensive: nothing above is expected to throw, and a notification must not become an unhandled
    // rejection if it ever does.
    return { queued: false, reason: 'notification_error', error: error?.name || 'Error' };
  }
}

// The only statuses a customer is notified about. Every other transition in the existing workflow
// (confirmed, preparing) is an internal step and sends nothing.
const STATUS_EVENTS = { out_for_delivery: 'outForDelivery', delivered: 'delivered', cancelled: 'orderCancelled' };

// In-flight notifications only. Each entry removes itself once it settles, so this never grows with
// the number of orders processed — it exists so tests can await the fire-and-forget dispatches
// deterministically instead of sleeping, and so a shutdown could drain them if that is ever wanted.
const inFlight = new Set();

export function pendingNotificationCount() {
  return inFlight.size;
}

export function __flushOrderNotificationsForTests() {
  return Promise.allSettled([...inFlight]);
}

/**
 * Fire-and-forget dispatch for use inside request handlers: starts the notification and returns
 * immediately, so a slow or unreachable gateway never delays a customer's order response and a failure
 * never affects the order itself.
 *
 * v1 limitation, deliberately not hidden: there is no persistent outbox and no retry. If the gateway is
 * unreachable at this moment, the notification is lost rather than retried later, and the privacy-safe
 * reason is logged. Adding durable retries would mean a job/queue subsystem this app does not have.
 */
export function dispatchOrderNotification(order, event) {
  const orderId = order?._id ? String(order._id) : 'unknown';
  const promise = notifyOrderEvent(order, event)
    .then((result) => {
      // Logs the event, the order id and a safe reason/status only — never the phone number, the
      // message body, the address or any gateway credential.
      if (!result.queued && !['notifications_disabled', 'event_disabled'].includes(result.reason)) {
        console.warn(`SMS notification not queued for order ${orderId} (${event}): ${result.reason}${result.status ? ` [${result.status}]` : ''}`);
      }
      return result;
    })
    .catch(() => ({ queued: false, reason: 'notification_error' }));
  // Tracked only while actually in flight: the entry deletes itself on settle, so a long-running server
  // never accumulates one retained promise (and result object) per order it has ever processed.
  const tracked = promise.finally(() => { inFlight.delete(tracked); });
  inFlight.add(tracked);
  return promise;
}

/**
 * Maps a just-applied order status onto its customer notification. Shared by the admin status handler
 * and the rider status handler so the status-to-event mapping exists in exactly one place; each of
 * those call sites sits behind its own conditional update, so only the request that actually won a
 * transition reaches here.
 */
export function dispatchStatusNotification(order) {
  const event = STATUS_EVENTS[order?.orderStatus];
  if (!event) return null;
  return dispatchOrderNotification(order, event);
}
