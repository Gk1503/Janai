import { useEffect, useState } from 'react'
import api from '../services/api'

// Only the public storefront fields — never the full settings response, so a public component can never
// end up depending on (or leaking) a field beyond these.
// Empty phone/email/address/operatingHours mean "not configured", and the public pages hide those rows
// (or show a neutral message) rather than showing a placeholder that looks like real information.
export const DEFAULTS = { businessName: 'Janai', logo: '', phone: '', email: '', address: {}, operatingHours: {} }

// Joins the saved business address into one line, skipping blank parts. Separate from
// utils/validation.js's formatAddress, which formats the differently-shaped order delivery address
// (house/street/landmark) rather than this one (line1/line2/city/state/postalCode).
export function formatBusinessAddress(address = {}) {
  return [address?.line1, address?.line2, address?.city, address?.state, address?.postalCode]
    .filter((part) => String(part || '').trim())
    .join(', ')
}

// Monday-first, matching the order the owner edits them in (components/GeneralSettingsForm.jsx).
const HOUR_DAYS = [
  ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'],
  ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
]
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// '09:00' -> '9:00 AM', matching the 12-hour style the app already uses for delivery slots.
function to12Hour(time) {
  const [hours, minutes] = time.split(':')
  const hour = Number(hours)
  const suffix = hour < 12 ? 'AM' : 'PM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:${minutes} ${suffix}`
}

// One day's label, or null when the stored value cannot be stated truthfully (missing day, non-object,
// or times that are not valid HH:MM). A null day is left out of the display entirely rather than being
// guessed at or shown as "Closed", which would be wrong rather than merely incomplete.
function dayLabel(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if (entry.closed === true) return 'Closed'
  const { open, close } = entry
  if (typeof open !== 'string' || typeof close !== 'string') return null
  if (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close)) return null
  if (open >= close) return null
  return `${to12Hour(open)} – ${to12Hour(close)}`
}

/**
 * Turns the saved operating hours into compact rows for display, collapsing consecutive days that share
 * the same hours: [{ days: 'Mon – Fri', hours: '9:00 AM – 9:00 PM' }, { days: 'Sun', hours: 'Closed' }].
 * Returns [] when nothing can be shown, so the caller can render a neutral message instead of inventing
 * a schedule. Display only — nothing in the ordering, checkout or delivery flow consults this.
 */
export function formatOperatingHours(operatingHours) {
  if (!operatingHours || typeof operatingHours !== 'object' || Array.isArray(operatingHours)) return []
  const rows = []
  HOUR_DAYS.forEach(([key, short], index) => {
    const label = dayLabel(operatingHours[key])
    if (!label) return
    const previous = rows[rows.length - 1]
    // Only collapse days that are genuinely adjacent, so a skipped (unusable) day never makes two
    // separated days look like one continuous range.
    if (previous && previous.hours === label && previous.lastIndex === index - 1) {
      previous.to = short
      previous.lastIndex = index
    } else {
      rows.push({ from: short, to: short, hours: label, lastIndex: index })
    }
  })
  return rows.map(({ from, to, hours }) => ({ days: from === to ? from : `${from} – ${to}`, hours }))
}

// Module-level cache + in-flight promise: Navbar, Footer and ContactPage can all mount at once and
// still make exactly one request between them for the lifetime of the tab, without a Context/Provider.
// A failed fetch resolves to DEFAULTS rather than rejecting, so a public page never breaks over this.
let cache = null
let inflight = null
// Bumped by invalidateBusinessSettings so a response from a request that started *before* an
// invalidation can't repopulate the cache with the values we were just told are stale.
let generation = 0

// Exported (not just used internally by the hook below) so its success/failure/dedup behaviour can be
// tested directly, without depending on React effects running — renderToStaticMarkup (used by this
// project's test harness) never runs useEffect, so the hook's own effect can't be exercised that way.
export function loadBusinessSettings() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    const requestGeneration = generation
    inflight = api.get('/settings/general')
      .then(({ data }) => {
        const settings = data.settings || {}
        const loaded = {
          businessName: settings.businessName || DEFAULTS.businessName,
          logo: settings.logo || DEFAULTS.logo,
          phone: settings.phone || DEFAULTS.phone,
          email: settings.email || DEFAULTS.email,
          address: settings.address || DEFAULTS.address,
          operatingHours: settings.operatingHours || DEFAULTS.operatingHours,
        }
        // Dropped if the settings were invalidated while this request was in flight; the caller still
        // gets what the server returned, but the stale values never become the shared cache.
        if (requestGeneration === generation) cache = loaded
        return loaded
      })
      .catch(() => DEFAULTS)
      .finally(() => { inflight = null })
  }
  return inflight
}

/**
 * Clears the shared cache so the next consumer refetches. Called by the owner's General Settings form
 * after a successful save, so subsequent public page loads in this tab show the new values instead of
 * the ones cached when the tab opened.
 *
 * Note: this does not re-render components that are already mounted — it makes the *next* load fresh.
 * The owner is redirected out of the public storefront anyway (Layout redirects panel users), so a
 * mounted public Navbar/Footer is not a case that arises from saving settings.
 */
export function invalidateBusinessSettings() {
  cache = null
  inflight = null
  generation += 1
}

// Test-only seam: clears the shared cache so each test starts clean. Never called from app code.
export function __resetBusinessSettingsCacheForTests() {
  invalidateBusinessSettings()
}

// Saved business name + logo for public-facing branding (Navbar, Footer, Contact page). Starts from
// DEFAULTS (today's hardcoded Janai branding) and swaps in the real values once loaded — or stays on
// DEFAULTS forever if the request fails, which is exactly the existing behaviour these pages had before
// this feature existed.
export function useBusinessSettings() {
  const [settings, setSettings] = useState(cache || DEFAULTS)
  useEffect(() => {
    let active = true
    loadBusinessSettings().then((result) => { if (active) setSettings(result) })
    return () => { active = false }
  }, [])
  return settings
}
