import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { Field } from './Forms'

// For staff who may change stock only (inventory:update without products:manage). It sends { stock } and
// nothing else, which is the only body the backend accepts from them.
export default function StockUpdateModal({ product, onClose, onSaved }) {
  const toast = useToast()
  const [stock, setStock] = useState(String(product.stock ?? 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const value = Number(stock)
    if (stock.trim() === '' || !Number.isFinite(value) || value < 0) { setError('Enter a stock quantity of 0 or more.'); return }
    setBusy(true)
    setError('')
    try {
      await api.put(`/products/${product._id}`, { stock: value })
      toast('Stock updated.')
      onSaved()
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`Update stock · ${product.name}`} onClose={onClose}>
    <form className="adm-product-form" onSubmit={submit}>
      <Field label={`Stock (${product.unit})`} required hint={`Currently ${product.stock} ${product.unit}.`}>
        <input type="number" min="0" step="any" value={stock} onChange={(event) => setStock(event.target.value)} autoFocus />
      </Field>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save stock'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
