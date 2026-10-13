import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, IndianRupee, Image as ImageIcon, Plus, RefreshCw, Save, Star, Store, Trash2, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { VendorPriceHistoryModal, VendorPurchaseHistoryModal } from './VendorHistoryModals'

const MAX_IMAGES = 8

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
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function toFormState(product) {
  return {
    name: product?.name || '',
    category: product?.category || '',
    description: product?.description || '',
    price: product?.price ?? '',
    unit: product?.unit || UNIT_OPTIONS[0].value,
    stock: product?.stock ?? 0,
    preOrderAvailable: Boolean(product?.preOrderAvailable),
    bulkAvailable: Boolean(product?.bulkAvailable),
    featured: Boolean(product?.featured),
  }
}

function emptyVendor() {
  return {
    id: Math.random().toString(36).slice(2),
    _id: null,
    name: '',
    purchasePrice: '',
    moq: '',
    leadTime: '',
    preferred: false,
    lastPurchasePrice: '',
    lastPurchaseDate: '',
    notes: '',
  }
}

function toVendorEntries(product) {
  const vendors = product?.vendors || []
  if (!vendors.length) return [emptyVendor()]
  return vendors.map((vendor) => ({
    id: vendor._id || Math.random().toString(36).slice(2),
    _id: vendor._id || null,
    name: vendor.name || '',
    purchasePrice: vendor.purchasePrice ?? '',
    moq: vendor.moq || '',
    leadTime: vendor.leadTime || '',
    preferred: Boolean(vendor.preferred),
    lastPurchasePrice: vendor.lastPurchasePrice ?? '',
    lastPurchaseDate: vendor.lastPurchaseDate ? String(vendor.lastPurchaseDate).slice(0, 10) : '',
    notes: vendor.notes || '',
  }))
}

export function capitalizeFirst(value) {
  const trimmed = value.trim()
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed
}

function toImageEntries(product) {
  return (product?.images || []).map((src) => ({ id: Math.random().toString(36).slice(2), src }))
}

export function readImageAsDataUrl(file, maxDimension = 900, quality = 0.82) {
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
  const [categories, setCategories] = useState([])
  const [images, setImages] = useState(() => toImageEntries(product))
  const [imageError, setImageError] = useState('')
  const replaceInputRef = useRef(null)
  const replaceTargetId = useRef(null)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [fixedAmount, setFixedAmount] = useState('')
  const [profitPercent, setProfitPercent] = useState('')
  const [gstRate, setGstRate] = useState(0)
  const [vendors, setVendors] = useState(() => toVendorEntries(product))
  const [historyTarget, setHistoryTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const isEdit = Boolean(product?._id)

  useEffect(() => {
    api.get('/categories').then(({ data }) => {
      setCategories(data.categories)
      setForm((current) => current.category ? current : { ...current, category: data.categories.find((category) => category.status === 'Active')?.name || '' })
    }).catch(() => {})
  }, [])

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function addImages(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) { setImageError(`You can add up to ${MAX_IMAGES} images.`); return }
    const toProcess = files.slice(0, room)
    const added = []
    const problems = []
    for (const file of toProcess) {
      if (!file.type.startsWith('image/')) { problems.push(`"${file.name}" is not an image file.`); continue }
      if (file.size > MAX_IMAGE_BYTES) { problems.push(`"${file.name}" is larger than 5MB.`); continue }
      try {
        const dataUrl = await readImageAsDataUrl(file)
        const isDuplicate = images.some((img) => img.src === dataUrl) || added.some((img) => img.src === dataUrl)
        if (!isDuplicate) added.push({ id: Math.random().toString(36).slice(2), src: dataUrl })
      } catch {
        problems.push(`"${file.name}" could not be read.`)
      }
    }
    if (added.length) setImages((current) => [...current, ...added])
    const messages = []
    if (files.length > toProcess.length) messages.push(`Only ${toProcess.length} of ${files.length} selected images were added — the limit is ${MAX_IMAGES}.`)
    if (problems.length) messages.push(problems.join(' '))
    setImageError(messages.join(' '))
  }

  function removeImage(id) {
    setImages((current) => current.filter((img) => img.id !== id))
  }

  function moveImage(id, direction) {
    setImages((current) => {
      const index = current.findIndex((img) => img.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function makeMainImage(id) {
    setImages((current) => {
      const found = current.find((img) => img.id === id)
      return found ? [found, ...current.filter((img) => img.id !== id)] : current
    })
  }

  function startReplace(id) {
    replaceTargetId.current = id
    replaceInputRef.current?.click()
  }

  async function onReplaceSelected(event) {
    const file = event.target.files?.[0]
    const targetId = replaceTargetId.current
    event.target.value = ''
    replaceTargetId.current = null
    if (!file || !targetId) return
    if (!file.type.startsWith('image/')) { setImageError('Please choose an image file (JPG, PNG, WEBP…).'); return }
    if (file.size > MAX_IMAGE_BYTES) { setImageError('Image must be smaller than 5MB.'); return }
    try {
      const dataUrl = await readImageAsDataUrl(file)
      setImages((current) => current.map((img) => (img.id === targetId ? { ...img, src: dataUrl } : img)))
      setImageError('')
    } catch {
      setImageError('Could not read that image. Please try another file.')
    }
  }

  function updateVendor(id, field, value) {
    setVendors((current) => current.map((vendor) => (vendor.id === id ? { ...vendor, [field]: value } : vendor)))
  }
  function togglePreferredVendor(id) {
    setVendors((current) => current.map((vendor) => ({ ...vendor, preferred: vendor.id === id ? !vendor.preferred : false })))
  }
  function addVendor() {
    setVendors((current) => [...current, emptyVendor()])
  }
  function removeVendor(id) {
    setVendors((current) => current.filter((vendor) => vendor.id !== id))
  }

  const purchase = Number(purchasePrice) || 0
  const selling = Number(form.price) || 0
  const suggested = purchase + (Number(fixedAmount) || 0) + (purchase * (Number(profitPercent) || 0)) / 100
  const profitAmount = selling - purchase
  const profitPct = purchase > 0 ? (profitAmount / purchase) * 100 : 0
  const marginPct = selling > 0 ? (profitAmount / selling) * 100 : 0
  const finalPriceInclGst = selling * (1 + (Number(gstRate) || 0) / 100)
  const summaryTone = (value) => (value > 0 ? ' is-positive' : value < 0 ? ' is-negative' : '')

  const activeCategories = categories.filter((category) => category.status === 'Active')
  const categoryOptions = activeCategories.some((category) => category.name === form.category) || !form.category
    ? activeCategories
    : [{ name: form.category }, ...activeCategories]

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const payload = {
      ...form,
      price: Number(form.price),
      stock: Number(form.stock),
      images: images.map((img) => img.src),
      vendors: vendors
        .filter((vendor) => vendor.name.trim() || Number(vendor.purchasePrice) > 0)
        .map((vendor) => ({
          ...(vendor._id ? { _id: vendor._id } : {}),
          name: vendor.name.trim(),
          purchasePrice: Number(vendor.purchasePrice) || 0,
          moq: vendor.moq,
          leadTime: vendor.leadTime,
          preferred: vendor.preferred,
          lastPurchasePrice: vendor.lastPurchasePrice === '' ? null : Number(vendor.lastPurchasePrice),
          lastPurchaseDate: vendor.lastPurchaseDate || null,
          notes: vendor.notes,
        })),
    }
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

  return <>
    <Modal title={isEdit ? 'Edit Product' : 'Add New Product'} onClose={onClose} wide>
    <form className="adm-product-form" onSubmit={submit}>
      <div className="adm-form-section">
        <span className="adm-modal-section-title">Product information</span>
        <div className="adm-soft-section">
          <div className="adm-form-grid">
            <label className="field field-wide"><span>Product name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} onBlur={() => setField('name', capitalizeFirst(form.name))} placeholder="e.g. Potato" /></label>
            <label className="field"><span>Category</span><select required value={form.category} onChange={(event) => setField('category', event.target.value)}>{!categoryOptions.length && <option value="">Loading categories…</option>}{categoryOptions.map((category) => <option key={category.name} value={category.name}>{category.name}</option>)}</select></label>
            <label className="field"><span>Unit</span><select required value={form.unit} onChange={(event) => setField('unit', event.target.value)}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
            <label className="field"><span>Stock</span><input required type="number" min="0" value={form.stock} onChange={(event) => setField('stock', event.target.value)} /></label>
            <label className="field field-wide"><span>Description</span><textarea required rows="4" value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Describe the product here…" /></label>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <div className="adm-form-section-head"><ImageIcon size={16} /><h3>Product Images</h3></div>
        <p className="adm-form-section-description">Add up to {MAX_IMAGES} images. The first image is the main photo used on product cards and listings everywhere else in Janai.</p>
        <div className="adm-soft-section">
          <div className="adm-image-toolbar">
            <button type="button" className="button button-outline" disabled={images.length >= MAX_IMAGES} onClick={() => fileInputRef.current?.click()}><Upload size={15} />Add Images</button>
            <span className="adm-image-count">{images.length} / {MAX_IMAGES} images</span>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={addImages} />
            <input ref={replaceInputRef} type="file" accept="image/*" hidden onChange={onReplaceSelected} />
          </div>

          {imageError && <div className="form-error">{imageError}</div>}

          {!images.length ? (
            <div className="adm-image-empty"><ImageIcon size={24} /><span>No images yet. Add at least one so customers can recognise this product.</span></div>
          ) : (
            <div className="adm-image-grid">
              {images.map((img, index) => <div className="adm-image-item" key={img.id}>
                <div className="adm-image-item-preview">
                  <img src={img.src} alt={`Product image ${index + 1}`} />
                  {index === 0 && <span className="adm-image-badge"><Star size={11} fill="currentColor" />Main</span>}
                </div>
                <div className="adm-image-item-actions">
                  <button type="button" className="adm-icon-button" aria-label={`Move image ${index + 1} left`} disabled={index === 0} onClick={() => moveImage(img.id, -1)}><ChevronLeft size={15} /></button>
                  <button type="button" className="adm-icon-button" aria-label={`Move image ${index + 1} right`} disabled={index === images.length - 1} onClick={() => moveImage(img.id, 1)}><ChevronRight size={15} /></button>
                  <button type="button" className="adm-icon-button" aria-label={`Replace image ${index + 1}`} onClick={() => startReplace(img.id)}><RefreshCw size={14} /></button>
                  <button type="button" className="adm-icon-button" aria-label={`Remove image ${index + 1}`} onClick={() => removeImage(img.id)}><Trash2 size={14} /></button>
                </div>
                {index !== 0 && <button type="button" className="text-link adm-image-make-main" onClick={() => makeMainImage(img.id)}>Make main image</button>}
              </div>)}
            </div>
          )}
          <p className="adm-image-hint">JPG, PNG or WEBP, up to 5MB each. Use the arrows to reorder — the first image is the main photo.</p>
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
        <span className="adm-modal-section-title">Product options</span>
        <div className="adm-soft-section">
          <div className="adm-options-grid">
            <div className="adm-option-card">
              <div className="adm-option-copy"><strong>Pre-order available</strong><p>Customers can schedule this product for a future delivery date.</p></div>
              <button type="button" role="switch" aria-checked={form.preOrderAvailable} aria-label="Pre-order available" className={`adm-switch${form.preOrderAvailable ? ' is-on' : ''}`} onClick={() => setField('preOrderAvailable', !form.preOrderAvailable)}><span className="adm-switch-thumb" /></button>
            </div>
            <div className="adm-option-card">
              <div className="adm-option-copy"><strong>Bulk order available</strong><p>This product can be requested through Janai's bulk order form.</p></div>
              <button type="button" role="switch" aria-checked={form.bulkAvailable} aria-label="Bulk order available" className={`adm-switch${form.bulkAvailable ? ' is-on' : ''}`} onClick={() => setField('bulkAvailable', !form.bulkAvailable)}><span className="adm-switch-thumb" /></button>
            </div>
          </div>
          <div className="adm-option-row">
            <strong>Featured</strong>
            <button type="button" role="switch" aria-checked={form.featured} aria-label="Featured" className={`adm-switch${form.featured ? ' is-on' : ''}`} onClick={() => setField('featured', !form.featured)}><span className="adm-switch-thumb" /></button>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <div className="adm-form-section-head"><Store size={16} /><h3>Vendor &amp; Procurement</h3></div>
        <p className="adm-form-section-description">Manage the suppliers you purchase this product from, including purchase price, minimum order quantity, delivery time, and procurement details.</p>
        <div className="adm-soft-section">
          <div className="adm-vendor-list">
            {vendors.map((vendor, index) => <div className="adm-vendor-card" key={vendor.id}>
              <div className="adm-vendor-card-head">
                <strong>Vendor {index + 1}</strong>
                <div className="adm-vendor-card-actions">
                  {vendor._id && <>
                    <button type="button" className="button button-outline button-sm" onClick={() => setHistoryTarget({ vendorId: vendor._id, vendorName: vendor.name, mode: 'price' })}>Price History</button>
                    <button type="button" className="button button-outline button-sm" onClick={() => setHistoryTarget({ vendorId: vendor._id, vendorName: vendor.name, mode: 'purchase' })}>Purchase History</button>
                  </>}
                  <button type="button" className="adm-icon-button" aria-label={`Remove vendor ${index + 1}`} onClick={() => removeVendor(vendor.id)}><Trash2 size={15} /></button>
                </div>
              </div>

              <div className="adm-form-grid">
                <label className="field field-wide"><span>Vendor / supplier name</span><input value={vendor.name} onChange={(event) => updateVendor(vendor.id, 'name', event.target.value)} placeholder="e.g. Rajesh Vegetable Supplier" /></label>
                <label className="field">
                  <span>Purchase price (₹)</span>
                  <div className="adm-price-suffix"><input type="number" min="0" step="0.01" value={vendor.purchasePrice} onChange={(event) => updateVendor(vendor.id, 'purchasePrice', event.target.value)} placeholder="e.g. 45" /><small>/ {form.unit}</small></div>
                </label>
                <label className="field"><span>Minimum order quantity</span><input value={vendor.moq} onChange={(event) => updateVendor(vendor.id, 'moq', event.target.value)} placeholder={`e.g. 20 ${form.unit}`} /></label>
                <label className="field"><span>Lead time</span><input value={vendor.leadTime} onChange={(event) => updateVendor(vendor.id, 'leadTime', event.target.value)} placeholder="e.g. 1 Day" /></label>
                <label className="field"><span>Last purchase price (₹)</span><input type="number" min="0" step="0.01" value={vendor.lastPurchasePrice} onChange={(event) => updateVendor(vendor.id, 'lastPurchasePrice', event.target.value)} placeholder="e.g. 43" /></label>
                <label className="field"><span>Last purchase date</span><input type="date" value={vendor.lastPurchaseDate} onChange={(event) => updateVendor(vendor.id, 'lastPurchaseDate', event.target.value)} /></label>
                <label className="field field-wide"><span>Procurement notes</span><textarea rows="2" value={vendor.notes} onChange={(event) => updateVendor(vendor.id, 'notes', event.target.value)} placeholder="Add notes about purchasing, quality, delivery preferences, or supplier-specific instructions…" /></label>
              </div>

              {vendor.purchasePrice && <button type="button" className="text-link" onClick={() => setPurchasePrice(vendor.purchasePrice)}>Use as pricing purchase price</button>}

              <div className="adm-option-row">
                <div className="adm-option-copy"><strong>Preferred vendor</strong><p>Use this supplier as the primary vendor for this product.</p></div>
                <button type="button" role="switch" aria-checked={vendor.preferred} aria-label={`Preferred vendor ${index + 1}`} className={`adm-switch${vendor.preferred ? ' is-on' : ''}`} onClick={() => togglePreferredVendor(vendor.id)}><span className="adm-switch-thumb" /></button>
              </div>
            </div>)}
          </div>

          <button type="button" className="text-link" onClick={addVendor}><Plus size={15} /> {vendors.length ? 'Add Another Vendor' : 'Add Vendor'}</button>

          <p className="adm-form-note">{isEdit ? 'Vendor details are saved with this product. Use Price History and Purchase History on a saved vendor to track real procurement activity over time.' : 'Vendor details will be saved once you add this product — Price History and Purchase History become available after that.'} "Last purchase price/date" above are optional manual notes, separate from the tracked Purchase History.</p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}<Save size={15} /></button>
      </div>
    </form>
    </Modal>
    {historyTarget?.mode === 'price' && <VendorPriceHistoryModal productId={product._id} vendorId={historyTarget.vendorId} vendorName={historyTarget.vendorName} onClose={() => setHistoryTarget(null)} />}
    {historyTarget?.mode === 'purchase' && <VendorPurchaseHistoryModal productId={product._id} vendorId={historyTarget.vendorId} vendorName={historyTarget.vendorName} unit={form.unit} onClose={() => setHistoryTarget(null)} />}
  </>
}
