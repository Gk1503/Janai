import { useEffect, useState } from 'react'
import { BarChart3, Boxes, Download, ShoppingBag, Tags } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, formatPrice } from './UI'

const STATUS_FILTERS = ['All', 'Ordered', 'Received']
const VENDOR_SORT_OPTIONS = [
  { value: 'orderedAmount', label: 'Ordered Value' },
  { value: 'receivedAmount', label: 'Received Goods Value' },
  { value: 'purchaseCount', label: 'Purchase Count' },
]

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// Mirrors AdminVendorDetailPage.jsx's own formatQuantityByUnit exactly (kg and L, say, must never be
// summed into one number) — kept as its own small copy here rather than a cross-page import, so this
// component and that page stay fully independent of each other.
function formatQuantityByUnit(entries) {
  if (!entries || !entries.length) return '—'
  return entries.map((entry) => `${entry.quantity} ${entry.unit}`).join(', ')
}

// Pure and exported so sorting can be unit-tested without rendering the component or simulating a
// select change (this project's SSR test harness cannot fire those events).
export function sortVendorRows(rows, sortBy, direction = 'desc') {
  const key = ['orderedAmount', 'receivedAmount', 'purchaseCount'].includes(sortBy) ? sortBy : 'orderedAmount'
  const sorted = [...(rows || [])].sort((a, b) => (a[key] || 0) - (b[key] || 0))
  return direction === 'asc' ? sorted : sorted.reverse()
}

const blankFilters = { vendorId: '', productId: '', status: 'All', from: '', to: '' }

export default function VendorAnalytics({ vendors }) {
  const toast = useToast()
  const [filters, setFilters] = useState(blankFilters)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [vendorSort, setVendorSort] = useState('orderedAmount')
  const [vendorSortDirection, setVendorSortDirection] = useState('desc')

  function buildParams() {
    const params = {}
    if (filters.vendorId) params.vendorId = filters.vendorId
    if (filters.productId) params.productId = filters.productId
    if (filters.status !== 'All') params.status = filters.status
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    return params
  }

  async function load() {
    setLoading(true)
    try {
      const { data: response } = await api.get('/vendors/analytics', { params: buildParams() })
      setData(response)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [filters.vendorId, filters.productId, filters.status, filters.from, filters.to])

  function setFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }))
  }
  const filtersActive = Boolean(filters.vendorId) || Boolean(filters.productId) || filters.status !== 'All' || Boolean(filters.from) || Boolean(filters.to)
  function resetFilters() { setFilters(blankFilters) }

  async function handleExport() {
    setExporting(true)
    try {
      const response = await api.get('/vendors/analytics/export', { params: buildParams(), responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = `vendor-purchases-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setExporting(false)
    }
  }

  const productOptions = data ? Array.from(new Map(data.byProduct.map((row) => [row.productId, row.productName]))) : []
  const sortedVendors = data ? sortVendorRows(data.byVendor, vendorSort, vendorSortDirection) : []
  const maxMonthlyAmount = data ? Math.max(1, ...data.monthly.flatMap((month) => [month.orderedAmount, month.receivedAmount])) : 1

  return <section className="adm-panel">
    <div className="adm-page-head">
      <div><h2 className="adm-modal-section-title"><BarChart3 size={16} />Vendor Analytics</h2><p>Purchase trends and comparisons across every vendor linked through its canonical record.</p></div>
      <button type="button" className="button button-outline" disabled={exporting || loading} onClick={handleExport}><Download size={15} />{exporting ? 'Exporting…' : 'Export to Excel'}</button>
    </div>

    <div className="adm-toolbar">
      <label className="sort-select"><select value={filters.vendorId} onChange={(event) => setFilter('vendorId', event.target.value)} aria-label="Filter by vendor">
        <option value="">All vendors</option>
        {vendors.map((vendor) => <option key={vendor._id} value={vendor._id}>{vendor.name}</option>)}
      </select></label>
      <label className="sort-select"><select value={filters.productId} onChange={(event) => setFilter('productId', event.target.value)} aria-label="Filter by product">
        <option value="">All products</option>
        {productOptions.map(([productId, productName]) => <option key={productId} value={productId}>{productName}</option>)}
      </select></label>
      <label className="sort-select"><select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} aria-label="Filter by status">{STATUS_FILTERS.map((value) => <option key={value} value={value}>{value === 'All' ? 'All statuses' : value}</option>)}</select></label>
      <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} /></label>
      <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} /></label>
      {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
    </div>

    <p className="adm-muted">These figures represent purchase/goods values, not payments made to vendors — Janai does not track vendor payments. Legacy embedded vendor rows with no canonical link are excluded from every table and chart below until they are explicitly linked to a central vendor.</p>

    {loading ? <Loader label="Loading vendor analytics" /> : error ? (
      <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
    ) : !data || (!data.byVendor.length && !data.byProduct.length) ? (
      <EmptyState icon={BarChart3} title="No purchase data yet" message="Record a vendor purchase to see analytics here." />
    ) : <>
      <section className="adm-metric-grid">
        <article className="adm-metric-card"><small>Active Vendors</small><strong>{data.summary.activeVendorCount}</strong></article>
        <article className="adm-metric-card"><small>Linked Products</small><strong>{data.summary.linkedProductCount}</strong></article>
        <article className="adm-metric-card"><small>Ordered Value</small><strong>{formatPrice(data.summary.ordered.amount)}</strong><span className="adm-field-hint">{formatQuantityByUnit(data.summary.ordered.quantityByUnit)}</span></article>
        <article className="adm-metric-card"><small>Received Goods Value</small><strong>{formatPrice(data.summary.received.amount)}</strong><span className="adm-field-hint">{formatQuantityByUnit(data.summary.received.quantityByUnit)}</span></article>
      </section>

      <div className="adm-soft-section">
        <div className="adm-form-section-head"><ShoppingBag size={16} /><h3>Vendor-wise Purchase Analysis</h3></div>
        <div className="adm-toolbar">
          <label className="sort-select"><select value={vendorSort} onChange={(event) => setVendorSort(event.target.value)} aria-label="Sort vendors by">{VENDOR_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="sort-select"><select value={vendorSortDirection} onChange={(event) => setVendorSortDirection(event.target.value)} aria-label="Sort direction"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
        </div>
        {!sortedVendors.length ? <EmptyState title="No vendor purchases match" message="Try different filters." /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Vendor</th><th>Purchases</th><th>Ordered Value</th><th>Received Goods Value</th><th>Last Purchase</th></tr></thead>
              <tbody>
                {sortedVendors.map((vendor) => <tr key={vendor.vendorId}>
                  <td>{vendor.vendorName}</td>
                  <td>{vendor.purchaseCount}</td>
                  <td>{formatPrice(vendor.orderedAmount)}</td>
                  <td>{formatPrice(vendor.receivedAmount)}</td>
                  <td>{formatDate(vendor.lastPurchaseDate)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adm-soft-section">
        <div className="adm-form-section-head"><Boxes size={16} /><h3>Most Frequently Purchased Products</h3></div>
        {!data.byProduct.length ? <EmptyState title="No product purchases match" message="Try different filters." /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Vendor</th><th>Purchases</th><th>Ordered Qty</th><th>Received Qty</th><th>Value</th></tr></thead>
              <tbody>
                {data.byProduct.map((row) => <tr key={`${row.productId}:${row.vendorId || 'unlinked'}`}>
                  <td>{row.productName}</td>
                  <td>{row.vendorName || '—'}</td>
                  <td>{row.purchaseCount}</td>
                  <td>{formatQuantityByUnit(row.orderedQuantityByUnit)}</td>
                  <td>{formatQuantityByUnit(row.receivedQuantityByUnit)}</td>
                  <td>{formatPrice(row.totalAmount)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adm-soft-section">
        <div className="adm-form-section-head"><Tags size={16} /><h3>Product-wise Vendor Price Comparison</h3></div>
        <p className="adm-form-section-description">Only products supplied by more than one central vendor are shown. A vendor's "Previous Rate" only ever compares against that same vendor's own prior purchase in the same unit.</p>
        {!data.priceComparison.length ? <EmptyState title="No comparable products" message="No product is currently supplied by more than one central vendor in the selected range." /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Vendor</th><th>Latest Rate</th><th>Unit</th><th>Previous Rate</th><th>Difference</th></tr></thead>
              <tbody>
                {data.priceComparison.map((row) => <tr key={`${row.productId}:${row.vendorId}`}>
                  <td>{row.productName}</td>
                  <td>{row.vendorName}</td>
                  <td>{formatPrice(row.latestRate)}</td>
                  <td>{row.unit}</td>
                  <td>{row.previousRate != null ? formatPrice(row.previousRate) : '—'}</td>
                  <td>{row.difference != null ? <span className={`adm-history-delta${row.difference > 0 ? ' is-up' : row.difference < 0 ? ' is-down' : ''}`}>{row.difference > 0 ? '+' : ''}{formatPrice(row.difference)}</span> : '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adm-soft-section">
        <div className="adm-form-section-head"><BarChart3 size={16} /><h3>Monthly Purchase Trends</h3></div>
        {!data.monthly.length ? <EmptyState title="No purchases in range" message="Try a wider date range." /> : <>
          <svg viewBox={`0 0 ${Math.max(1, data.monthly.length) * 70} 160`} style={{ width: '100%', height: 'auto', maxWidth: 640, display: 'block' }} role="img" aria-label="Monthly ordered and received purchase value">
            {data.monthly.map((month, index) => {
              const x = index * 70
              const orderedHeight = (month.orderedAmount / maxMonthlyAmount) * 120
              const receivedHeight = (month.receivedAmount / maxMonthlyAmount) * 120
              return <g key={month.month}>
                <rect x={x + 10} y={130 - orderedHeight} width="20" height={orderedHeight} fill="#cfe0c8" />
                <rect x={x + 35} y={130 - receivedHeight} width="20" height={receivedHeight} fill="var(--green)" />
                <text x={x + 32} y="148" fontSize="10" textAnchor="middle" fill="var(--muted)">{month.month.slice(5)}</text>
              </g>
            })}
          </svg>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Month</th><th>Purchases</th><th>Ordered Value</th><th>Received Goods Value</th></tr></thead>
              <tbody>
                {data.monthly.map((month) => <tr key={month.month}>
                  <td>{month.month}</td>
                  <td>{month.purchaseCount}</td>
                  <td>{formatPrice(month.orderedAmount)}</td>
                  <td>{formatPrice(month.receivedAmount)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </>}
      </div>
    </>}
  </section>
}
