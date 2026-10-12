import { useEffect, useState } from 'react'
import { Clock, Package, Plus } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, formatPrice } from './UI'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

const PURCHASE_UNIT_OPTIONS = ['kg', 'g', 'pcs', 'L', 'ml', 'dozen', 'pack']

export function VendorPriceHistoryModal({ productId, vendorId, vendorName, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/products/${productId}/vendors/${vendorId}/price-history`)
      setHistory(data.history)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  return <Modal title={`Price History — ${vendorName || 'Vendor'}`} onClose={onClose}>
    {loading ? <Loader label="Loading price history" /> : error ? (
      <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
    ) : !history.length ? (
      <EmptyState icon={Clock} title="No price changes yet" message="A record is added automatically whenever this vendor's purchase price is changed and the product is saved." />
    ) : (
      <div className="adm-history-list">
        {history.map((entry) => <div className="adm-history-item" key={entry._id}>
          <div className="adm-history-item-main">
            <span className="adm-history-price-change">{formatPrice(entry.previousPrice)} → <strong>{formatPrice(entry.newPrice)}</strong></span>
            <span className={`adm-history-delta${entry.newPrice > entry.previousPrice ? ' is-up' : entry.newPrice < entry.previousPrice ? ' is-down' : ''}`}>
              {entry.newPrice > entry.previousPrice ? '+' : ''}{formatPrice(entry.newPrice - entry.previousPrice)}
            </span>
          </div>
          <div className="adm-history-item-meta"><span>{formatDateTime(entry.createdAt)}</span>{entry.reason && <span>{entry.reason}</span>}</div>
        </div>)}
      </div>
    )}
  </Modal>
}

function emptyPurchaseForm(defaultUnit) {
  return { purchaseDate: new Date().toISOString().slice(0, 10), quantity: '', unit: defaultUnit || 'kg', rate: '', invoiceNumber: '', notes: '', status: 'Ordered' }
}

export function VendorPurchaseHistoryModal({ productId, vendorId, vendorName, unit, onClose }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [purchases, setPurchases] = useState([])
  const [summary, setSummary] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(() => emptyPurchaseForm(unit))
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receivingId, setReceivingId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/products/${productId}/vendors/${vendorId}/purchases`)
      setPurchases(data.purchases)
      setSummary(data.summary)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function setField(field, value) { setForm((current) => ({ ...current, [field]: value })) }

  async function submitPurchase(event) {
    event.preventDefault()
    setFormError('')
    const quantity = Number(form.quantity)
    const rate = Number(form.rate)
    if (!form.purchaseDate) return setFormError('Choose a purchase date.')
    if (!Number.isFinite(quantity) || quantity <= 0) return setFormError('Enter a valid quantity.')
    if (!Number.isFinite(rate) || rate < 0) return setFormError('Enter a valid rate.')
    setSaving(true)
    try {
      await api.post(`/products/${productId}/vendors/${vendorId}/purchases`, { ...form, quantity, rate })
      toast('Purchase recorded.')
      setForm(emptyPurchaseForm(unit))
      setShowForm(false)
      await load()
    } catch (requestError) {
      setFormError(getApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function markReceived(purchase) {
    if (!window.confirm(`Mark this purchase as received? This adds ${purchase.quantity} ${purchase.unit} to stock.`)) return
    setReceivingId(purchase._id)
    try {
      await api.patch(`/products/${productId}/vendors/${vendorId}/purchases/${purchase._id}/receive`)
      toast('Purchase received — stock updated.')
      await load()
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setReceivingId(null)
    }
  }

  return <Modal title={`Purchase History — ${vendorName || 'Vendor'}`} onClose={onClose} wide>
    {loading ? <Loader label="Loading purchase history" /> : error ? (
      <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
    ) : <>
      {Boolean(summary.length) && <div className="adm-purchase-summary">
        {summary.map((item) => <div className="adm-summary-chip" key={item.unit}>
          <small>Received ({item.unit})</small>
          <strong>{item.receivedQuantity} {item.unit}</strong>
          <small>{formatPrice(item.totalCost)} total · {formatPrice(item.avgCost)}/{item.unit} avg</small>
        </div>)}
      </div>}

      {!showForm ? (
        <button type="button" className="text-link" onClick={() => setShowForm(true)}><Plus size={15} /> Record Purchase</button>
      ) : (
        <form className="adm-soft-section" onSubmit={submitPurchase}>
          <div className="adm-form-grid">
            <label className="field"><span>Purchase date</span><input required type="date" value={form.purchaseDate} onChange={(event) => setField('purchaseDate', event.target.value)} /></label>
            <label className="field"><span>Status</span><select value={form.status} onChange={(event) => setField('status', event.target.value)}><option value="Ordered">Ordered</option><option value="Received">Received</option></select></label>
            <label className="field"><span>Quantity</span><input required type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setField('quantity', event.target.value)} /></label>
            <label className="field"><span>Unit</span><select value={form.unit} onChange={(event) => setField('unit', event.target.value)}>{PURCHASE_UNIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="field"><span>Rate per unit (₹)</span><input required type="number" min="0" step="0.01" value={form.rate} onChange={(event) => setField('rate', event.target.value)} /></label>
            <label className="field"><span>Invoice / reference #</span><input value={form.invoiceNumber} onChange={(event) => setField('invoiceNumber', event.target.value)} placeholder="Optional" /></label>
            <label className="field field-wide"><span>Notes</span><textarea rows="2" value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Optional" /></label>
          </div>
          {formError && <div className="form-error">{formError}</div>}
          <div className="adm-modal-foot">
            <button type="button" className="button button-outline" onClick={() => { setShowForm(false); setFormError('') }}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Purchase'}</button>
          </div>
        </form>
      )}

      {!purchases.length ? (
        <EmptyState icon={Package} title="No purchases recorded yet" message="Record a purchase above to start tracking real procurement activity for this vendor." />
      ) : (
        <div className="adm-history-list">
          {purchases.map((purchase) => <div className="adm-history-item" key={purchase._id}>
            <div className="adm-history-item-main">
              <span>{formatDate(purchase.purchaseDate)}</span>
              <span>{purchase.quantity} {purchase.unit} @ {formatPrice(purchase.rate)}</span>
              <strong>{formatPrice(purchase.totalAmount)}</strong>
              <span className={`status-pill${purchase.status === 'Ordered' ? ' is-muted' : ''}`}>{purchase.status}</span>
            </div>
            <div className="adm-history-item-meta">
              {purchase.invoiceNumber && <span>Ref: {purchase.invoiceNumber}</span>}
              {purchase.notes && <span>{purchase.notes}</span>}
              {purchase.status === 'Received' && <span>Received {formatDateTime(purchase.receivedAt)} · {purchase.receivedQuantity} {purchase.unit}</span>}
            </div>
            {purchase.status === 'Ordered' && <button type="button" className="text-link" disabled={receivingId === purchase._id} onClick={() => markReceived(purchase)}>{receivingId === purchase._id ? 'Receiving…' : 'Mark Received'}</button>}
          </div>)}
        </div>
      )}
    </>}
  </Modal>
}
