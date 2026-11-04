import { useState } from 'react'
import { Save, Warehouse } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'

function toFormState(vendor) {
  return {
    name: vendor?.name || '',
    contactPerson: vendor?.contactPerson || '',
    phone: vendor?.phone || '',
    email: vendor?.email || '',
    address: vendor?.address || '',
    notes: vendor?.notes || '',
    active: vendor ? vendor.status !== 'Inactive' : true,
  }
}

export default function VendorFormModal({ vendor, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => toFormState(vendor))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isEdit = Boolean(vendor?._id)

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const trimmedName = form.name.trim()
    if (!trimmedName) { setError('Vendor name is required.'); return }
    setBusy(true)
    setError('')
    const payload = {
      name: trimmedName,
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      ...(isEdit ? { status: form.active ? 'Active' : 'Inactive' } : {}),
    }
    try {
      const { data } = isEdit ? await api.put(`/vendors/${vendor._id}`, payload) : await api.post('/vendors', payload)
      toast(isEdit ? 'Vendor updated.' : 'Vendor added.')
      // Passed along so a caller that needs the saved vendor (e.g. ProductFormModal auto-selecting a
      // newly created one) can use it without a second request. AdminVendorsPage's onSaved={load}
      // ignores this extra argument, so this is backward-compatible.
      onSaved(data.vendor)
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={isEdit ? 'Edit Vendor' : 'Add New Vendor'} onClose={onClose} wide>
    <form className="adm-product-form" onSubmit={submit}>
      <div className="adm-form-section">
        <div className="adm-form-section-head"><Warehouse size={16} /><h3>Vendor Information</h3></div>
        <p className="adm-form-section-description">This record can be linked from any product&rsquo;s Vendor &amp; Procurement section.</p>
        <div className="adm-soft-section">
          <div className="adm-form-grid">
            <label className="field field-wide"><span>Vendor name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="e.g. Rajesh Vegetable Supplier" /></label>
            <label className="field"><span>Contact person</span><input value={form.contactPerson} onChange={(event) => setField('contactPerson', event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="Optional" /></label>
            <label className="field field-wide"><span>Address</span><input value={form.address} onChange={(event) => setField('address', event.target.value)} placeholder="Optional" /></label>
            <label className="field field-wide"><span>Notes</span><textarea rows="3" value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Optional" /></label>
          </div>
        </div>
      </div>

      {isEdit && <div className="adm-form-section">
        <div className="adm-form-section-head"><Warehouse size={16} /><h3>Vendor Status</h3></div>
        <p className="adm-form-section-description">Deactivating does not delete this vendor or any of its linked product/procurement history.</p>
        <div className="adm-soft-section">
          <div className="adm-option-row">
            <div className="adm-option-copy"><strong>Vendor status</strong><p>Inactive vendors keep their existing data and can be reactivated here at any time.</p></div>
            <div className="adm-switch-field">
              <span className="adm-switch-state">{form.active ? 'Active' : 'Inactive'}</span>
              <button type="button" role="switch" aria-checked={form.active} aria-label="Vendor status" className={`adm-switch${form.active ? ' is-on' : ''}`} onClick={() => setField('active', !form.active)}><span className="adm-switch-thumb" /></button>
            </div>
          </div>
        </div>
      </div>}

      {error && <div className="form-error">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Vendor'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
