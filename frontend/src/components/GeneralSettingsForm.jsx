import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Save, Trash2, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Loader } from './UI'
import { Field, PhoneInput } from './Forms'
import { MAX_IMAGE_BYTES, readImageAsDataUrl } from './ProductFormModal'
import { invalidateBusinessSettings } from '../hooks/useBusinessSettings'

export const DAYS = [
  ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'],
  ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday'],
]

function blankForm() {
  return {
    businessName: '', logo: '', phone: '', email: '',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '' },
    operatingHours: Object.fromEntries(DAYS.map(([key]) => [key, { closed: false, open: '09:00', close: '21:00' }])),
  }
}

// Normalises whatever the API returned onto the full shape the form always expects, so a
// not-yet-configured store (missing address/hours) still renders every field correctly.
function toForm(settings = {}) {
  const blank = blankForm()
  return {
    businessName: settings.businessName || '',
    logo: settings.logo || '',
    phone: settings.phone || '',
    email: settings.email || '',
    address: { ...blank.address, ...settings.address },
    operatingHours: Object.fromEntries(DAYS.map(([key]) => [key, { ...blank.operatingHours[key], ...settings.operatingHours?.[key] }])),
  }
}

// Pure, exported so it can be unit-tested without rendering the component or hitting the network.
export function validateGeneralSettingsForm(form) {
  const errors = {}
  if (!form.businessName.trim()) errors.businessName = 'Business name is required.'
  if (form.phone && !/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, ''))) errors.phone = 'Enter a valid 10-digit Indian phone number.'
  if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address.'
  if (form.address.postalCode && !/^\d{6}$/.test(form.address.postalCode)) errors.postalCode = 'Enter a valid 6-digit pincode.'
  for (const [key, label] of DAYS) {
    const day = form.operatingHours[key]
    if (day && !day.closed && day.open >= day.close) errors[`hours-${key}`] = `${label}: closing time must be after opening time.`
  }
  return errors
}

export default function GeneralSettingsForm() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(blankForm())
  const [form, setForm] = useState(blankForm())
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [logoError, setLogoError] = useState('')
  const fileInputRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/general')
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

  // Warns on a tab close/refresh/external navigation while there are unsaved changes. In-app
  // navigation (clicking another sidebar link) isn't caught — this app's router is a plain
  // <BrowserRouter>, and react-router's in-app navigation blocker needs a data router, which would be
  // a much larger change than this step calls for.
  useEffect(() => {
    function onBeforeUnload(event) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function set(key, value) { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }
  function setAddress(key, value) { setForm((current) => ({ ...current, address: { ...current.address, [key]: value } })); setErrors((current) => ({ ...current, postalCode: '' })) }
  function setHours(day, patch) { setForm((current) => ({ ...current, operatingHours: { ...current.operatingHours, [day]: { ...current.operatingHours[day], ...patch } } })); setErrors((current) => ({ ...current, [`hours-${day}`]: '' })) }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    const nextErrors = validateGeneralSettingsForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    try {
      const { data } = await api.patch('/settings/general', form)
      const next = toForm(data.settings)
      setSaved(next)
      setForm(next)
      // The public storefront (Navbar/Footer/Contact) caches these values per tab; drop that cache so
      // the next public page load reflects what was just saved rather than stale data.
      invalidateBusinessSettings()
      toast(data.message || 'Settings saved.')
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(saved)
    setErrors({})
    setLogoError('')
  }

  async function onLogoSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLogoError('')
    if (!file.type.startsWith('image/')) { setLogoError('Please choose an image file (JPG, PNG, WEBP…).'); return }
    if (file.size > MAX_IMAGE_BYTES) { setLogoError('Logo image must be smaller than 5MB.'); return }
    try {
      const dataUrl = await readImageAsDataUrl(file, 480, 0.85)
      set('logo', dataUrl)
    } catch {
      setLogoError('Could not read that image. Please try another file.')
    }
  }

  if (loading) return <Loader label="Loading settings" />
  if (loadError) return <div className="inline-error">{loadError}<button type="button" className="text-link" onClick={load}>Retry</button></div>

  return <form className="adm-settings-form" onSubmit={save} noValidate>
    <div className="form-grid">
      <Field label="Business Name" required wide error={errors.businessName}>
        <input value={form.businessName} onChange={(event) => set('businessName', event.target.value)} maxLength={120} />
      </Field>

      <Field label="Contact Phone" optional error={errors.phone}>
        <PhoneInput value={form.phone} onChange={(value) => set('phone', value)} invalid={Boolean(errors.phone)} />
      </Field>
      <Field label="Contact Email" optional error={errors.email}>
        <input type="email" inputMode="email" value={form.email} onChange={(event) => set('email', event.target.value.trim())} placeholder="hello@janai.in" />
      </Field>

      <Field label="Address Line 1" optional wide><input value={form.address.line1} onChange={(event) => setAddress('line1', event.target.value)} placeholder="Street, building" /></Field>
      <Field label="Address Line 2" optional wide><input value={form.address.line2} onChange={(event) => setAddress('line2', event.target.value)} placeholder="Area, landmark" /></Field>
      <Field label="City" optional><input value={form.address.city} onChange={(event) => setAddress('city', event.target.value)} /></Field>
      <Field label="State" optional><input value={form.address.state} onChange={(event) => setAddress('state', event.target.value)} /></Field>
      <Field label="Pincode" optional error={errors.postalCode}><input inputMode="numeric" pattern="[0-9]{6}" value={form.address.postalCode} onChange={(event) => setAddress('postalCode', event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
    </div>

    <div className="adm-settings-subsection">
      <h3>Business Logo</h3>
      <div className="adm-logo-row">
        <div className="adm-logo-preview">{form.logo ? <img src={form.logo} alt="Business logo" /> : <ImageIcon size={22} />}</div>
        <div className="adm-logo-actions">
          <button type="button" className="button button-outline" onClick={() => fileInputRef.current?.click()}><Upload size={15} />{form.logo ? 'Replace Logo' : 'Upload Logo'}</button>
          {form.logo && <button type="button" className="button button-outline" onClick={() => set('logo', '')}><Trash2 size={15} />Remove</button>}
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onLogoSelected} />
        </div>
      </div>
      {logoError && <div className="form-error">{logoError}</div>}
    </div>

    <div className="adm-settings-subsection">
      <h3>Operating Hours</h3>
      <div className="adm-hours-grid">
        {DAYS.map(([key, label]) => {
          const day = form.operatingHours[key]
          return <div className="adm-hours-row" key={key}>
            <label className="adm-hours-day"><input type="checkbox" checked={!day.closed} onChange={(event) => setHours(key, { closed: !event.target.checked })} />{label}</label>
            {day.closed ? <span className="adm-muted adm-hours-closed">Closed</span> : <div className="adm-hours-times">
              <input type="time" value={day.open} onChange={(event) => setHours(key, { open: event.target.value })} aria-label={`${label} opening time`} />
              <span>to</span>
              <input type="time" value={day.close} onChange={(event) => setHours(key, { close: event.target.value })} aria-label={`${label} closing time`} />
            </div>}
            {errors[`hours-${key}`] && <small className="field-error adm-hours-error">{errors[`hours-${key}`]}</small>}
          </div>
        })}
      </div>
    </div>

    <div className="adm-settings-actions">
      <button type="button" className="button button-outline" disabled={!dirty || saving} onClick={discard}>Discard Changes</button>
      <button type="submit" className="button button-primary" disabled={!dirty || saving}><Save size={15} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  </form>
}
