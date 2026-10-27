import { useEffect, useState } from 'react'
import { Info, Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Loader } from './UI'
import { registerSettingsFormGuard, useBeforeUnloadWarning } from '../hooks/useSettingsFormGuard'

// Each event switch, with the description the owner sees. Order matters: this is the display order.
export const NOTIFICATION_EVENTS = [
  ['orderPlaced', 'Order placed', 'Sent to the customer right after an order or pre-order is placed successfully.'],
  ['outForDelivery', 'Out for delivery', 'Sent when an order is marked out for delivery, by an admin or the assigned delivery partner.'],
  ['delivered', 'Delivered', 'Sent when an order is marked delivered.'],
  ['orderCancelled', 'Order cancelled', 'Sent when an order is cancelled, whether by staff or by the customer cancelling their own pre-order.'],
]

// Conservative default: everything off, matching the backend schema, so nothing is ever implied as
// enabled while the real settings are still loading.
function blankForm() {
  return { enabled: false, orderPlaced: false, outForDelivery: false, delivered: false, orderCancelled: false }
}

function toForm(settings = {}) {
  const blank = blankForm()
  return Object.fromEntries(Object.keys(blank).map((key) => [key, settings[key] === true]))
}

export default function NotificationSettingsForm({ formGuardRef } = {}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(blankForm())
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/notifications')
      const next = toForm(data.settings)
      setSaved(next)
      setForm(next)
      setLoadError('')
    } catch (requestError) {
      setLoadError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  useBeforeUnloadWarning(dirty)
  registerSettingsFormGuard(formGuardRef, { dirty, saving, save: doSave })

  function set(key, value) { setForm((current) => ({ ...current, [key]: value })) }

  async function doSave() {
    if (saving) return false
    setSaving(true)
    try {
      const { data } = await api.patch('/settings/notifications', form)
      const next = toForm(data.settings)
      setSaved(next)
      setForm(next)
      toast(data.message || 'Settings saved.')
      return true
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }
  function save(event) { event.preventDefault(); doSave() }

  function discard() { setForm(saved) }

  if (loading) return <Loader label="Loading settings" />
  if (loadError) return <div className="inline-error">{loadError}<button type="button" className="text-link" onClick={load}>Retry</button></div>

  return <form className="adm-settings-form" onSubmit={save} noValidate>
    <div className="adm-settings-subsection">
      <h3>SMS Notifications</h3>
      <label className="adm-hours-day"><input type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />Send SMS notifications to customers</label>
      <p className="adm-muted">Master switch. While this is off, no customer SMS is sent for any event, whatever the individual switches below say.</p>
    </div>

    <div className="adm-settings-subsection">
      <h3>Events</h3>
      <div className="adm-hours-grid">
        {NOTIFICATION_EVENTS.map(([key, label, description]) => <div className="adm-hours-row" key={key}>
          <label className="adm-hours-day"><input type="checkbox" checked={form[key]} disabled={!form.enabled} onChange={(event) => set(key, event.target.checked)} />{label}</label>
          <small className="adm-muted adm-notify-desc">{description}</small>
        </div>)}
      </div>
      {!form.enabled && <p className="adm-muted">Turn the master switch on to choose which events notify customers.</p>}
    </div>

    <div className="adm-settings-subsection">
      <p className="adm-muted adm-settings-note"><Info size={15} /> SMS is sent through your own SMS gateway, so delivery depends on the gateway being reachable, a connected Android device being online, SIM balance and carrier support. When a message is accepted it is <strong>queued</strong> for that device — queued is not the same as delivered, and Janai cannot confirm that a customer received an SMS. Orders, deliveries and cancellations always work normally even when an SMS cannot be sent.</p>
    </div>

    <div className="adm-settings-actions">
      <button type="button" className="button button-outline" disabled={!dirty || saving} onClick={discard}>Discard Changes</button>
      <button type="submit" className="button button-primary" disabled={!dirty || saving}><Save size={15} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  </form>
}
