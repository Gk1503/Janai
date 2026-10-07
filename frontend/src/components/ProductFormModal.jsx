import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'

export const PRODUCT_CATEGORIES = ['Fruits', 'Vegetables', 'Groceries', 'Combo Packs', 'Seasonal Specials']

function toFormState(product) {
  return {
    name: product?.name || '',
    category: product?.category || PRODUCT_CATEGORIES[0],
    description: product?.description || '',
    price: product?.price ?? '',
    unit: product?.unit || 'kg',
    stock: product?.stock ?? 0,
    image: product?.images?.[0] || '',
    preOrderAvailable: Boolean(product?.preOrderAvailable),
    bulkAvailable: Boolean(product?.bulkAvailable),
    featured: Boolean(product?.featured),
  }
}

export default function ProductFormModal({ product, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => toFormState(product))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isEdit = Boolean(product?._id)

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { image, ...rest } = form
    const payload = { ...rest, price: Number(form.price), stock: Number(form.stock), images: image.trim() ? [image.trim()] : [] }
    try {
      if (isEdit) await api.put(`/products/${product._id}`, payload)
      else await api.post('/products', payload)
      toast(isEdit ? 'Product updated.' : 'Product added.')
      onSaved()
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={isEdit ? 'Edit Product' : 'Add New Product'} onClose={onClose} wide>
    <form className="adm-product-form" onSubmit={submit}>
      <span className="adm-modal-section-title">Product information</span>
      <div className="form-grid">
        <label className="field field-wide"><span>Product name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
        <label className="field"><span>Category</span><select value={form.category} onChange={(event) => setField('category', event.target.value)}>{PRODUCT_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="field"><span>Unit</span><input required value={form.unit} onChange={(event) => setField('unit', event.target.value)} placeholder="kg, pack, dozen…" /></label>
        <label className="field field-wide"><span>Description</span><textarea required rows="3" value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
        <label className="field field-wide"><span>Product image URL</span><input value={form.image} onChange={(event) => setField('image', event.target.value)} placeholder="/fruit.jpg or https://…" /></label>
      </div>

      <span className="adm-modal-section-title">Pricing</span>
      <div className="form-grid">
        <label className="field"><span>Selling price (₹)</span><input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setField('price', event.target.value)} /></label>
      </div>

      <span className="adm-modal-section-title">Product details</span>
      <div className="form-grid">
        <label className="field"><span>Stock</span><input required type="number" min="0" value={form.stock} onChange={(event) => setField('stock', event.target.value)} /></label>
      </div>

      <span className="adm-modal-section-title">Availability</span>
      <div className="admin-checkboxes">
        <label><input type="checkbox" checked={form.preOrderAvailable} onChange={(event) => setField('preOrderAvailable', event.target.checked)} />Pre-order available</label>
        <label><input type="checkbox" checked={form.bulkAvailable} onChange={(event) => setField('bulkAvailable', event.target.checked)} />Bulk order available</label>
        <label><input type="checkbox" checked={form.featured} onChange={(event) => setField('featured', event.target.checked)} />Featured</label>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
