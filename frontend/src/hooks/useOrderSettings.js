import { useEffect, useState } from 'react'
import api from '../services/api'

// Mirrors the backend defaults in backend/utils/settingsValidation.js — today's existing hardcoded
// ₹25 delivery fee below a ₹500 subtotal, delivery always on, no minimum order. Used until the real
// settings load, and forever if the request fails, so cart/checkout pricing never breaks over this.
export const DEFAULTS = { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 }

// Module-level cache + in-flight promise, same pattern as useBusinessSettings.js — the cart note,
// checkout summary and pre-order summary can all mount at once and still make exactly one request
// between them for the lifetime of the tab, without a Context/Provider.
let cache = null
let inflight = null

export function loadOrderSettings() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api.get('/settings/orders-delivery')
      .then(({ data }) => {
        const settings = data.settings || {}
        cache = {
          deliveryEnabled: settings.deliveryEnabled !== false,
          deliveryFee: typeof settings.deliveryFee === 'number' ? settings.deliveryFee : DEFAULTS.deliveryFee,
          freeDeliveryThreshold: typeof settings.freeDeliveryThreshold === 'number' ? settings.freeDeliveryThreshold : DEFAULTS.freeDeliveryThreshold,
          minimumOrderValue: typeof settings.minimumOrderValue === 'number' ? settings.minimumOrderValue : DEFAULTS.minimumOrderValue,
        }
        return cache
      })
      .catch(() => DEFAULTS)
      .finally(() => { inflight = null })
  }
  return inflight
}

// Test-only seam: clears the shared cache so each test starts clean. Never called from app code.
export function __resetOrderSettingsCacheForTests() {
  cache = null
  inflight = null
}

// Saved delivery/minimum-order rules for cart, checkout and pre-order pricing. Starts from DEFAULTS
// (today's hardcoded rule) and swaps in the real values once loaded — or stays on DEFAULTS forever if
// the request fails, exactly the existing behaviour these pages had before this feature existed.
export function useOrderSettings() {
  const [settings, setSettings] = useState(cache || DEFAULTS)
  useEffect(() => {
    let active = true
    loadOrderSettings().then((result) => { if (active) setSettings(result) })
    return () => { active = false }
  }, [])
  return settings
}
