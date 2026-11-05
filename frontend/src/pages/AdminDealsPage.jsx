import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BadgePercent, Eye, ImageIcon, Package, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Field } from '../components/Forms'
import DealProductPicker from '../components/DealProductPicker'
import { SeasonalBanner } from '../components/Deals'
import { readImageAsDataUrl } from '../components/ProductFormModal'
import { EmptyState, formatPrice, Loader, Modal, PriceTag, ProductImage } from '../components/UI'

const SECTIONS = {
  best_deals: { tab: 'Best Deals', name: 'Best Deals', singular: 'deal', flag: 'bestDealsEnabled', add: 'Add New Deal', blurb: 'Promotional offers shown in the Best Deals section of the homepage.' },
  seasonal_deals: { tab: 'Seasonal Deals', name: 'Seasonal Deals', singular: 'campaign', flag: 'seasonalDealsEnabled', add: 'Add New Campaign', blurb: 'Seasonal campaigns with their own banner, shown in the Seasonal Deals section of the homepage.' },
}
const STATUS_LABELS = { live: 'Active', scheduled: 'Scheduled', expired: 'Expired', inactive: 'Inactive' }
const MAX_BANNER_BYTES = 5 * 1024 * 1024
const MIN_SEASONAL_PRODUCTS = 3
const SEASONAL_MIN_MESSAGE = `Please select at least ${MIN_SEASONAL_PRODUCTS} products for a Seasonal Deal.`
const HOMEPAGE_CARDS = 3

// A promotion may have no title; the admin sees a clear stand-in, customers see the section name.
const nameOf = (promotion, info) => promotion.title || `Untitled ${info.singular}`

const pad = (value) => String(value).padStart(2, '0')
// <input type="datetime-local"> works in the admin's local time; the server stores the exact instant.
const toLocalInput = (value) => { const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : '')
const formatWhen = (value) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const blankForm = (section) => {
  const start = new Date()
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000)
  return { title: '', description: '', badgeText: '', section, promotionType: 'display_only', discountType: 'percentage', discountValue: '', bannerImage: '', products: [], hidden: [], categories: [], startAt: toLocalInput(start), endAt: toLocalInput(end), isActive: true, displayOrder: '' }
}

// What the homepage banner will show: the first three selected products whose checkbox is on. Prices are an
// illustration (see estimate); customers always see the server's prices.
function bannerPreview(selected, hidden, form) {
  return selected.filter((product) => !hidden.includes(product._id)).slice(0, HOMEPAGE_CARDS).map((product) => {
    const result = estimate(product.price, form)
    return { ...product, offer: result ? { finalPrice: result.final, discountPerUnit: result.discount, discountPercent: Math.round((result.discount / product.price) * 1000) / 10 } : null }
  })
}

// Illustration only. The server recalculates every price from the database; nothing here is ever trusted.
function estimate(price, form) {
  const value = Number(form.discountValue)
  if (form.promotionType !== 'actual_discount' || !Number.isFinite(value) || value <= 0) return null
  const discount = form.discountType === 'percentage' ? Math.round(price * value) / 100 : value
  if (form.discountType === 'percentage' && value > 100) return null
  if (discount > price) return null
  return { discount: Math.round(discount * 100) / 100, final: Math.round((price - discount) * 100) / 100 }
}

function SectionSwitch({ section, enabled, busy, onChange }) {
  const info = SECTIONS[section]
  return <div className="deal-switch-row">
    <div><strong>{info.name}</strong><small>{enabled ? 'Showing on the customer website' : 'Hidden from customers. Discounts are not applied.'}</small></div>
    <button type="button" role="switch" aria-checked={enabled} aria-label={`${info.name} visibility`} className={`deal-switch${enabled ? ' is-on' : ''}`} disabled={busy} onClick={() => onChange(!enabled)}><span /><em>{enabled ? 'ON' : 'OFF'}</em></button>
  </div>
}

function DealForm({ section, promotion, onClose, onSaved }) {
  const toast = useToast()
  const info = SECTIONS[section]
  const [form, setForm] = useState(() => (promotion ? { ...blankForm(section), ...promotion, hidden: [], products: [], categories: promotion.categories || [], startAt: toLocalInput(promotion.startAt), endAt: toLocalInput(promotion.endAt), discountType: promotion.discountType || 'percentage', discountValue: promotion.discountValue ?? '', bannerImage: promotion.bannerImage || '' } : blankForm(section)))
  const [picked, setPicked] = useState([])
  const [categoryOptions, setCategoryOptions] = useState([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(Boolean(promotion))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bannerError, setBannerError] = useState('')
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  useEffect(() => { api.get('/categories').then(({ data }) => setCategoryOptions(data.categories.map((category) => category.name))).catch(() => {}) }, [])
  useEffect(() => {
    if (!promotion) return
    // The saved banner and the selected products (with their current prices) come from the server.
    Promise.all([api.get(`/admin/deals/${promotion._id}`), api.get(`/admin/deals/${promotion._id}/preview`)])
      .then(([full, preview]) => { setForm((current) => ({ ...current, bannerImage: full.data.promotion.bannerImage || '', products: full.data.promotion.products, hidden: full.data.promotion.homepageHidden || [] })); setPicked(preview.data.preview.products.filter((product) => full.data.promotion.products.includes(product._id))) })
      .catch((requestError) => setError(getApiError(requestError)))
      .finally(() => setLoading(false))
  }, [promotion])
  useEffect(() => {
    // With nothing typed the admin still sees the products that can be added (the first page of the eligible list).
    let current = true
    const timer = window.setTimeout(() => api.get('/admin/deals/products', { params: { section, ...(query.trim() ? { q: query.trim() } : {}), scope: 'marked' } }).then(({ data }) => { if (current) setResults(data.products) }).catch(() => {}), query.trim() ? 250 : 0)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, section])

  function addProduct(product) {
    if (form.products.includes(product._id)) return
    set('products', [...form.products, product._id])
    setPicked((current) => [...current, { ...product, images: product.images || (product.image ? [product.image] : []) }])
  }
  function removeProduct(id) {
    setForm((current) => ({ ...current, products: current.products.filter((value) => value !== id), hidden: current.hidden.filter((value) => value !== id) }))
    setPicked((current) => current.filter((product) => product._id !== id))
  }
  // The order of the selected products is the order of the homepage banner cards.
  function moveProduct(id, direction) {
    const index = form.products.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= form.products.length) return
    const next = [...form.products];
    [next[index], next[target]] = [next[target], next[index]]
    set('products', next)
  }
  const toggleHomepage = (id) => set('hidden', form.hidden.includes(id) ? form.hidden.filter((value) => value !== id) : [...form.hidden, id])
  const seasonal = section === 'seasonal_deals'
  const selected = form.products.map((id) => picked.find((product) => product._id === id)).filter(Boolean)
  const toggleCategory = (name) => set('categories', form.categories.includes(name) ? form.categories.filter((value) => value !== name) : [...form.categories, name])

  async function chooseBanner(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBannerError('')
    if (!file.type.startsWith('image/')) { setBannerError('Please choose an image file.'); return }
    if (file.size > MAX_BANNER_BYTES) { setBannerError('The banner must be smaller than 5MB.'); return }
    try { set('bannerImage', await readImageAsDataUrl(file, 1400, 0.8)) } catch { setBannerError('Could not read that image. Please try another file.') }
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    const actual = form.promotionType === 'actual_discount'
    if (seasonal && form.products.length < MIN_SEASONAL_PRODUCTS) { setError(SEASONAL_MIN_MESSAGE); return }
    const payload = {
      title: form.title, description: form.description, badgeText: form.badgeText, promotionType: form.promotionType, bannerImage: form.bannerImage,
      products: form.products, categories: form.categories, startAt: fromLocalInput(form.startAt), endAt: fromLocalInput(form.endAt), isActive: form.isActive,
      // Display Only sends explicit nulls so switching an existing discount to Display Only clears it.
      ...(actual ? { discountType: form.discountType, discountValue: form.discountValue === '' ? '' : Number(form.discountValue) } : { discountType: null, discountValue: null }),
      ...(form.displayOrder !== '' ? { displayOrder: Number(form.displayOrder) } : {}),
      // Seasonal Deals: which of the selected products are hidden from the homepage banner.
      ...(seasonal ? { homepageHidden: form.hidden.filter((id) => form.products.includes(id)) } : {}),
    }
    if (!promotion) payload.section = section
    setBusy(true)
    try {
      const { data } = promotion ? await api.put(`/admin/deals/${promotion._id}`, payload) : await api.post('/admin/deals', payload)
      toast(data.message || 'Saved.')
      onSaved()
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  const actual = form.promotionType === 'actual_discount'
  return <Modal title={promotion ? `Edit ${info.singular}` : info.add} onClose={onClose} wide>
    {loading ? <Loader label="Loading" /> : <form className="deal-form" onSubmit={submit} noValidate>
      <div className="adm-form-grid">
        <Field label={section === 'seasonal_deals' ? 'Campaign title' : 'Deal title'} optional wide hint={`Optional. Customers see "${info.name}" when this is left blank.`}><input value={form.title} maxLength={80} onChange={(event) => set('title', event.target.value)} placeholder={section === 'seasonal_deals' ? 'e.g. Mango Season' : "e.g. Today's Best Deals"} /></Field>
        <Field label="Short description" optional wide><textarea rows="2" maxLength={300} value={form.description} onChange={(event) => set('description', event.target.value)} /></Field>
        <Field label="Badge text" optional hint='For example "Hot Deal" or "Limited Offer".'><input value={form.badgeText} maxLength={30} onChange={(event) => set('badgeText', event.target.value)} /></Field>
        <Field label="Display order" optional hint="Lower numbers show first. Leave empty to add at the end."><input type="number" min="0" max="9999" value={form.displayOrder} onChange={(event) => set('displayOrder', event.target.value)} /></Field>
      </div>

      <fieldset className="deal-type">
        <legend>Promotion type</legend>
        <label className={!actual ? 'selected' : ''}><input type="radio" name="promotionType" checked={!actual} onChange={() => set('promotionType', 'display_only')} /><span><strong>Display Only</strong><small>Shows the promotion. Prices and checkout are not changed.</small></span></label>
        <label className={actual ? 'selected' : ''}><input type="radio" name="promotionType" checked={actual} onChange={() => set('promotionType', 'actual_discount')} /><span><strong>Actual Discount</strong><small>Reduces the price in listings, cart and checkout.</small></span></label>
      </fieldset>

      {actual && <div className="adm-form-grid">
        <Field label="Discount type" required><select value={form.discountType} onChange={(event) => set('discountType', event.target.value)}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option></select></Field>
        <Field label={form.discountType === 'percentage' ? 'Percentage off' : 'Amount off (₹)'} required hint={form.discountType === 'percentage' ? 'Greater than 0, up to 100.' : 'Greater than 0 and not more than the product price.'}><input type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => set('discountValue', event.target.value)} /></Field>
      </div>}

      <div className="adm-form-grid">
        <Field label="Starts" required><input type="datetime-local" value={form.startAt} onChange={(event) => set('startAt', event.target.value)} /></Field>
        <Field label="Ends" required><input type="datetime-local" value={form.endAt} onChange={(event) => set('endAt', event.target.value)} /></Field>
      </div>

      <div className="deal-picker">
        <h3>{seasonal ? 'Select Seasonal Deal Products' : 'Products'}</h3>
        <p className={`deal-count${seasonal && form.products.length < MIN_SEASONAL_PRODUCTS ? ' is-short' : ''}`} aria-live="polite">{form.products.length} product{form.products.length === 1 ? '' : 's'} selected{seasonal && form.products.length < MIN_SEASONAL_PRODUCTS ? ` (at least ${MIN_SEASONAL_PRODUCTS} required)` : ''}</p>
        <label className="shop-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search products marked for ${info.name}…`} aria-label="Search products to add" /></label>
        {query.trim() && !results.length && <small className="adm-muted">No product marked for {info.name} matches. Mark a product under Promotional Placement in Product Edit to make it available here.</small>}
        {results.length > 0 && <ul className="deal-results">{results.map((product) => <li key={product._id}><ProductImage product={{ ...product, images: product.image ? [product.image] : [] }} className="deal-sel-thumb" /><span>{product.name} <small>{formatPrice(product.price)} / {product.unit}</small></span><button type="button" className="table-action" disabled={form.products.includes(product._id)} onClick={() => addProduct(product)}>{form.products.includes(product._id) ? 'Added' : 'Add'}</button></li>)}</ul>}
        {selected.length > 0 && <ul className="deal-selected">{selected.map((product, index) => {
          const result = estimate(product.price, form)
          return <li key={product._id}>
            <ProductImage product={product} className="deal-sel-thumb" />
            <span><strong>{product.name}</strong><small>Price {formatPrice(product.price)} / {product.unit}{actual && (result ? ` → discount ${formatPrice(result.discount)}, offer price ${formatPrice(result.final)}` : form.discountValue ? ' → this discount would not apply to this product' : '')}</small>
              {seasonal && <label className="deal-home-check"><input type="checkbox" checked={!form.hidden.includes(product._id)} onChange={() => toggleHomepage(product._id)} /> Show on Seasonal Deals homepage</label>}
            </span>
            {seasonal && <span className="deal-sel-move"><button type="button" className="icon-button" aria-label={`Move ${product.name} up`} disabled={index === 0} onClick={() => moveProduct(product._id, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label={`Move ${product.name} down`} disabled={index === selected.length - 1} onClick={() => moveProduct(product._id, 1)}><ArrowDown size={14} /></button></span>}
            <button type="button" className="icon-button" aria-label={`Remove ${product.name}`} onClick={() => removeProduct(product._id)}><Trash2 size={15} /></button>
          </li>
        })}</ul>}
        {seasonal && selected.length > HOMEPAGE_CARDS && <small className="adm-muted">The homepage banner shows the first {HOMEPAGE_CARDS} checked products in this order. Every product stays on the Seasonal Deals page.</small>}
        {actual && picked.length > 0 && <small className="adm-muted">Estimate only. The server calculates the real price when a customer sees or buys the product.</small>}
        <h3>Categories</h3>
        <div className="category-filter-row">{categoryOptions.map((name) => <button type="button" key={name} className={`filter-chip${form.categories.includes(name) ? ' selected' : ''}`} onClick={() => toggleCategory(name)}>{name}</button>)}</div>
        {actual && form.categories.length > 0 && <small className="adm-muted">Every product in the selected categories receives the discount. A fixed amount larger than a product's price is skipped for that product.</small>}
      </div>

      <div className="deal-banner">
        <h3>{section === 'seasonal_deals' ? 'Background Image' : 'Promotional image'} <em className="field-optional">(Optional)</em></h3>
        {section === 'seasonal_deals' && <small className="adm-muted">Covers the whole Seasonal Deals section behind the title and cards. This is not a card image.</small>}
        <div className="adm-logo-row">
          <div className="deal-banner-preview">{form.bannerImage ? <img src={form.bannerImage} alt="Banner preview" /> : <ImageIcon size={26} />}</div>
          <div className="adm-logo-actions">
            <label className="button button-outline"><Upload size={15} />{form.bannerImage ? 'Replace image' : 'Upload image'}<input type="file" accept="image/*" hidden onChange={chooseBanner} /></label>
            {form.bannerImage && <button type="button" className="button button-outline" onClick={() => set('bannerImage', '')}><Trash2 size={15} />Remove</button>}
          </div>
        </div>
        {bannerError && <div className="form-error">{bannerError}</div>}
      </div>

      {seasonal && <div className="deal-form-preview">
        <h3>Preview</h3>
        <SeasonalBanner preview promotion={{ title: form.title, description: form.description, badgeText: form.badgeText, bannerImage: form.bannerImage, bannerProducts: bannerPreview(selected, form.hidden, form) }} />
      </div>}
      <label className="deal-active"><input type="checkbox" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} /> Active (can be shown to customers when its dates and section allow)</label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="adm-modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : promotion ? 'Save changes' : `Create ${info.singular}`}</button></div>
    </form>}
  </Modal>
}

function PreviewModal({ promotion, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get(`/admin/deals/${promotion._id}/preview`).then(({ data: payload }) => setData(payload)).catch((requestError) => setError(getApiError(requestError))) }, [promotion._id])
  return <Modal title={`Preview: ${promotion.title || 'Untitled'}`} onClose={onClose} wide>
    {error ? <div className="inline-error">{error}</div> : !data ? <Loader label="Loading preview" /> : <div className="deal-preview">
      <p className={`deal-visibility${data.visibleToCustomers ? ' is-visible' : ''}`}>{data.visibleToCustomers ? 'Customers can see this right now.' : `Customers cannot see this right now: ${!data.sectionEnabled ? 'the section is switched off' : `the promotion is ${STATUS_LABELS[data.status].toLowerCase()}`}.`}</p>
      {data.preview.section === 'seasonal_deals' ? <SeasonalBanner preview promotion={data.preview} /> : <>
        {data.preview.bannerImage && <img className="deal-preview-banner" src={data.preview.bannerImage} alt="" />}
        <h3>{data.preview.title || 'Untitled'}{data.preview.badgeText && <span className="deal-badge">{data.preview.badgeText}</span>}</h3>
        {data.preview.description && <p>{data.preview.description}</p>}
      </>}
      {data.preview.promotionType === 'display_only' ? <p className="adm-muted">Display Only: product prices are not changed.</p> : data.pricing.length > 0 && <div className="admin-table-wrap"><table className="admin-table adm-responsive-table"><thead><tr><th>Product</th><th>Original price</th><th>Discount</th><th>Final price</th><th>Percent</th></tr></thead><tbody>{data.pricing.map((line) => <tr key={line.productId}><td data-label="Product">{line.name}</td><td data-label="Original price">{formatPrice(line.originalPrice)}</td><td data-label="Discount">{line.applied ? formatPrice(line.discountPerUnit) : 'Not applied'}</td><td data-label="Final price"><strong>{formatPrice(line.finalPrice)}</strong></td><td data-label="Percent">{line.applied ? `${line.discountPercent}%` : '–'}</td></tr>)}</tbody></table></div>}
      {data.preview.products.length > 0 && <div className="deal-preview-cards">{data.preview.products.slice(0, 6).map((product) => <article className="deal-preview-card" key={product._id}><ProductImage product={product} /><strong>{product.name}</strong><PriceTag product={product} /></article>)}</div>}
    </div>}
  </Modal>
}

export default function AdminDealsPage() {
  const toast = useToast()
  const [section, setSection] = useState('best_deals')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [editing, setEditing] = useState(null)
  const [previewing, setPreviewing] = useState(null)
  const [picking, setPicking] = useState(null)
  const [busy, setBusy] = useState('')
  const info = SECTIONS[section]

  async function load(target = section) {
    setLoading(true)
    try {
      const { data: payload } = await api.get('/admin/deals', { params: { section: target } })
      setData(payload)
      setError('')
    } catch (requestError) { setError(getApiError(requestError)) } finally { setLoading(false) }
  }
  useEffect(() => { load(section) }, [section]) // eslint-disable-line react-hooks/exhaustive-deps

  async function changeSwitch(enabled) {
    if (!enabled && !window.confirm(`Turn off ${info.name}?\n\nCustomers will no longer see its promotions, and its discounts will stop applying in listings, the cart and checkout. Nothing is deleted: your ${info.singular}s come back when you turn it on again.`)) return
    setBusy('switch')
    try {
      const { data: payload } = await api.patch('/admin/deals/settings', { [info.flag]: enabled })
      setData((current) => ({ ...current, settings: payload.settings }))
      toast(enabled ? `${info.name} is now visible to customers.` : `${info.name} is now hidden from customers.`)
    } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy('') }
  }

  async function toggleActive(promotion) {
    setBusy(promotion._id)
    try {
      await api.patch(`/admin/deals/${promotion._id}/active`, { isActive: !promotion.isActive })
      toast(promotion.isActive ? 'Deactivated.' : 'Activated.')
      await load()
    } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy('') }
  }

  async function remove(promotion) {
    if (!window.confirm(`Delete "${nameOf(promotion, info)}"? This cannot be undone. Orders already placed keep the prices they were charged.`)) return
    setBusy(promotion._id)
    try { await api.delete(`/admin/deals/${promotion._id}`); toast('Deleted.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy('') }
  }

  async function move(index, direction) {
    const ids = data.promotions.map((promotion) => promotion._id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setBusy('order')
    try { await api.put('/admin/deals/reorder', { section, ids }); await load() } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy('') }
  }

  const filtersActive = Boolean(search.trim()) || status !== 'all' || type !== 'all'
  const rows = useMemo(() => (data?.promotions || []).filter((promotion) => (status === 'all' || promotion.status === status) && (type === 'all' || promotion.promotionType === type) && (!search.trim() || `${promotion.title || ''} ${promotion.badgeText || ''}`.toLowerCase().includes(search.trim().toLowerCase()))), [data, status, type, search])
  const stats = data?.stats?.[section]
  const enabled = data?.settings?.[info.flag] === true

  return <div className="adm-products-page deals-page">
    <div className="adm-page-head"><div><h1>Deals Management</h1><p>Create promotions, choose what customers see and whether prices really change.</p></div></div>
    <nav className="adm-status-tabs" aria-label="Deal sections">{Object.entries(SECTIONS).map(([key, value]) => <button key={key} type="button" className={`adm-status-tab${section === key ? ' active' : ''}`} onClick={() => { setSection(key); setSearch(''); setStatus('all'); setType('all') }}>{value.tab}</button>)}</nav>

    {loading && !data ? <Loader label="Loading deals" /> : error && !data ? <div className="inline-error">{error}<button type="button" className="text-link" onClick={() => load()}>Retry</button></div> : <>
      <section className="adm-panel deal-section-card">
        <SectionSwitch section={section} enabled={enabled} busy={busy === 'switch'} onChange={changeSwitch} />
        <p className="adm-muted">{info.blurb}</p>
        <div className="deal-stats"><span><strong>{stats?.total ?? 0}</strong> total</span><span><strong>{stats?.active ?? 0}</strong> active</span><span><strong>{stats?.scheduled ?? 0}</strong> scheduled</span><span><strong>{stats?.expired ?? 0}</strong> expired</span>{(stats?.inactive ?? 0) > 0 && <span><strong>{stats.inactive}</strong> inactive</span>}</div>
      </section>

      <div className="adm-toolbar deal-toolbar">
        <label className="shop-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${info.singular}s…`} aria-label="Search" /></label>
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="sort-select"><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by type"><option value="all">All types</option><option value="display_only">Display Only</option><option value="actual_discount">Actual Discount</option></select></label>
        <button type="button" className="button button-outline" onClick={() => setPicking({})}><Package size={16} />Add Products</button>
        <button type="button" className="button button-primary" onClick={() => setEditing({})}><Plus size={16} />{info.add}</button>
      </div>

      <section className="adm-panel">
        {loading ? <Loader label="Loading" /> : !rows.length ? (filtersActive ? <EmptyState icon={BadgePercent} title="Nothing matches" message="Try changing your search or filters." action="" /> : <EmptyState icon={BadgePercent} title={`No ${info.singular}s yet`} message={`Use "${info.add}" to create the first one.`} action="" />) : <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Order</th><th>{section === 'seasonal_deals' ? 'Campaign' : 'Deal'}</th><th>Type</th><th>Applies to</th><th>Schedule</th><th>Status</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((promotion) => {
              const index = data.promotions.findIndex((entry) => entry._id === promotion._id)
              return <tr key={promotion._id}>
                <td data-label="Order"><span className="deal-order"><button type="button" className="icon-button" aria-label="Move up" disabled={filtersActive || index === 0 || busy === 'order'} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label="Move down" disabled={filtersActive || index === data.promotions.length - 1 || busy === 'order'} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></span></td>
                <td data-label="Title"><span className="adm-cell-stack"><strong>{nameOf(promotion, info)}</strong>{promotion.badgeText && <small>Badge: {promotion.badgeText}</small>}</span></td>
                <td data-label="Type">{promotion.promotionType === 'actual_discount' ? <span className="deal-type-pill is-discount">{promotion.discountLabel}</span> : <span className="deal-type-pill">Display Only</span>}</td>
                <td data-label="Applies to">{promotion.products.length} product{promotion.products.length === 1 ? '' : 's'}{promotion.categories.length > 0 && `, ${promotion.categories.join(', ')}`}{!promotion.products.length && !promotion.categories.length && <small className="deal-warning">No products yet, so customers see no product cards.</small>}{section === 'seasonal_deals' && promotion.products.length < MIN_SEASONAL_PRODUCTS && <small className="deal-warning">Needs at least {MIN_SEASONAL_PRODUCTS} products. Edit to add more.</small>}</td>
                <td data-label="Schedule"><span className="adm-cell-stack"><small>{formatWhen(promotion.startAt)}</small><small>to {formatWhen(promotion.endAt)}</small></span></td>
                <td data-label="Status"><span className={`status-pill status-${promotion.status}`}>{STATUS_LABELS[promotion.status]}</span></td>
                <td data-label="Active"><button type="button" role="switch" aria-checked={promotion.isActive} aria-label={`${nameOf(promotion, info)} active`} className={`deal-switch is-small${promotion.isActive ? ' is-on' : ''}`} disabled={busy === promotion._id} onClick={() => toggleActive(promotion)}><span /></button></td>
                <td data-label="Actions" className="adm-col-actions"><span className="adm-row-actions"><button type="button" className="table-action" onClick={() => setPicking(promotion)}><Package size={14} />Products</button><button type="button" className="table-action" onClick={() => setPreviewing(promotion)}><Eye size={14} />Preview</button><button type="button" className="table-action" onClick={() => setEditing(promotion)}><Pencil size={14} />Edit</button><button type="button" className="table-action is-danger" disabled={busy === promotion._id} onClick={() => remove(promotion)}><Trash2 size={14} />Delete</button></span></td>
              </tr>
            })}</tbody>
          </table>
        </div>}
        {filtersActive && <p className="adm-muted">Reordering is available when no search or filter is applied.</p>}
      </section>
    </>}

    {editing && <DealForm key={editing._id || 'new'} section={section} promotion={editing._id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    {picking && <DealProductPicker key={`${section}-${picking._id || 'any'}`} section={section} name={info.name} promotions={data?.promotions || []} initialPromotionId={picking._id} onClose={() => setPicking(null)} onChanged={() => load()} />}
    {previewing && <PreviewModal promotion={previewing} onClose={() => setPreviewing(null)} />}
  </div>
}
