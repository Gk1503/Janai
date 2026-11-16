import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { Field } from './Forms'

export const REASON_PRESETS = ['Physical count correction', 'Damaged / Spoiled', 'Loss / Theft', 'Received outside vendor system', 'Other']
const TYPES = [
  { value: 'add', label: 'Add Stock' },
  { value: 'remove', label: 'Remove Stock' },
  { value: 'set_exact', label: 'Set Exact' },
]

// Pure and exported so it can be unit-tested without rendering the form. previousStock is always the
// product/variation's CURRENT stock for add/remove (the server re-derives the real value from its own
// atomic write regardless); for set_exact it's the value the form loaded with, sent back to the server
// as expectedPreviousStock for the staleness guard.
export function computeNewStock(type, currentStock, quantity, exactValue) {
  const qty = Number(quantity);
  if (type === 'add') return Number.isFinite(qty) ? currentStock + qty : currentStock;
  if (type === 'remove') return Number.isFinite(qty) ? currentStock - qty : currentStock;
  const exact = Number(exactValue);
  return Number.isFinite(exact) ? exact : currentStock;
}

// product/variation: the identifying + display info already resolved by the row that opened this modal
// (productId, variationId, productName, variationLabel, stock, unit) — never re-fetched, since the row
// is the single source of truth for what's being adjusted.
export default function StockAdjustmentModal({ row, onClose, onSaved }) {
  const toast = useToast()
  const [type, setType] = useState('add')
  const [quantity, setQuantity] = useState('')
  const [exactValue, setExactValue] = useState(String(row.stock))
  const [reason, setReason] = useState('')
  const [explanation, setExplanation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const newStock = computeNewStock(type, row.stock, quantity, exactValue)
  const difference = newStock - row.stock
  const quantityValid = type === 'set_exact' ? Number.isFinite(Number(exactValue)) && Number(exactValue) >= 0 : Number.isFinite(Number(quantity)) && Number(quantity) > 0
  const reasonValid = reason && (reason !== 'Other' || explanation.trim())

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    if (!quantityValid) { setError(type === 'set_exact' ? 'Enter a stock quantity of 0 or more.' : 'Enter a quantity greater than 0.'); return }
    if (!reasonValid) { setError(reason === 'Other' ? 'Enter an explanation for Other.' : 'Choose a reason.'); return }
    setSaving(true)
    setError('')
    try {
      const body = { type, reason, explanation: reason === 'Other' ? explanation.trim() : undefined }
      if (type === 'set_exact') { body.newStock = Number(exactValue); body.expectedPreviousStock = row.stock }
      else body.quantity = Number(quantity)
      await api.post(`/stock/${row.productId}/variations/${row.variationId}/adjust`, body)
      toast('Stock adjusted.')
      onSaved()
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  return <Modal title={`Adjust Stock · ${row.productName}${row.variationLabel ? ` — ${row.variationLabel}` : ''}`} onClose={saving ? () => {} : onClose}>
    <form className="adm-stock-adjust-form" onSubmit={submit}>
      <p className="adm-muted">Current stock: <strong>{row.stock} {row.unit}</strong></p>

      <Field label="Operation">
        <div className="adm-adjust-type-row" role="radiogroup" aria-label="Adjustment type">
          {TYPES.map((option) => <button key={option.value} type="button" className={`button button-sm ${type === option.value ? 'button-primary' : 'button-outline'}`} onClick={() => setType(option.value)} disabled={saving}>{option.label}</button>)}
        </div>
      </Field>

      {type === 'set_exact' ? (
        <Field label={`New stock (${row.unit})`} required>
          <input type="number" min="0" step="any" value={exactValue} onChange={(event) => setExactValue(event.target.value)} autoFocus disabled={saving} />
        </Field>
      ) : (
        <Field label={`Quantity to ${type === 'add' ? 'add' : 'remove'} (${row.unit})`} required>
          <input type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus disabled={saving} />
        </Field>
      )}

      <Field label="Reason" required>
        <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving}>
          <option value="">Choose a reason…</option>
          {REASON_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
        </select>
      </Field>
      {reason === 'Other' && <Field label="Explanation" required hint="Required when Reason is Other.">
        <textarea rows="2" value={explanation} onChange={(event) => setExplanation(event.target.value)} disabled={saving} />
      </Field>}

      <div className="adm-adjust-preview">
        <span>Previous: <strong>{row.stock} {row.unit}</strong></span>
        <span>New: <strong>{Number.isFinite(newStock) ? newStock : '—'} {row.unit}</strong></span>
        <span className={difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : ''}>Difference: <strong>{Number.isFinite(difference) ? `${difference > 0 ? '+' : ''}${difference}` : '—'} {row.unit}</strong></span>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={saving || !quantityValid || !reasonValid}>{saving ? 'Saving…' : 'Save Adjustment'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
