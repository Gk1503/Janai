import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { Modal } from './UI'
import { Field, PhoneInput } from './Forms'
import PermissionGrid from './PermissionGrid'
import TemporaryPasswordField from './TemporaryPasswordField'
import { ROLE_PRESETS, presetKeyFor } from '../utils/permissions'

// Create a staff account (staff = null) or edit an existing account's details.
export default function StaffFormModal({ staff, onClose, onSaved }) {
  const isEdit = Boolean(staff)
  const [form, setForm] = useState({
    fullName: staff?.fullName || '',
    loginId: staff?.loginId || '',
    temporaryPassword: '',
    preset: '',
    email: staff?.email || '',
    phone: staff?.phone || '',
  })
  const [permissions, setPermissions] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  function choosePreset(key) {
    set('preset', key)
    setPermissions(key ? [...ROLE_PRESETS[key].permissions] : [])
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (isEdit) {
        const { data } = await api.patch(`/admin/staff/${staff._id}`, { fullName: form.fullName, email: form.email, phone: form.phone })
        onSaved({ staff: data.staff, message: 'Staff details updated.' })
      } else {
        const payload = { fullName: form.fullName, loginId: form.loginId, temporaryPassword: form.temporaryPassword, preset: presetKeyFor(form.preset, permissions), permissions }
        if (form.email.trim()) payload.email = form.email.trim()
        if (form.phone.trim()) payload.phone = form.phone.trim()
        const { data } = await api.post('/admin/staff', payload)
        // The temporary password is handed back only so the owner can pass it on once; it is not stored.
        onSaved({ staff: data.staff, message: data.message, temporaryPassword: form.temporaryPassword })
      }
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={isEdit ? 'Edit staff details' : 'Add staff member'} onClose={onClose} wide>
    <form className="adm-product-form" onSubmit={submit}>
      <div className="adm-form-grid">
        <Field label="Full name" required wide><input value={form.fullName} onChange={(event) => set('fullName', event.target.value)} required maxLength={120} autoComplete="off" /></Field>
        <Field label="Staff login ID" required hint={isEdit ? 'The login ID cannot be changed.' : 'Letters, numbers, dots, dashes or underscores (3–30). Staff sign in with this ID.'}>
          <input value={form.loginId} onChange={(event) => set('loginId', event.target.value)} required disabled={isEdit} autoComplete="off" />
        </Field>
        {!isEdit && <TemporaryPasswordField value={form.temporaryPassword} onChange={(value) => set('temporaryPassword', value)} />}
        <Field label="Email" optional><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} autoComplete="off" /></Field>
        <Field label="Mobile number" optional><PhoneInput value={form.phone} onChange={(value) => set('phone', value)} /></Field>
        {!isEdit && <Field label="Role preset" required hint="A starting point; adjust the permissions below if needed.">
          <select value={form.preset} onChange={(event) => choosePreset(event.target.value)} required>
            <option value="">Choose a role preset…</option>
            {Object.entries(ROLE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
          </select>
        </Field>}
      </div>

      {!isEdit && <section className="adm-detail-section">
        <h3 className="adm-modal-section-title">Permissions</h3>
        <PermissionGrid value={permissions} onChange={setPermissions} />
      </section>}

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy || (!isEdit && !form.preset)}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
