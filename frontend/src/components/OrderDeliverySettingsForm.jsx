import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Loader } from './UI'
import { Field } from './Forms'
import { registerSettingsFormGuard, useBeforeUnloadWarning } from '../hooks/useSettingsFormGuard'

function blankForm() {
  return { deliveryEnabled: true, deliveryFee: '25', freeDeliveryThreshold: '500', minimumOrderValue: '0' }
}

// Normalises whatever the API returned onto the full shape the form always expects.
function toForm(settings = {}) {
  return {
    deliveryEnabled: settings.deliveryEnabled !== false,
    deliveryFee: String(settings.deliveryFee ?? 25),
    freeDeliveryThreshold: String(settings.freeDeliveryThreshold ?? 500),
    minimumOrderValue: String(settings.minimumOrderValue ?? 0),
  }
}

function toPayload(form) {
  return {
    deliveryEnabled: form.deliveryEnabled,
    deliveryFee: Number(form.deliveryFee),
    freeDeliveryThreshold: Number(form.freeDeliveryThreshold),
    minimumOrderValue: Number(form.minimumOrderValue),
  }
}

// Pure, exported so it can be unit-tested without rendering the component or hitting the network.
export function validateOrderDeliverySettingsForm(form) {
  const errors = {}
  const checkAmount = (key, label) => {
    const num = Number(form[key])
    if (form[key] === '' || !Number.isFinite(num) || num < 0) errors[key] = `Enter a valid ${label} (0 or more).`
  }
  checkAmount('deliveryFee', 'delivery fee')
  checkAmount('freeDeliveryThreshold', 'free-delivery threshold')
  checkAmount('minimumOrderValue', 'minimum order value')
  return errors
}

export default function OrderDeliverySettingsForm({ formGuardRef } = {}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(blankForm())
  const [form, setForm] = useState(blankForm())
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/orders-delivery')
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

  function set(key, value) { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }

  async function doSave() {
    if (saving) return false
    const nextErrors = validateOrderDeliverySettingsForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return false
    setSaving(true)
    try {
      const { data } = await api.patch('/settings/orders-delivery', toPayload(form))
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

  function discard() { setForm(saved); setErrors({}) }

  if (loading) return <Loader label="Loading settings" />
  if (loadError) return <div className="inline-error">{loadError}<button type="button" className="text-link" onClick={load}>Retry</button></div>

  return <form className="adm-settings-form" onSubmit={save} noValidate>
    <div className="adm-settings-subsection">
      <label className="adm-hours-day"><input type="checkbox" checked={form.deliveryEnabled} onChange={(event) => set('deliveryEnabled', event.target.checked)} />Delivery enabled</label>
      <p className="adm-muted">When turned off, customers cannot place new orders or pre-orders until this is switched back on. Existing orders and bulk order requests are not affected.</p>
    </div>

    <div className="form-grid">
      <Field label="Delivery Fee (₹)" required error={errors.deliveryFee}>
        <input type="number" min="0" step="0.01" value={form.deliveryFee} onChange={(event) => set('deliveryFee', event.target.value)} disabled={!form.deliveryEnabled} />
      </Field>
      <Field label="Free Delivery Above (₹)" required error={errors.freeDeliveryThreshold} hint="Orders at or above this subtotal are delivered free.">
        <input type="number" min="0" step="0.01" value={form.freeDeliveryThreshold} onChange={(event) => set('freeDeliveryThreshold', event.target.value)} disabled={!form.deliveryEnabled} />
      </Field>
      <Field label="Minimum Order Value (₹)" required error={errors.minimumOrderValue} hint="Set to 0 for no minimum.">
        <input type="number" min="0" step="0.01" value={form.minimumOrderValue} onChange={(event) => set('minimumOrderValue', event.target.value)} />
      </Field>
    </div>

    <div className="adm-settings-actions">
      <button type="button" className="button button-outline" disabled={!dirty || saving} onClick={discard}>Discard Changes</button>
      <button type="submit" className="button button-primary" disabled={!dirty || saving}><Save size={15} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  </form>
}
