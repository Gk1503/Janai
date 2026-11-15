import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { Field } from './Forms'
import { REASON_PRESETS } from './StockAdjustmentModal'

// For staff who may change stock (inventory:update or products:manage) from the Products page, without
// leaving it for the dedicated Stock Management page. Manual Stock Adjustments (Phase 3): this now
// submits through the same ledgered /stock/:productId/variations/:variationId/adjust endpoint
// Stock Management's own adjustment modal uses — PUT /products/:id can no longer change stock at all
// (productController.js::updateProduct strips it unconditionally), so this is the only remaining path,
// and it is the same one, not a second competing implementation. Only ever opened for a legacy product
// (every product in this catalog today) — a product with real variations has no single "the" stock
// field for this simple form to edit unambiguously, so it's redirected to Stock Management instead.
export default function StockUpdateModal({ product, onClose, onSaved }) {
  const toast = useToast()
  const hasRealVariations = Boolean(product.variations?.length)
  const [stock, setStock] = useState(String(product.stock ?? 0))
  const [reason, setReason] = useState('')
  const [explanation, setExplanation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const value = Number(stock)
    if (stock.trim() === '' || !Number.isFinite(value) || value < 0) { setError('Enter a stock quantity of 0 or more.'); return }
    if (!reason) { setError('Choose a reason.'); return }
    if (reason === 'Other' && !explanation.trim()) { setError('Enter an explanation for Other.'); return }
    setBusy(true)
    setError('')
    try {
      await api.post(`/stock/${product._id}/variations/legacy/adjust`, {
        type: 'set_exact', newStock: value, expectedPreviousStock: product.stock,
        reason, explanation: reason === 'Other' ? explanation.trim() : undefined,
      })
      toast('Stock updated.')
      onSaved()
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  if (hasRealVariations) {
    return <Modal title={`Update stock · ${product.name}`} onClose={onClose}>
      <p className="adm-modal-text">This product has multiple stock variations — use Stock Management to adjust a specific one.</p>
      <div className="adm-modal-foot"><button type="button" className="button button-primary" onClick={onClose}>Close</button></div>
    </Modal>
  }

  return <Modal title={`Update stock · ${product.name}`} onClose={onClose}>
    <form className="adm-product-form" onSubmit={submit}>
      <Field label={`Stock (${product.unit})`} required hint={`Currently ${product.stock} ${product.unit}.`}>
        <input type="number" min="0" step="any" value={stock} onChange={(event) => setStock(event.target.value)} autoFocus disabled={busy} />
      </Field>
      <Field label="Reason" required>
        <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy}>
          <option value="">Choose a reason…</option>
          {REASON_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
        </select>
      </Field>
      {reason === 'Other' && <Field label="Explanation" required hint="Required when Reason is Other.">
        <textarea rows="2" value={explanation} onChange={(event) => setExplanation(event.target.value)} disabled={busy} />
      </Field>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save stock'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
