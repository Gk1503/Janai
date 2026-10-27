import { useEffect } from 'react'

/**
 * Exposes {dirty, saving, save} on the ref AdminSettingsPage holds for whichever Settings form is
 * currently mounted, so switching categories can detect unsaved changes and trigger the form's own save
 * without a second request or duplicated validation (see utils/settingsNavGuard.js).
 *
 * Written directly during render, not inside an effect — refs are safe to write during render (unlike
 * state), and this guarantees the parent reads the latest value the instant a user clicks a different
 * category, with no need for the child to notify the parent through an effect.
 *
 * `formGuardRef` is optional: a form rendered without one (e.g. in isolation) simply isn't guarded.
 */
export function registerSettingsFormGuard(formGuardRef, state) {
  if (formGuardRef) formGuardRef.current = state
}

// Pure: applies the one rule — warn only when there is something to lose. Exported so it is directly
// testable without a real beforeunload event or a React effect actually running.
export function handleBeforeUnload(dirty, event) {
  if (!dirty) return
  event.preventDefault()
  event.returnValue = ''
}

/**
 * Warns on a tab close/refresh/external navigation while the form is dirty, and never otherwise (a
 * clean form, or right after a successful save, fires no warning). In-app navigation between Settings
 * categories is handled separately by the nav-guard dialog in AdminSettingsPage.jsx — this project's
 * plain <BrowserRouter> has no router-level navigation blocker (that needs a data router), which would
 * be a much larger change than this covers.
 */
export function useBeforeUnloadWarning(dirty) {
  useEffect(() => {
    const listener = (event) => handleBeforeUnload(dirty, event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [dirty])
}
