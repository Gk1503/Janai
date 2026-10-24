import { Modal } from './UI'

/**
 * Shown when the owner tries to switch Settings categories while the active form has unsaved changes.
 * Reuses the shared Modal (Escape-to-close, click-outside-to-close, aria wiring already established
 * elsewhere in the admin panel) with both mapped to "Stay Editing" — the one choice that can never lose
 * data. Every action is disabled while a dialog-triggered save is in flight, so it can't be duplicated,
 * interrupted, or raced by a second choice.
 */
export default function SettingsNavGuardDialog({ open, saving, onStay, onDiscard, onSaveAndContinue }) {
  if (!open) return null
  return <Modal title="Unsaved changes" onClose={saving ? () => {} : onStay}>
    <p className="adm-modal-text">This section has changes you haven&rsquo;t saved yet. Choose what to do before leaving it.</p>
    <div className="adm-modal-foot settings-nav-guard-foot">
      <button type="button" className="button button-outline" autoFocus disabled={saving} onClick={onStay}>Stay Editing</button>
      <button type="button" className="button button-danger" disabled={saving} onClick={onDiscard}>Discard Changes</button>
      <button type="button" className="button button-primary" disabled={saving} onClick={onSaveAndContinue}>{saving ? 'Saving…' : 'Save and Continue'}</button>
    </div>
  </Modal>
}
