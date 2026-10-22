import Settings from '../models/Settings.js';
import { ORDER_SETTINGS_DEFAULTS } from './settingsValidation.js';

// Single place orderController and settingsController both read delivery/minimum-order rules from, so
// they can never drift apart. Falls back to ORDER_SETTINGS_DEFAULTS (today's existing hardcoded
// behaviour) if the settings document has never been saved, or if the read itself fails — a down
// settings read must never block checkout.
export async function loadOrderPricingRules() {
  try {
    const doc = await Settings.findOne({}, 'orderSettings').lean();
    const saved = doc?.orderSettings || {};
    return {
      deliveryEnabled: saved.deliveryEnabled !== false,
      deliveryFee: typeof saved.deliveryFee === 'number' ? saved.deliveryFee : ORDER_SETTINGS_DEFAULTS.deliveryFee,
      freeDeliveryThreshold: typeof saved.freeDeliveryThreshold === 'number' ? saved.freeDeliveryThreshold : ORDER_SETTINGS_DEFAULTS.freeDeliveryThreshold,
      minimumOrderValue: typeof saved.minimumOrderValue === 'number' ? saved.minimumOrderValue : ORDER_SETTINGS_DEFAULTS.minimumOrderValue,
    };
  } catch {
    return ORDER_SETTINGS_DEFAULTS;
  }
}

// rules.deliveryEnabled === false is handled as an outright block on order creation (see
// orderController.createOrder), not folded into a 0 fee here, so disabling delivery is never
// mistakable for "delivery just happens to be free right now".
export function deliveryFeeFor(subtotal, rules) {
  return !subtotal || subtotal >= rules.freeDeliveryThreshold ? 0 : rules.deliveryFee;
}
