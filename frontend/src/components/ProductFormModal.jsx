import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, IndianRupee, Image as ImageIcon, Plus, RefreshCw, Save, Star, Store, Trash2, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { VendorPriceHistoryModal, VendorPurchaseHistoryModal } from './VendorHistoryModals'
import VendorFormModal from './VendorFormModal'

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
    // Canonical Vendor collection id (Stage 1 of Vendor Management), or null for a legacy row that
    // has never been linked. `vendorSearch` is purely local UI state (the selector's search box for
    // this row) — never sent to the backend.
    vendorRef: null,
    vendorSearch: '',
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
    vendorRef: vendor.vendorRef || null,
    vendorSearch: '',
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

// Universal Pricing (Settings → Pricing). Matches a product's purchase price against the owner's
// saved rules — minimum inclusive, maximum exclusive, same convention as the backend
// (backend/utils/settingsValidation.js's normalizePricingRules) and the Settings UI
// (UniversalPricingSettingsForm.jsx). Pure and exported so matching/calculation can be unit-tested
// without rendering the modal or hitting the network.
export function matchUniversalPricingRule(rules, purchasePrice) {
  if (!Array.isArray(rules) || !Number.isFinite(purchasePrice) || purchasePrice < 0) return null
  return rules.find((rule) => {
    if (purchasePrice < rule.minPurchasePrice) return false
    return rule.maxPurchasePrice == null || purchasePrice < rule.maxPurchasePrice
  }) || null
}

// Same formula as the existing individual calculator just below: purchase + fixed + purchase*percent/100.
// Returns null when there is nothing to suggest (no matching rule), so the caller can tell "no
// suggestion" apart from "a suggestion of ₹0".
export function calculateUniversalSuggestion(rule, purchasePrice) {
  if (!rule || !Number.isFinite(purchasePrice) || purchasePrice < 0) return null
  const fixedProfit = Number(rule.fixedProfit) || 0
  const profitPercent = Number(rule.profitPercent) || 0
  const percentProfit = (purchasePrice * profitPercent) / 100
  return { fixedProfit, profitPercent, percentProfit, totalProfit: fixedProfit + percentProfit, suggestedPrice: purchasePrice + fixedProfit + percentProfit }
}

export function formatUniversalRange(rule) {
  if (!rule) return ''
  return rule.maxPurchasePrice == null ? `₹${rule.minPurchasePrice} onwards` : `₹${rule.minPurchasePrice}–₹${rule.maxPurchasePrice}`
}

// Whether the "applied" state (success indicator + Undo) is still accurate, re-derived fresh from
// current state rather than stored as its own flag — so it can never go stale. `snapshot` is
// {previousPrice, appliedValue} from the moment "Use This" (universal) was clicked, or null if nothing
// has been applied since the last Undo (or since a prior apply became stale). True only while every one
// of these still holds: something was applied, the Selling Price field still holds exactly what was
// applied (a manual edit afterwards breaks this), and today's universal suggestion still rounds to that
// same applied value (a purchase-price change that moves the matched rule, or the suggestion itself,
// also breaks this).
export function isUniversalSuggestionApplied(formPrice, universalSuggestion, snapshot) {
  return Boolean(
    snapshot
    && universalSuggestion
    && formPrice === snapshot.appliedValue
    && universalSuggestion.suggestedPrice.toFixed(2) === snapshot.appliedValue
  )
}

// Vendor & Procurement — central vendor selection (Stage 3 of Vendor Management). A row is:
//   'new'    — never saved on this product (no embedded _id yet): identity must come from the
//              central-vendor selector (or the plain-text fallback if that selector is unavailable).
//   'linked' — already saved AND already carries a canonical vendorRef: resolves to that central
//              vendor, shown via the same selector, pre-selected.
//   'legacy' — already saved but has no vendorRef (a pre-Stage-3 product, or one never linked):
//              left exactly as before Stage 3 — a plain editable name field, never auto-matched to
//              any central vendor by name.
// Pure and exported so this can be unit-tested without rendering the modal.
export function vendorRowMode(vendor) {
  if (!vendor?._id) return 'new'
  return vendor.vendorRef ? 'linked' : 'legacy'
}

// The options a row's selector should offer: every Active central vendor matching the row's own
// search text, plus — unconditionally, regardless of status or search text — whichever vendor the
// row is already linked to. This is what keeps an already-assigned Inactive vendor visibly selected
// (never silently dropped) while still excluding every OTHER Inactive vendor from the pick-list for a
// NEW assignment.
export function buildVendorOptions(centralVendors, search, currentVendorRef) {
  const query = String(search || '').trim().toLowerCase()
  const matchesSearch = (vendor) => !query
    || vendor.name.toLowerCase().includes(query)
    || (vendor.contactPerson || '').toLowerCase().includes(query)
    || (vendor.phone || '').toLowerCase().includes(query)
  const options = (centralVendors || []).filter((vendor) => vendor.status === 'Active' && matchesSearch(vendor))
  if (currentVendorRef && !options.some((vendor) => String(vendor._id) === String(currentVendorRef))) {
    const current = (centralVendors || []).find((vendor) => String(vendor._id) === String(currentVendorRef))
    if (current) options.unshift(current)
  }
  return options
}

export function resolveCentralVendor(centralVendors, vendorRef) {
  if (!vendorRef) return null
  return (centralVendors || []).find((vendor) => String(vendor._id) === String(vendorRef)) || null
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
  // Universal Pricing rules, owner-only. Fetched once on mount (same pattern as /categories just
  // below) — never refetched per keystroke. A 403 (a products:manage staff member, not the owner)
  // is expected and handled separately from a genuine load failure: the section simply doesn't
  // render for them, never exposing rule data, and never shown as a broken product form.
  const [universalRules, setUniversalRules] = useState([])
  const [universalRulesLoading, setUniversalRulesLoading] = useState(true)
  const [universalRulesForbidden, setUniversalRulesForbidden] = useState(false)
  const [universalRulesError, setUniversalRulesError] = useState('')
  // Snapshot taken at the moment "Use This" (universal) is clicked: the exact prior form.price (which
  // may be '') to restore on Undo, and the value that was written so the "applied" display can tell
  // whether it's still accurate. Never read directly for display — see isUniversalApplied below, which
  // re-derives applied-ness from current state every render instead of trusting a stale flag.
  const [appliedSnapshot, setAppliedSnapshot] = useState(null)
  const [vendors, setVendors] = useState(() => toVendorEntries(product))
  // Central Vendor collection (Stage 1), owner/products:manage/inventory:update only — same
  // permission model as the existing per-product vendor data. Fetched once on mount, same pattern as
  // /categories and /settings/pricing-rules above. A 403 (a products:view-only staff member, who can
  // already see embedded vendor data via canViewSupplierCosts but cannot manage it) is expected and
  // handled separately from a genuine load failure: either way, the row simply falls back to the
  // pre-Stage-3 plain-text name field rather than breaking the form.
  const [centralVendors, setCentralVendors] = useState([])
  const [centralVendorsLoading, setCentralVendorsLoading] = useState(true)
  const [centralVendorsForbidden, setCentralVendorsForbidden] = useState(false)
  const [centralVendorsError, setCentralVendorsError] = useState('')
  // The row currently creating a new central vendor via the reused VendorFormModal, or null.
  const [quickAddVendorTarget, setQuickAddVendorTarget] = useState(null)
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

  useEffect(() => {
    let active = true
    api.get('/settings/pricing-rules')
      .then(({ data }) => { if (active) setUniversalRules(Array.isArray(data.settings?.pricingRules) ? data.settings.pricingRules : []) })
      .catch((requestError) => {
        if (!active) return
        // A staff member with products:manage can open this form; universal rules stay owner-only, so
        // this 403 is expected for them, not a product-form failure — the section just won't render.
        if (requestError.response?.status === 403) setUniversalRulesForbidden(true)
        else setUniversalRulesError(getApiError(requestError))
      })
      .finally(() => { if (active) setUniversalRulesLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    api.get('/vendors')
      .then(({ data }) => { if (active) setCentralVendors(Array.isArray(data.vendors) ? data.vendors : []) })
      .catch((requestError) => {
        if (!active) return
        if (requestError.response?.status === 403) setCentralVendorsForbidden(true)
        else setCentralVendorsError(getApiError(requestError))
      })
      .finally(() => { if (active) setCentralVendorsLoading(false) })
    return () => { active = false }
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
    // Local-state only: the removed row is simply left out of the next save's vendors array. This
    // never calls any vendor API, so it can never delete the central Vendor record (a separate
    // collection entirely) or any VendorPurchase/VendorPriceHistory row.
    setVendors((current) => current.filter((vendor) => vendor.id !== id))
  }

  // Selecting a central vendor sets vendorRef AND snapshots its current name into the row's own
  // `name` — the same snapshot convention VendorPurchase/VendorPriceHistory already use for
  // `vendorName`, so price-history logging (which reads vendor.name from the saved product) keeps
  // working unchanged. Picking the blank option clears vendorRef back to null.
  function selectCentralVendor(id, vendorId) {
    const central = centralVendors.find((vendor) => String(vendor._id) === String(vendorId))
    setVendors((current) => current.map((vendor) => (vendor.id === id ? { ...vendor, vendorRef: vendorId || null, name: central ? central.name : vendor.name } : vendor)))
  }

  function handleCentralVendorCreated(createdVendor) {
    const targetId = quickAddVendorTarget
    setQuickAddVendorTarget(null)
    if (!targetId || !createdVendor) return
    // The create-vendor API itself is the only thing that can add a new central vendor — this just
    // selects the one it already created, it never calls createVendor a second time.
    setCentralVendors((current) => [...current, createdVendor])
    setVendors((current) => current.map((vendor) => (vendor.id === targetId ? { ...vendor, vendorRef: createdVendor._id, name: createdVendor.name } : vendor)))
  }

  const purchase = Number(purchasePrice) || 0
  const selling = Number(form.price) || 0
  const suggested = purchase + (Number(fixedAmount) || 0) + (purchase * (Number(profitPercent) || 0)) / 100
  const profitAmount = selling - purchase
  const profitPct = purchase > 0 ? (profitAmount / purchase) * 100 : 0
  const marginPct = selling > 0 ? (profitAmount / selling) * 100 : 0
  const finalPriceInclGst = selling * (1 + (Number(gstRate) || 0) / 100)
  const summaryTone = (value) => (value > 0 ? ' is-positive' : value < 0 ? ' is-negative' : '')

  // Universal Pricing — entirely separate from the individual calculator above: its own derived
  // values, its own "Use This" below, and it never reads or writes purchasePrice/fixedAmount/
  // profitPercent/suggested. The only thing shared is the purchase-price figure itself and the
  // selling-price field that either "Use This" button may (only on an explicit click) write into.
  const matchedUniversalRule = matchUniversalPricingRule(universalRules, purchase)
  const universalSuggestion = calculateUniversalSuggestion(matchedUniversalRule, purchase)

  const isUniversalApplied = isUniversalSuggestionApplied(form.price, universalSuggestion, appliedSnapshot)
  function applyUniversalSuggestion() {
    if (!universalSuggestion) return
    const appliedValue = universalSuggestion.suggestedPrice.toFixed(2)
    setAppliedSnapshot({ previousPrice: form.price, appliedValue })
    setField('price', appliedValue)
  }
  function undoUniversalSuggestion() {
    if (!appliedSnapshot) return
    setField('price', appliedSnapshot.previousPrice)
    setAppliedSnapshot(null)
  }

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
          ...(vendor.vendorRef ? { vendorRef: vendor.vendorRef } : {}),
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

        {/* Owner-only (Settings → Pricing). Entirely separate from the calculator above: its own data,
            its own "Use This", and it is simply not rendered at all for a products:manage staff member
            (a 403 here is expected, not a form failure) — never revealing rule data to them. */}
        {!universalRulesForbidden && <div className="adm-soft-section adm-universal-pricing">
          <div className="adm-form-section-head"><IndianRupee size={16} /><h3>Universal Pricing</h3></div>
          <p className="adm-form-section-description">A separate suggestion from the saved Universal Pricing rules (Settings → Pricing), based on the same purchase price above. Applying it is optional, and separate from the individual calculator.</p>

          {universalRulesLoading ? <p className="adm-muted">Loading universal pricing rules…</p>
            : universalRulesError ? <p className="adm-muted">Universal pricing rules could not be loaded right now.</p>
            : !universalRules.length ? <p className="adm-muted">No universal pricing rules have been configured.</p>
            : purchase <= 0 ? <p className="adm-muted">Enter a purchase price above to see a universal pricing suggestion.</p>
            : !matchedUniversalRule ? <p className="adm-muted">No universal pricing rule matches this purchase price.</p>
            : <>
              <p className="adm-muted">Matched range: <strong>{formatUniversalRange(matchedUniversalRule)}</strong></p>
              <div className="adm-summary-row">
                <div className="adm-summary-chip"><small>Fixed profit</small><strong>₹{universalSuggestion.fixedProfit.toFixed(2)}</strong></div>
                <div className="adm-summary-chip"><small>Percentage profit</small><strong>₹{universalSuggestion.percentProfit.toFixed(2)}</strong></div>
                <div className="adm-summary-chip"><small>Total profit</small><strong>₹{universalSuggestion.totalProfit.toFixed(2)}</strong></div>
              </div>
              {isUniversalApplied ? (
                <div className="adm-suggested-box">
                  <div><span>Applied</span><strong>₹{appliedSnapshot.appliedValue} applied to Selling Price</strong></div>
                  <button type="button" className="button button-outline" onClick={undoUniversalSuggestion}>Undo</button>
                </div>
              ) : (
                <div className="adm-suggested-box">
                  <div><span>Universal suggested selling price</span><strong>₹{universalSuggestion.suggestedPrice.toFixed(2)}</strong></div>
                  <button type="button" className="button button-outline" onClick={applyUniversalSuggestion}>Use This</button>
                </div>
              )}
            </>}
        </div>}
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
            {vendors.map((vendor, index) => {
              const mode = vendorRowMode(vendor)
              const selectorAvailable = !centralVendorsForbidden && !centralVendorsError
              const resolvedCentralVendor = resolveCentralVendor(centralVendors, vendor.vendorRef)
              return <div className="adm-vendor-card" key={vendor.id}>
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
                {mode !== 'legacy' && selectorAvailable ? (
                  <div className="field field-wide">
                    <span>Vendor / supplier</span>
                    {mode === 'linked' && (
                      <p className="adm-muted">
                        {resolvedCentralVendor ? <>Linked to <strong>{resolvedCentralVendor.name}</strong>{resolvedCentralVendor.status === 'Inactive' ? ' (Inactive)' : ''}{resolvedCentralVendor.contactPerson ? ` — ${resolvedCentralVendor.contactPerson}` : ''}{resolvedCentralVendor.phone ? `, ${resolvedCentralVendor.phone}` : ''}</> : 'Loading linked vendor…'}
                      </p>
                    )}
                    <input type="text" value={vendor.vendorSearch} onChange={(event) => updateVendor(vendor.id, 'vendorSearch', event.target.value)} placeholder="Search vendors by name, contact or phone…" />
                    <select value={vendor.vendorRef || ''} onChange={(event) => selectCentralVendor(vendor.id, event.target.value)}>
                      <option value="">{centralVendorsLoading ? 'Loading vendors…' : 'Select a vendor…'}</option>
                      {buildVendorOptions(centralVendors, vendor.vendorSearch, vendor.vendorRef).map((central) => (
                        <option key={central._id} value={central._id}>{central.name}{central.status === 'Inactive' ? ' (Inactive)' : ''}{central.contactPerson ? ` · ${central.contactPerson}` : ''}{central.phone ? ` · ${central.phone}` : ''}</option>
                      ))}
                    </select>
                    <button type="button" className="text-link" onClick={() => setQuickAddVendorTarget(vendor.id)}><Plus size={14} /> Add New Vendor</button>
                  </div>
                ) : (
                  <label className="field field-wide"><span>Vendor / supplier name</span><input value={vendor.name} onChange={(event) => updateVendor(vendor.id, 'name', event.target.value)} placeholder="e.g. Rajesh Vegetable Supplier" /></label>
                )}
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
            </div>
            })}
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
    {quickAddVendorTarget && <VendorFormModal vendor={null} onClose={() => setQuickAddVendorTarget(null)} onSaved={handleCentralVendorCreated} />}
  </>
}
