import { useRef, useState } from 'react'
import { IndianRupee, Image as ImageIcon, Save, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'

export const PRODUCT_CATEGORIES = ['Fruits', 'Vegetables', 'Groceries', 'Combo Packs', 'Seasonal Specials']
const UNIT_OPTIONS = [
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'pcs', label: 'Piece (pcs)' },
  { value: 'L', label: 'Litre (L)' },
  { value: 'ml', label: 'Millilitre (ml)' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'pack', label: 'Pack' },
]
const GST_RATES = [0, 5, 12, 18, 28]
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function toFormState(product) {
  return {
    name: product?.name || '',
    category: product?.category || PRODUCT_CATEGORIES[0],
    description: product?.description || '',
    price: product?.price ?? '',
    unit: product?.unit || UNIT_OPTIONS[0].value,
    stock: product?.stock ?? 0,
    preOrderAvailable: Boolean(product?.preOrderAvailable),
    bulkAvailable: Boolean(product?.bulkAvailable),
    featured: Boolean(product?.featured),
  }
}

function capitalizeFirst(value) {
  const trimmed = value.trim()
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed
}

function readImageAsDataUrl(file, maxDimension = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read that image.'))
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export default function ProductFormModal({ product, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => toFormState(product))
  const [imagePreview, setImagePreview] = useState(product?.images?.[0] || '')
  const [imageError, setImageError] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [fixedAmount, setFixedAmount] = useState('')
  const [profitPercent, setProfitPercent] = useState('')
  const [gstRate, setGstRate] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const isEdit = Boolean(product?._id)

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function onImageSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setImageError('Please choose an image file (JPG, PNG, WEBP…).'); return }
    if (file.size > MAX_IMAGE_BYTES) { setImageError('Image must be smaller than 5MB.'); return }
    try {
      const dataUrl = await readImageAsDataUrl(file)
      setImagePreview(dataUrl)
      setImageError('')
    } catch {
      setImageError('Could not read that image. Please try another file.')
    }
  }

  const purchase = Number(purchasePrice) || 0
  const selling = Number(form.price) || 0
  const suggested = purchase + (Number(fixedAmount) || 0) + (purchase * (Number(profitPercent) || 0)) / 100
  const profitAmount = selling - purchase
  const profitPct = purchase > 0 ? (profitAmount / purchase) * 100 : 0
  const marginPct = selling > 0 ? (profitAmount / selling) * 100 : 0
  const finalPriceInclGst = selling * (1 + (Number(gstRate) || 0) / 100)
  const summaryTone = (value) => (value > 0 ? ' is-positive' : value < 0 ? ' is-negative' : '')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const payload = { ...form, price: Number(form.price), stock: Number(form.stock), images: imagePreview ? [imagePreview] : [] }
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
      <div className="adm-form-section">
        <span className="adm-modal-section-title">Product information</span>
        <div className="adm-soft-section">
          <div className="adm-form-grid">
            <label className="field field-wide"><span>Product name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} onBlur={() => setField('name', capitalizeFirst(form.name))} placeholder="e.g. Potato" /></label>
            <label className="field"><span>Category</span><select value={form.category} onChange={(event) => setField('category', event.target.value)}>{PRODUCT_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="field"><span>Unit</span><select required value={form.unit} onChange={(event) => setField('unit', event.target.value)}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
            <label className="field"><span>Stock</span><input required type="number" min="0" value={form.stock} onChange={(event) => setField('stock', event.target.value)} /></label>
            <label className="field field-wide"><span>Description</span><textarea required rows="4" value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Describe the product here…" /></label>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <span className="adm-modal-section-title">Product image</span>
        <div className="adm-soft-section">
          <div className="adm-image-upload">
            <div className="adm-image-preview">{imagePreview ? <img src={imagePreview} alt="Product preview" /> : <span><ImageIcon size={26} />No image selected</span>}</div>
            <div className="adm-image-actions">
              <button type="button" className="button button-outline" onClick={() => fileInputRef.current?.click()}><Upload size={15} />{imagePreview ? 'Replace Image' : 'Upload Image'}</button>
              {imagePreview && <button type="button" className="text-link" onClick={() => setImagePreview('')}>Remove image</button>}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onImageSelected} />
              <p className="adm-image-hint">JPG, PNG or WEBP, up to 5MB.</p>
              {imageError && <div className="form-error">{imageError}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <div className="adm-form-section-head"><IndianRupee size={16} /><h3>Pricing</h3></div>
        <div className="adm-pricing-card">
          <div className="adm-pricing-row">
            <label className="field"><span>Purchase price (₹)</span><input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} placeholder="Cost price" /></label>
            <label className="field"><span>Selling price (₹)</span><input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setField('price', event.target.value)} /></label>
          </div>

          <div className="adm-suggested-box">
            <div><span>Suggested selling price</span><strong>{purchase > 0 ? `₹${suggested.toFixed(2)}` : '—'}</strong></div>
            <button type="button" className="button button-outline" disabled={purchase <= 0} onClick={() => setField('price', suggested.toFixed(2))}>Use This</button>
          </div>

          <div className="adm-pricing-row">
            <label className="field"><span>Add fixed amount (₹)</span><input type="number" min="0" step="0.01" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} placeholder="e.g. 20" /></label>
            <label className="field"><span>Add profit (%)</span><input type="number" min="0" step="0.1" value={profitPercent} onChange={(event) => setProfitPercent(event.target.value)} placeholder="e.g. 40" /></label>
          </div>

          <div className="adm-summary-row">
            <div className={`adm-summary-chip${summaryTone(profitAmount)}`}><small>Profit amount</small><strong>₹{profitAmount.toFixed(2)}</strong></div>
            <div className={`adm-summary-chip${summaryTone(profitPct)}`}><small>Profit %</small><strong>{profitPct.toFixed(1)}%</strong></div>
            <div className={`adm-summary-chip${summaryTone(marginPct)}`}><small>Margin %</small><strong>{marginPct.toFixed(1)}%</strong></div>
          </div>

          <div className="adm-pricing-row">
            <label className="field"><span>GST rate</span><select value={gstRate} onChange={(event) => setGstRate(event.target.value)}>{GST_RATES.map((rate) => <option key={rate} value={rate}>{rate === 0 ? 'No GST (0%)' : `${rate}%`}</option>)}</select></label>
            <div className="adm-final-price-box"><span>Final price (incl. GST)</span><strong>₹{finalPriceInclGst.toFixed(2)}</strong></div>
          </div>

          <p className="adm-form-note">Purchase price, fixed amount, profit % and GST are calculator helpers for this screen only — only the Selling Price above is saved to the product right now.</p>
        </div>
      </div>

      <div className="adm-form-section">
        <span className="adm-modal-section-title">Availability &amp; product options</span>
        <div className="admin-checkboxes">
          <label><input type="checkbox" checked={form.preOrderAvailable} onChange={(event) => setField('preOrderAvailable', event.target.checked)} />Pre-order available</label>
          <label><input type="checkbox" checked={form.bulkAvailable} onChange={(event) => setField('bulkAvailable', event.target.checked)} />Bulk order available</label>
          <label><input type="checkbox" checked={form.featured} onChange={(event) => setField('featured', event.target.checked)} />Featured</label>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
