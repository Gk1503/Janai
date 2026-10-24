/**
 * Pure decision for what happens when the owner clicks a different Settings category. Kept in one
 * tested place rather than re-derived inline in AdminSettingsPage.jsx.
 *
 * - 'none': already on this category — nothing to do.
 * - 'blocked': the active form is mid-save (its own Save button was clicked directly, not through this
 *   dialog). A save in progress must never be interrupted, raced, or offered a second "discard" —
 *   navigation is refused outright, with no dialog at all.
 * - 'confirm': the active form has unsaved changes — show the three-way dialog.
 * - 'switch': nothing to lose — navigate immediately.
 *
 * `guard` is whatever the active form last wrote to the shared formGuardRef, or null/undefined if the
 * active category has no editable form at all (e.g. the Payments placeholder), which is always safe to
 * leave.
 */
export function decideCategorySwitch(guard, currentKey, nextKey) {
  if (nextKey === currentKey) return 'none'
  if (guard?.saving) return 'blocked'
  if (guard?.dirty) return 'confirm'
  return 'switch'
}
