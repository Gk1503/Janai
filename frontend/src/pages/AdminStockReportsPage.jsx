import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader } from '../components/UI'
import { localDate } from '../utils/validation'

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

const SOURCE_LABELS = {
  manual: 'Manual adjustment',
  order_placed: 'Order placed',
  order_cancelled: 'Order cancelled',
  preorder_confirmed: 'Pre-order confirmed',
  bulk_approved: 'Bulk order approved',
  bulk_rejected: 'Bulk order rejected',
  vendor_received: 'Vendor purchase received',
}
const TYPE_LABELS = { add: 'Add', remove: 'Remove', set_exact: 'Set Exact' }
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const PRODUCT_PAGE_LIMIT = 20

function ProductReportPagination({ page, pages, onChange }) {
  if (pages <= 1) return null
  return <nav className="adm-pagination" aria-label="Product report pages">
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span className="adm-muted">Page {page} of {pages}</span>
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

// Pure and exported so the date-preset math (today/yesterday/last7/last30/thisMonth/custom) can be
// unit-tested without rendering the page. Resolves to the YYYY-MM-DD pair the backend expects — the
// backend itself interprets these as Asia/Kolkata local dates (see stockReportController.js), so this
// only ever needs the browser's own local "today", exactly like the existing checkout date picker
// (utils/validation.js's localDate) already assumes for this India-only app.
export function resolveReportRange(preset, customFrom, customTo) {
  if (preset === 'custom') {
    if (!customFrom || !customTo) return { error: 'Choose both a start and end date.' }
    if (customFrom > customTo) return { error: 'The start date must be on or before the end date.' }
    return { from: customFrom, to: customTo }
  }
  if (preset === 'today') return { from: localDate(0), to: localDate(0) }
  if (preset === 'yesterday') return { from: localDate(-1), to: localDate(-1) }
  if (preset === 'last7') return { from: localDate(-6), to: localDate(0) }
  if (preset === 'last30') return { from: localDate(-29), to: localDate(0) }
  if (preset === 'thisMonth') {
    const now = new Date()
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: localDate(0) }
  }
  return { error: 'Choose a date range.' }
}

export default function AdminStockReportsPage() {
  // Defaults to the last 30 days (Phase 7.3) — a wider default window than Phases 7.1/7.2 originally
  // shipped with, since the product-wise report's opening/closing-unavailable rows are far more common
  // over a short window; custom ranges remain fully selectable regardless, and every other preset
  // (today/yesterday/last7/thisMonth) is unaffected.
  const [preset, setPreset] = useState('last30')
  const [customFrom, setCustomFrom] = useState(localDate(-29))
  const [customTo, setCustomTo] = useState(localDate(0))
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [staffSummary, setStaffSummary] = useState(null)
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [variationFilter, setVariationFilter] = useState('')
  const [productPage, setProductPage] = useState(1)
  const [productSummary, setProductSummary] = useState(null)
  const [productLoading, setProductLoading] = useState(true)
  const [productError, setProductError] = useState('')

  async function load() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setError(range.error); setSummary(null); setLoading(false); return }
    setLoading(true)
    try {
      const { data } = await api.get('/stock/reports/summary', { params: { from: range.from, to: range.to } })
      setSummary(data)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadStaff() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setStaffError(range.error); setStaffSummary(null); setStaffLoading(false); return }
    setStaffLoading(true)
    try {
      const { data } = await api.get('/stock/reports/staff', { params: { from: range.from, to: range.to } })
      setStaffSummary(data)
      setStaffError('')
    } catch (requestError) {
      setStaffError(getApiError(requestError))
      setStaffSummary(null)
    } finally {
      setStaffLoading(false)
    }
  }

  async function loadProducts() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setProductError(range.error); setProductSummary(null); setProductLoading(false); return }
    setProductLoading(true)
    try {
      const params = { from: range.from, to: range.to, page: productPage, limit: PRODUCT_PAGE_LIMIT }
      if (productFilter.trim()) params.product = productFilter.trim()
      if (productFilter.trim() && variationFilter.trim()) params.variationId = variationFilter.trim()
      const { data } = await api.get('/stock/reports/products', { params })
      setProductSummary(data)
      setProductError('')
    } catch (requestError) {
      setProductError(getApiError(requestError))
      setProductSummary(null)
    } finally {
      setProductLoading(false)
    }
  }

  useEffect(() => { load(); loadStaff() }, [preset, customFrom, customTo])
  // A changed date range or filter always restarts at page 1 — a stale page number from a previous,
  // larger result set must never be carried into a new query.
  useEffect(() => { setProductPage(1) }, [preset, customFrom, customTo, productFilter, variationFilter])
  useEffect(() => { loadProducts() }, [preset, customFrom, customTo, productFilter, variationFilter, productPage])

  const hasMovements = Boolean(summary?.byUnit?.length)
  const hasStaffAdjustments = Boolean(staffSummary?.staff?.length)
  const hasProductRows = Boolean(productSummary?.rows?.length)

  return <div className="adm-reports-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Reports</h1><p>Inventory movement summary — stock added and removed across your chosen date range.</p></div>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="sort-select"><select value={preset} onChange={(event) => setPreset(event.target.value)} aria-label="Date range">{PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {preset === 'custom' && <>
          <label className="field"><span>From</span><input type="date" value={customFrom} max={localDate(0)} onChange={(event) => setCustomFrom(event.target.value)} aria-label="Custom range start date" /></label>
          <label className="field"><span>To</span><input type="date" value={customTo} max={localDate(0)} onChange={(event) => setCustomTo(event.target.value)} aria-label="Custom range end date" /></label>
        </>}
      </div>
      {summary && !error && <p className="adm-muted">Showing {summary.from} to {summary.to}.</p>}
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading inventory movement summary" /> : error ? (
        <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
      ) : !hasMovements ? (
        <EmptyState icon={BarChart3} title="No stock movements in this range" message="Try a wider date range." />
      ) : <>
        <h2 className="adm-modal-section-title">Inventory Movement Summary</h2>
        <div className="adm-report-unit-grid">
          {summary.byUnit.map((row) => <article className="adm-report-unit-card" key={row.unit}>
            <strong className="adm-report-unit-name">{row.unit}</strong>
            <div className="adm-report-unit-figures">
              <div><small>Added</small><strong>+{row.added} {row.unit}</strong></div>
              <div><small>Removed</small><strong>-{row.removed} {row.unit}</strong></div>
              <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
              <div><small>Movements</small><strong>{row.movementCount}</strong></div>
            </div>
          </article>)}
        </div>
        <p className="adm-muted">Quantities of different units are never combined into one total.</p>

        <h2 className="adm-modal-section-title">Additions &amp; Removals by Source</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Source</th><th>Unit</th><th>Added</th><th>Removed</th><th>Net</th><th>Movements</th></tr></thead>
            <tbody>{summary.bySource.map((row) => <tr key={`${row.source}-${row.unit}`}>
              <td>{SOURCE_LABELS[row.source] || row.source}</td>
              <td>{row.unit}</td>
              <td>+{row.added}</td>
              <td>-{row.removed}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <h2 className="adm-modal-section-title">Additions &amp; Removals by Movement Type</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Type</th><th>Unit</th><th>Added</th><th>Removed</th><th>Net</th><th>Movements</th></tr></thead>
            <tbody>{summary.byType.map((row) => <tr key={`${row.type}-${row.unit}`}>
              <td>{TYPE_LABELS[row.type] || row.type}</td>
              <td>{row.unit}</td>
              <td>+{row.added}</td>
              <td>-{row.removed}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>

    <section className="adm-panel">
      {staffLoading ? <Loader label="Loading staff adjustment report" /> : staffError ? (
        <div className="inline-error">{staffError}<button type="button" className="text-link" onClick={loadStaff}>Retry</button></div>
      ) : !hasStaffAdjustments ? (
        <EmptyState icon={BarChart3} title="No manual adjustments in this range" message="Try a wider date range." />
      ) : <>
        <h2 className="adm-modal-section-title">Staff Adjustment Report</h2>
        <p className="adm-muted">Manual stock adjustments only — automatic movements from orders, pre-orders, bulk orders and vendor purchases are excluded.</p>
        {staffSummary.staff.map((entry) => {
          const primaryName = entry.nameHistory[0]?.name || 'Unknown staff'
          return <article className="adm-staff-card" key={entry.actorId}>
            <header className="adm-staff-card-head">
              <div>
                <div className="adm-staff-card-name">{primaryName}</div>
                {entry.nameHistory.length > 1 && <details className="adm-staff-namehistory">
                  <summary>{entry.nameHistory.length} historical names</summary>
                  <ul>{entry.nameHistory.map((item) => <li key={item.name}>{item.name} — {item.adjustmentCount} adjustment{item.adjustmentCount === 1 ? '' : 's'} (last {formatDateTime(item.lastSeenAt)})</li>)}</ul>
                </details>}
              </div>
              <div className="adm-staff-card-stats">
                <div><small>Total adjustments</small><strong>{entry.totalAdjustments}</strong></div>
                <div><small>Set Exact</small><strong>{entry.setExactCount}</strong></div>
                <div><small>Last adjustment</small><strong>{formatDateTime(entry.lastAdjustmentAt)}</strong></div>
              </div>
            </header>

            <div className="adm-report-unit-grid">
              {entry.byUnit.map((row) => <article className="adm-report-unit-card" key={row.unit}>
                <strong className="adm-report-unit-name">{row.unit}</strong>
                <div className="adm-report-unit-figures">
                  <div><small>Added</small><strong>+{row.added} {row.unit}</strong></div>
                  <div><small>Removed</small><strong>-{row.removed} {row.unit}</strong></div>
                  <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
                  <div><small>Adjustments</small><strong>{row.count}</strong></div>
                </div>
              </article>)}
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Reason</th><th>Adjustments</th></tr></thead>
                <tbody>{entry.byReason.map((row) => <tr key={row.reason}><td>{row.reason}</td><td>{row.count}</td></tr>)}</tbody>
              </table>
            </div>
          </article>
        })}
      </>}
    </section>

    <section className="adm-panel">
      <h2 className="adm-modal-section-title">Product-wise Inventory Movement</h2>
      <p className="adm-muted">Ledger-recorded quantities grouped by product, variation and their historically recorded unit. A product's unit can change without a ledger entry, so opening and closing balances cannot be verified from this data and are always shown as unavailable below.</p>

      <div className="adm-toolbar">
        <label className="field">
          <span>Product ID</span>
          <input type="text" value={productFilter} onChange={(event) => { setProductFilter(event.target.value); if (!event.target.value.trim()) setVariationFilter('') }} placeholder="Optional" aria-label="Filter by product ID" />
        </label>
        <label className="field">
          <span>Variation ID</span>
          <input type="text" value={variationFilter} onChange={(event) => setVariationFilter(event.target.value)} placeholder="Optional — requires a product ID" aria-label="Filter by variation ID" disabled={!productFilter.trim()} />
        </label>
        {(productFilter || variationFilter) && <button type="button" className="text-link" onClick={() => { setProductFilter(''); setVariationFilter('') }}>Clear filters</button>}
      </div>

      {productLoading ? <Loader label="Loading product-wise inventory report" /> : productError ? (
        <div className="inline-error">{productError}<button type="button" className="text-link" onClick={loadProducts}>Retry</button></div>
      ) : !hasProductRows ? (
        <EmptyState icon={BarChart3} title="No ledger-recorded movements in this range" message="Try a wider date range, or clear the product/variation filters." />
      ) : <>
        <div className="admin-table-wrap adm-product-report-table">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Variation</th><th>Unit</th><th>Incoming</th><th>Outgoing</th><th>Net</th><th>Movements</th><th>Opening</th><th>Closing</th></tr></thead>
            <tbody>{productSummary.rows.map((row) => <tr key={`${row.productId}-${row.variationId}-${row.unit}`}>
              <td>{row.productName}{row.isDeleted && <> <span className="status-pill is-muted">Deleted</span></>}</td>
              <td>{row.variationLabel}</td>
              <td>{row.unit}</td>
              <td>+{row.incoming}</td>
              <td>-{row.outgoing}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
              <td><span className="adm-balance-unavailable" title="Cannot be verified — a unit change leaves no ledger trace, so continuity cannot be proven.">Unavailable</span></td>
              <td><span className="adm-balance-unavailable" title="Cannot be verified — a unit change leaves no ledger trace, so continuity cannot be proven.">Unavailable</span></td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="adm-product-report-cards">
          {productSummary.rows.map((row) => <article className="adm-product-row-card" key={`${row.productId}-${row.variationId}-${row.unit}`}>
            <div className="adm-product-row-card-head">
              <strong>{row.productName}{row.isDeleted && <> <span className="status-pill is-muted">Deleted</span></>}</strong>
              <span className="adm-muted">{row.variationLabel} · {row.unit}</span>
            </div>
            <div className="adm-product-row-card-figures">
              <div><small>Incoming</small><strong>+{row.incoming} {row.unit}</strong></div>
              <div><small>Outgoing</small><strong>-{row.outgoing} {row.unit}</strong></div>
              <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
              <div><small>Movements</small><strong>{row.movementCount}</strong></div>
            </div>
            <p className="adm-balance-unavailable">Opening and closing balances are unavailable — a unit change leaves no ledger trace, so continuity cannot be proven.</p>
          </article>)}
        </div>

        <ProductReportPagination page={productSummary.page} pages={productSummary.pages} onChange={setProductPage} />
      </>}
    </section>
  </div>
}
