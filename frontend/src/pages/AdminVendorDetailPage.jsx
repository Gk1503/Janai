import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Boxes, CalendarDays, Clock, Mail, MapPin, Pencil, Phone, Plus, Search, ShoppingBag, Tags } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, formatPrice } from '../components/UI'
import VendorFormModal from '../components/VendorFormModal'
import { VendorPurchaseHistoryModal } from '../components/VendorHistoryModals'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const PURCHASE_STATUS_FILTERS = ['All', 'Ordered', 'Received']

function ProfileItem({ icon: Icon, label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="adm-profile-item">
    <span className="adm-profile-icon"><Icon size={16} /></span>
    <div className="adm-profile-item-body"><small>{label}</small><strong>{children}</strong></div>
  </div>
}

function DetailRow({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="adm-detail-row"><dt>{label}</dt><dd>{children}</dd></div>
}

// Pure and exported so filtering can be unit-tested without rendering the page (this project's SSR
// test harness cannot simulate selecting an option).
export function filterProductsByCategory(products, category) {
  if (!category || category === 'All') return products
  return products.filter((product) => product.category === category)
}

// A unit-aware quantity total is never collapsed into one number — see the backend's own comment in
// adminVendorController.js for why (kg and L, say, must never be summed). This just renders whatever
// buckets the backend already computed.
export function formatQuantityByUnit(entries) {
  if (!entries || !entries.length) return '—'
  return entries.map((entry) => `${entry.quantity} ${entry.unit}`).join(', ')
}

// Whether Record Purchase should be offered at all, and why not otherwise. Pure and exported so this
// can be unit-tested without rendering the page. There is no existing backend rule tying purchase
// creation to a central vendor's Active/Inactive status (createPurchase in vendorController.js only
// ever resolves the embedded vendor row on the product — it has no concept of a central Vendor at
// all) — so this is a conservative, frontend-only guard for this new entry point specifically, not a
// change to existing purchase/receive behavior.
export function recordPurchaseAvailability(vendor, products) {
  if (!vendor) return { allowed: false, reason: '' }
  if (vendor.status === 'Inactive') return { allowed: false, reason: 'This vendor is inactive. Reactivate it before recording a new purchase.' }
  if (!products || !products.length) return { allowed: false, reason: 'No products are currently linked to this vendor.' }
  return { allowed: true, reason: '' }
}

// Purchase History (Stage 7): search by product name or invoice number, plus a status filter. Done
// entirely client-side over the already-fetched (and already date/product filtered server-side)
// `purchases` list — getVendorPurchases has never paginated, so the full matching set is already in
// memory and both fields it searches (productName, invoiceNumber) are already in that response; no
// backend change or extra request is needed for this. Pure and exported for the same reason every
// other filter helper in this codebase is: this SSR test harness cannot simulate typing/selecting.
export function filterPurchases(purchases, { search = '', status = 'All' } = {}) {
  const query = search.trim().toLowerCase()
  return (purchases || []).filter((purchase) => {
    const matchesSearch = !query
      || (purchase.productName || '').toLowerCase().includes(query)
      || (purchase.invoiceNumber || '').toLowerCase().includes(query)
    const matchesStatus = status === 'All' || purchase.status === status
    return matchesSearch && matchesStatus
  })
}

// A purely informational check — the backend already handles from > to safely (it just matches
// nothing), so this is only used to show a clearer reason than a silent empty list.
export function isInvalidDateRange(from, to) {
  return Boolean(from && to && from > to)
}

export default function AdminVendorDetailPage() {
  const { vendorId } = useParams()
  const { can } = useAuth()
  const toast = useToast()
  const [vendor, setVendor] = useState(null)
  const [vendorLoading, setVendorLoading] = useState(true)
  const [vendorError, setVendorError] = useState('')
  const [editing, setEditing] = useState(false)
  // null: closed. 'pick': choosing which linked product/row to record against (only shown when there's
  // more than one). Otherwise the chosen row itself, which is enough to open the real purchase form.
  const [recordPurchaseStep, setRecordPurchaseStep] = useState(null)
  const [pickedRowId, setPickedRowId] = useState('')

  const [products, setProducts] = useState([])
  const [productCount, setProductCount] = useState(0)
  const [categories, setCategories] = useState([])
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')

  const [purchases, setPurchases] = useState([])
  const [purchaseSummary, setPurchaseSummary] = useState(null)
  const [purchasesLoading, setPurchasesLoading] = useState(true)
  const [purchasesError, setPurchasesError] = useState('')
  const [purchaseProductFilter, setPurchaseProductFilter] = useState('')
  const [purchaseFrom, setPurchaseFrom] = useState('')
  const [purchaseTo, setPurchaseTo] = useState('')
  const [purchaseSearch, setPurchaseSearch] = useState('')
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState('All')
  const [purchaseDetailTarget, setPurchaseDetailTarget] = useState(null)
  const [receiveTarget, setReceiveTarget] = useState(null)
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState('')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')

  async function loadVendor() {
    setVendorLoading(true)
    try {
      const { data } = await api.get(`/vendors/${vendorId}`)
      setVendor(data.vendor)
      setVendorError('')
    } catch (requestError) {
      setVendorError(getApiError(requestError))
    } finally {
      setVendorLoading(false)
    }
  }
  useEffect(() => { loadVendor() }, [vendorId])

  async function loadProducts() {
    setProductsLoading(true)
    try {
      const { data } = await api.get(`/vendors/${vendorId}/products`)
      setProducts(data.products)
      setProductCount(data.productCount)
      setCategories(data.categories)
      setProductsError('')
    } catch (requestError) {
      setProductsError(getApiError(requestError))
    } finally {
      setProductsLoading(false)
    }
  }
  useEffect(() => { loadProducts() }, [vendorId])

  async function loadPurchases() {
    setPurchasesLoading(true)
    try {
      const params = {}
      if (purchaseProductFilter) params.productId = purchaseProductFilter
      if (purchaseFrom) params.from = purchaseFrom
      if (purchaseTo) params.to = purchaseTo
      const { data } = await api.get(`/vendors/${vendorId}/purchases`, { params })
      setPurchases(data.purchases)
      setPurchaseSummary(data.summary)
      setPurchasesError('')
    } catch (requestError) {
      setPurchasesError(getApiError(requestError))
    } finally {
      setPurchasesLoading(false)
    }
  }
  useEffect(() => { loadPurchases() }, [vendorId, purchaseProductFilter, purchaseFrom, purchaseTo])

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const { data } = await api.get(`/vendors/${vendorId}/price-history`)
      setHistory(data.history)
      setHistoryError('')
    } catch (requestError) {
      setHistoryError(getApiError(requestError))
    } finally {
      setHistoryLoading(false)
    }
  }
  useEffect(() => { loadHistory() }, [vendorId])

  const filteredProducts = filterProductsByCategory(products, categoryFilter)
  const recordAvailability = recordPurchaseAvailability(vendor, products)

  // Opens straight into the real purchase form when there's exactly one linked row to record against;
  // otherwise shows a product picker first so the right (product, embedded vendor) pair is unambiguous
  // — Stage 4 already established that one product can carry more than one row for this same vendor.
  function openRecordPurchase() {
    if (products.length === 1) setRecordPurchaseStep(products[0])
    else setRecordPurchaseStep('pick')
  }
  function confirmPickedRow() {
    const row = products.find((candidate) => candidate.vendorId === pickedRowId)
    if (row) setRecordPurchaseStep(row)
  }
  function closeRecordPurchase() {
    setRecordPurchaseStep(null)
    setPickedRowId('')
    loadPurchases() // vendor profile and the products list are left exactly as they were
  }

  const filteredPurchases = filterPurchases(purchases, { search: purchaseSearch, status: purchaseStatusFilter })
  const invalidDateRange = isInvalidDateRange(purchaseFrom, purchaseTo)
  const purchaseFiltersActive = Boolean(purchaseProductFilter) || Boolean(purchaseFrom) || Boolean(purchaseTo) || Boolean(purchaseSearch.trim()) || purchaseStatusFilter !== 'All'

  function resetPurchaseFilters() {
    setPurchaseProductFilter('')
    setPurchaseFrom('')
    setPurchaseTo('')
    setPurchaseSearch('')
    setPurchaseStatusFilter('All')
  }

  function closeReceiveDialog() {
    if (receiving) return
    setReceiveTarget(null)
    setReceiveError('')
  }

  // Reuses the exact same receive endpoint and full-receipt behavior as the existing
  // VendorPurchaseHistoryModal's own markReceived — only the confirmation UI differs (this shows
  // product/quantity/unit/total amount directly, instead of a plain window.confirm), per Stage 7.
  async function confirmReceive() {
    if (receiving || !receiveTarget) return
    setReceiving(true)
    setReceiveError('')
    try {
      await api.patch(`/products/${receiveTarget.productId}/vendors/${receiveTarget.vendorId}/purchases/${receiveTarget._id}/receive`)
      toast('Purchase received — stock updated.')
      setReceiveTarget(null)
      await loadPurchases() // refreshes both the purchase list (status) and the summary cards
    } catch (requestError) {
      setReceiveError(getApiError(requestError))
    } finally {
      setReceiving(false)
    }
  }

  return <div className="adm-products-page adm-vendors-page">
    <Link to="/admin/vendors" className="adm-back-link"><ArrowLeft size={15} />Back to Vendors</Link>

    {vendorLoading ? <section className="adm-panel"><Loader label="Loading vendor" /></section> : vendorError ? (
      <section className="adm-panel"><div className="inline-error">{vendorError}<button type="button" className="text-link" onClick={loadVendor}>Retry</button></div></section>
    ) : !vendor ? (
      <section className="adm-panel"><EmptyState title="Vendor not found" message="This vendor may no longer exist." /></section>
    ) : <>
      <div className="adm-page-head">
        <div><h1>{vendor.name}</h1><p><span className={`status-pill${vendor.status === 'Inactive' ? ' is-muted' : ''}`}>{vendor.status}</span></p></div>
        <button type="button" className="button button-outline" onClick={() => setEditing(true)}><Pencil size={15} />Edit Vendor</button>
      </div>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Vendor profile</h2>
        <div className="adm-profile-grid">
          <ProfileItem icon={Phone} label="Contact person">{vendor.contactPerson}</ProfileItem>
          <ProfileItem icon={Phone} label="Phone">{vendor.phone}</ProfileItem>
          <ProfileItem icon={Mail} label="Email">{vendor.email}</ProfileItem>
          <ProfileItem icon={MapPin} label="Address">{vendor.address}</ProfileItem>
          <ProfileItem icon={CalendarDays} label="Added on">{formatDate(vendor.createdAt)}</ProfileItem>
        </div>
        {vendor.notes && <p className="adm-muted">{vendor.notes}</p>}
      </section>

      {/* Received Goods Value / Ordered amounts come straight from getVendorPurchases (adminVendorController.js),
          which currently buckets by status alone because receiving is full-receipt-only today — see that
          function's own comment for what a future partial-receiving feature would need to change here. */}
      <section className="adm-metric-grid">
        <article className="adm-metric-card"><span className="adm-metric-icon"><Boxes size={18} /></span><small>Linked Products</small><strong>{productCount}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><Tags size={18} /></span><small>Categories</small><strong>{categories.length}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><ShoppingBag size={18} /></span><small>Received Goods Value</small><strong>{formatPrice(purchaseSummary?.received.amount || 0)}</strong><span className="adm-field-hint">{formatQuantityByUnit(purchaseSummary?.received.quantityByUnit)}</span></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><ShoppingBag size={18} /></span><small>Ordered, not yet received</small><strong>{formatPrice(purchaseSummary?.ordered.amount || 0)}</strong><span className="adm-field-hint">{formatQuantityByUnit(purchaseSummary?.ordered.quantityByUnit)}</span></article>
      </section>

      <p className="adm-muted">These figures represent the value of goods received or ordered, not payments made to vendors. Vendor payment tracking is not currently available.</p>

      <p className="adm-muted">These totals include only products and purchase/price history linked through this vendor&rsquo;s canonical record (its vendorRef). Older, unlinked vendor entries on individual products are not included here until they are explicitly linked.</p>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Products Supplied{products.length > 0 && <span className="adm-count-chip"><strong>{productCount}</strong></span>}</h2>
        {productsLoading ? <Loader label="Loading products" /> : productsError ? (
          <div className="inline-error">{productsError}<button type="button" className="text-link" onClick={loadProducts}>Retry</button></div>
        ) : !products.length ? (
          <EmptyState icon={Boxes} title="No linked products yet" message="No product currently links to this vendor's canonical record." />
        ) : <>
          <div className="adm-toolbar">
            <label className="sort-select"><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          {!filteredProducts.length ? <EmptyState title="No products in this category" message="Try a different category filter." /> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Product</th><th>Category</th><th>Purchase Price</th><th>MOQ</th><th>Last Purchase Price</th><th>Last Purchase Date</th></tr></thead>
                <tbody>
                  {filteredProducts.map((row) => <tr key={row.vendorId}>
                    <td>{row.productName}{row.preferred && <span className="status-pill">Preferred</span>}</td>
                    <td>{row.category}</td>
                    <td>{formatPrice(row.purchasePrice)}</td>
                    <td>{row.moq || '—'}</td>
                    <td>{row.lastPurchasePrice != null ? formatPrice(row.lastPurchasePrice) : '—'}</td>
                    <td>{formatDate(row.lastPurchaseDate)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>}
      </section>

      <section className="adm-panel">
        <div className="adm-page-head">
          <h2 className="adm-modal-section-title">Purchase History{filteredPurchases.length > 0 && <span className="adm-count-chip"><strong>{filteredPurchases.length}</strong></span>}</h2>
          {can('inventory:update') && (
            <button type="button" className="button button-primary" disabled={!recordAvailability.allowed} title={recordAvailability.reason || undefined} onClick={openRecordPurchase}><Plus size={15} />Record Purchase</button>
          )}
        </div>
        {can('inventory:update') && !recordAvailability.allowed && recordAvailability.reason && <p className="adm-muted">{recordAvailability.reason}</p>}
        {Boolean(products.length) && <div className="adm-toolbar">
          <label className="shop-search"><Search size={16} /><input value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Search by product name or invoice number…" aria-label="Search purchases" /></label>
          <label className="sort-select"><select value={purchaseStatusFilter} onChange={(event) => setPurchaseStatusFilter(event.target.value)} aria-label="Filter by status">{PURCHASE_STATUS_FILTERS.map((value) => <option key={value} value={value}>{value === 'All' ? 'All statuses' : value}</option>)}</select></label>
          <label className="sort-select"><select value={purchaseProductFilter} onChange={(event) => setPurchaseProductFilter(event.target.value)} aria-label="Filter by product">
            <option value="">All products</option>
            {Array.from(new Map(products.map((row) => [row.productId, row.productName])), ([productId, productName]) => <option key={productId} value={productId}>{productName}</option>)}
          </select></label>
          <label className="field"><span>From</span><input type="date" value={purchaseFrom} onChange={(event) => setPurchaseFrom(event.target.value)} /></label>
          <label className="field"><span>To</span><input type="date" value={purchaseTo} onChange={(event) => setPurchaseTo(event.target.value)} /></label>
          {purchaseFiltersActive && <button type="button" className="filter-reset" onClick={resetPurchaseFilters}>Clear filters</button>}
        </div>}
        {invalidDateRange && <p className="adm-muted">The "From" date is after the "To" date, so no purchases can match — adjust the range above.</p>}
        {purchasesLoading ? <Loader label="Loading purchase history" /> : purchasesError ? (
          <div className="inline-error">{purchasesError}<button type="button" className="text-link" onClick={loadPurchases}>Retry</button></div>
        ) : !purchases.length ? (
          <EmptyState icon={ShoppingBag} title="No purchases recorded yet" message="No purchase has been recorded for this vendor's linked products." />
        ) : !filteredPurchases.length ? (
          <EmptyState title="No purchases match" message="Try a different search, status or date range." />
        ) : (
          <div className="adm-history-list">
            {filteredPurchases.map((purchase) => <div className="adm-history-item" key={purchase._id}>
              <div className="adm-history-item-main">
                <span>{purchase.productName}</span>
                <span>{formatDate(purchase.purchaseDate)}</span>
                <span>{purchase.quantity} {purchase.unit} @ {formatPrice(purchase.rate)}</span>
                <strong>{formatPrice(purchase.totalAmount)}</strong>
                <span className={`status-pill${purchase.status === 'Ordered' ? ' is-muted' : ''}`}>{purchase.status}</span>
              </div>
              <div className="adm-history-item-meta">
                {purchase.invoiceNumber && <span>Ref: {purchase.invoiceNumber}</span>}
                {purchase.status === 'Received' && <span>Received {formatDateTime(purchase.receivedAt)} · {purchase.receivedQuantity} {purchase.unit}</span>}
              </div>
              <button type="button" className="text-link" onClick={() => setPurchaseDetailTarget(purchase)}>View Details</button>
              {purchase.status === 'Ordered' && can('inventory:update') && <button type="button" className="text-link" onClick={() => setReceiveTarget(purchase)}>Mark Received</button>}
            </div>)}
          </div>
        )}
      </section>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Price History{history.length > 0 && <span className="adm-count-chip"><strong>{history.length}</strong></span>}</h2>
        {historyLoading ? <Loader label="Loading price history" /> : historyError ? (
          <div className="inline-error">{historyError}<button type="button" className="text-link" onClick={loadHistory}>Retry</button></div>
        ) : !history.length ? (
          <EmptyState icon={Clock} title="No price changes yet" message="No purchase price change has been recorded for this vendor's linked products." />
        ) : (
          <div className="adm-history-list">
            {history.map((entry) => <div className="adm-history-item" key={entry._id}>
              <div className="adm-history-item-main">
                <span>{entry.productName}</span>
                <span className="adm-history-price-change">{formatPrice(entry.previousPrice)} → <strong>{formatPrice(entry.newPrice)}</strong></span>
                <span className={`adm-history-delta${entry.newPrice > entry.previousPrice ? ' is-up' : entry.newPrice < entry.previousPrice ? ' is-down' : ''}`}>
                  {entry.newPrice > entry.previousPrice ? '+' : ''}{formatPrice(entry.newPrice - entry.previousPrice)}
                </span>
              </div>
              <div className="adm-history-item-meta"><span>{formatDateTime(entry.createdAt)}</span>{entry.reason && <span>{entry.reason}</span>}</div>
            </div>)}
          </div>
        )}
      </section>
    </>}

    {editing && vendor && <VendorFormModal vendor={vendor} onClose={() => setEditing(false)} onSaved={setVendor} />}

    {recordPurchaseStep === 'pick' && <Modal title="Record Purchase — Choose a Product" onClose={() => { setRecordPurchaseStep(null); setPickedRowId('') }}>
      <p className="adm-modal-text">This vendor supplies more than one product (or procurement row). Choose which one this purchase is for.</p>
      <label className="field"><span>Product</span><select value={pickedRowId} onChange={(event) => setPickedRowId(event.target.value)}>
        <option value="">Select a product…</option>
        {products.map((row) => <option key={row.vendorId} value={row.vendorId}>{row.productName} — {formatPrice(row.purchasePrice)} purchase price</option>)}
      </select></label>
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={() => { setRecordPurchaseStep(null); setPickedRowId('') }}>Cancel</button>
        <button type="button" className="button button-primary" disabled={!pickedRowId} onClick={confirmPickedRow}>Continue</button>
      </div>
    </Modal>}

    {/* The matching EMBEDDED vendor subdocument _id (row.vendorId), never the central Vendor's own
        _id — the existing /products/:productId/vendors/:vendorId/purchases endpoint only understands
        the embedded id. Reuses the existing purchase form/logic completely unmodified beyond the
        additive autoOpenForm flag. */}
    {recordPurchaseStep && recordPurchaseStep !== 'pick' && vendor && <VendorPurchaseHistoryModal
      productId={recordPurchaseStep.productId}
      vendorId={recordPurchaseStep.vendorId}
      vendorName={vendor.name}
      unit={recordPurchaseStep.unit}
      autoOpenForm
      onClose={closeRecordPurchase}
    />}

    {purchaseDetailTarget && <Modal title="Purchase Details" onClose={() => setPurchaseDetailTarget(null)}>
      <dl className="adm-detail-list">
        <DetailRow label="Vendor">{vendor?.name}</DetailRow>
        <DetailRow label="Product">{purchaseDetailTarget.productName}</DetailRow>
        <DetailRow label="Purchase date">{formatDate(purchaseDetailTarget.purchaseDate)}</DetailRow>
        <DetailRow label="Quantity">{purchaseDetailTarget.quantity} {purchaseDetailTarget.unit}</DetailRow>
        <DetailRow label="Rate per unit">{formatPrice(purchaseDetailTarget.rate)}</DetailRow>
        <DetailRow label="Total amount">{formatPrice(purchaseDetailTarget.totalAmount)}</DetailRow>
        <DetailRow label="Invoice number">{purchaseDetailTarget.invoiceNumber || '—'}</DetailRow>
        <DetailRow label="Notes">{purchaseDetailTarget.notes || '—'}</DetailRow>
        <DetailRow label="Status">{purchaseDetailTarget.status}</DetailRow>
        <DetailRow label="Received quantity">{purchaseDetailTarget.status === 'Received' ? `${purchaseDetailTarget.receivedQuantity ?? 0} ${purchaseDetailTarget.unit}` : '—'}</DetailRow>
        <DetailRow label="Received date">{purchaseDetailTarget.receivedAt ? formatDateTime(purchaseDetailTarget.receivedAt) : '—'}</DetailRow>
      </dl>
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={() => setPurchaseDetailTarget(null)}>Close</button>
      </div>
    </Modal>}

    {receiveTarget && <Modal title="Mark Purchase as Received?" onClose={closeReceiveDialog}>
      <p className="adm-modal-text">This records the full ordered quantity as received and adds it to stock. There is no partial receiving — the whole order is marked received at once.</p>
      <dl className="adm-detail-list">
        <DetailRow label="Product">{receiveTarget.productName}</DetailRow>
        <DetailRow label="Quantity">{receiveTarget.quantity} {receiveTarget.unit}</DetailRow>
        <DetailRow label="Total amount">{formatPrice(receiveTarget.totalAmount)}</DetailRow>
      </dl>
      {receiveError && <div className="form-error">{receiveError}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={closeReceiveDialog} disabled={receiving}>Cancel</button>
        <button type="button" className="button button-primary" onClick={confirmReceive} disabled={receiving}>{receiving ? 'Receiving…' : 'Mark Received'}</button>
      </div>
    </Modal>}
  </div>
}
