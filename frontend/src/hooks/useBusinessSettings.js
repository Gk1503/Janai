import { useEffect, useState } from 'react'
import api from '../services/api'

// Only what public branding needs — never the full settings response, so a public component can never
// end up depending on (or leaking) a field beyond these two.
export const DEFAULTS = { businessName: 'Janai', logo: '' }

// Module-level cache + in-flight promise: Navbar, Footer and ContactPage can all mount at once and
// still make exactly one request between them for the lifetime of the tab, without a Context/Provider.
// A failed fetch resolves to DEFAULTS rather than rejecting, so a public page never breaks over this.
let cache = null
let inflight = null

// Exported (not just used internally by the hook below) so its success/failure/dedup behaviour can be
// tested directly, without depending on React effects running — renderToStaticMarkup (used by this
// project's test harness) never runs useEffect, so the hook's own effect can't be exercised that way.
export function loadBusinessSettings() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api.get('/settings/general')
      .then(({ data }) => {
        cache = { businessName: data.settings?.businessName || DEFAULTS.businessName, logo: data.settings?.logo || DEFAULTS.logo }
        return cache
      })
      .catch(() => DEFAULTS)
      .finally(() => { inflight = null })
  }
  return inflight
}

// Test-only seam: clears the shared cache so each test starts clean. Never called from app code.
export function __resetBusinessSettingsCacheForTests() {
  cache = null
  inflight = null
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
