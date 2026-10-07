import { useState } from 'react'
import { Check, Clock, MapPin, Plus } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AppContexts'
import { blankAddress, digitsOnly, formatAddress, hasErrors, mobileDigits, TIME_SLOTS, validateAddress } from '../utils/validation'

export function Field({ label, required = false, optional = false, error, hint, wide = false, className = '', children }) {
  return <label className={`field${wide ? ' field-wide' : ''}${error ? ' has-error' : ''} ${className}`.trim()}>
    <span className="field-label">{label}{required && <i className="field-required" aria-hidden="true">*</i>}{optional && <em className="field-optional">(Optional)</em>}</span>
    {children}
    {error ? <small className="field-error" role="alert">{error}</small> : hint && <small className="field-hint">{hint}</small>}
  </label>
}

export function PhoneInput({ value, onChange, invalid = false, autoComplete = 'tel-national', ...props }) {
  return <div className={`phone-input${invalid ? ' is-invalid' : ''}`}><span>+91</span><input type="tel" inputMode="numeric" autoComplete={autoComplete} pattern="[0-9]{10}" placeholder="10-digit mobile number" aria-invalid={invalid || undefined} value={value} onChange={(event) => onChange(digitsOnly(event.target.value, 10))} onPaste={(event) => { event.preventDefault(); onChange(mobileDigits(event.clipboardData.getData('text'))) }} {...props} /></div>
}

export function TimeSlotField({ value, onChange }) {
  return <Field label="Preferred Time" optional hint="We’ll try our best to deliver in this window."><span className="select-wrap"><Clock size={16} /><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">No preference — any time</option>{TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></span></Field>
}

// Full Name / Mobile / House / Area / Landmark / Pincode. `extra` renders after the mobile field (e.g. organization).
export function AddressFields({ value, onChange, errors = {}, contact = true, extra = null }) {
  const set = (key, next) => onChange({ ...value, [key]: next })
  return <div className="form-grid address-fields">
    {contact && <><Field label="Full Name" required error={errors.recipient}><input autoComplete="name" value={value.recipient || ''} onChange={(event) => set('recipient', event.target.value)} placeholder="Name of the person receiving" /></Field>
    <Field label="Mobile Number" required error={errors.phone}><PhoneInput value={value.phone || ''} onChange={(next) => set('phone', next)} invalid={Boolean(errors.phone)} /></Field></>}
    {extra}
    <Field label="House / Flat / Building" required wide error={errors.house}><input autoComplete="address-line1" value={value.house || ''} onChange={(event) => set('house', event.target.value)} placeholder="e.g. Flat 302, Green Residency" /></Field>
    <Field label="Street / Area / Locality" required wide error={errors.street}><input autoComplete="address-line2" value={value.street || ''} onChange={(event) => set('street', event.target.value)} placeholder="e.g. MG Road, Kothrud" /></Field>
    <Field label="Landmark" optional error={errors.landmark}><input value={value.landmark || ''} onChange={(event) => set('landmark', event.target.value)} placeholder="e.g. Near City Mall" /></Field>
    <Field label="Pincode" required error={errors.postalCode}><input type="text" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" placeholder="6-digit pincode" value={value.postalCode || ''} onChange={(event) => set('postalCode', digitsOnly(event.target.value, 6))} aria-invalid={Boolean(errors.postalCode) || undefined} /></Field>
  </div>
}

const toOrderAddress = (address, user) => ({
  recipient: address.recipient || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
  phone: mobileDigits(address.phone || user?.phone),
  house: address.house || '',
  street: address.street || '',
  landmark: address.landmark || '',
  city: address.city || '',
  state: address.state || '',
  postalCode: address.postalCode || '',
})

// Saved-address selection + new address form shared by Checkout and Confirm Pre-Order.
export function useDeliveryAddress() {
  const { user, setUser } = useAuth()
  const saved = user?.addresses || []
  const [savedId, setSavedId] = useState(() => (saved.find((item) => item.isDefault) || saved[0])?._id || 'new')
  const [draft, setDraftState] = useState(() => ({ ...blankAddress, recipient: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(), phone: mobileDigits(user?.phone) }))
  const [saveDraft, setSaveDraft] = useState(true)
  const [errors, setErrors] = useState({})
  const selected = saved.find((item) => item._id === savedId)
  const usingNew = !selected
  function setDraft(next) {
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => next[key] === draft[key])))
    setDraftState(next)
  }
  function validate() {
    if (!usingNew) return true
    const nextErrors = validateAddress(draft)
    setErrors(nextErrors)
    return !hasErrors(nextErrors)
  }
  // Returns the address payload for an order. A new address is also saved to the profile when requested.
  async function commit() {
    if (!usingNew) return toOrderAddress(selected, user)
    const address = toOrderAddress(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, String(value).trim()])), user)
    if (saveDraft) {
      try {
        const { data } = await api.post('/auth/addresses', { ...address, label: 'Home' })
        setUser(data.user)
        setSavedId(data.user.addresses.at(-1)?._id || 'new')
      } catch { /* The order can still use the typed address even if saving it fails. */ }
    }
    return address
  }
  return { saved, savedId, setSavedId, draft, setDraft, saveDraft, setSaveDraft, errors, validate, commit, usingNew, summary: formatAddress(usingNew ? draft : selected) }
}

export function AddressPicker({ state }) {
  const { saved, savedId, setSavedId, draft, setDraft, saveDraft, setSaveDraft, errors, usingNew } = state
  return <div className="address-picker">
    {saved.length > 0 && <div className="address-options" role="radiogroup" aria-label="Delivery address">
      {saved.map((item) => <label key={item._id} className={`address-option${savedId === item._id ? ' selected' : ''}`}><input type="radio" name="delivery-address" checked={savedId === item._id} onChange={() => setSavedId(item._id)} /><MapPin size={17} /><span><strong>{item.recipient || item.label || 'Address'}{item.isDefault && <em>Default</em>}</strong><small>{formatAddress(item)}</small>{item.phone && <small>+91 {item.phone}</small>}</span>{savedId === item._id && <Check className="address-check" size={17} />}</label>)}
      <label className={`address-option address-option-new${usingNew ? ' selected' : ''}`}><input type="radio" name="delivery-address" checked={usingNew} onChange={() => setSavedId('new')} /><Plus size={17} /><span><strong>Deliver to a new address</strong></span></label>
    </div>}
    {usingNew && <div className="address-new"><AddressFields value={draft} onChange={setDraft} errors={errors} /><label className="check-row"><input type="checkbox" checked={saveDraft} onChange={(event) => setSaveDraft(event.target.checked)} />Save this address for next time</label></div>}
  </div>
}
