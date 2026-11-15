import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader, Modal } from './UI'

const TYPE_FILTERS = [
  { value: 'All', label: 'All Types' },
  { value: 'add', label: 'Add' },
  { value: 'remove', label: 'Remove' },
  { value: 'set_exact', label: 'Set Exact' },
]
const TYPE_LABEL = { add: 'Add', remove: 'Remove', set_exact: 'Set Exact' }
const PAGE_SIZE = 20

// Pure and exported so it can be unit-tested without rendering the component. Mirrors the
// add=positive/remove=negative/set_exact=neutral convention requested for the type badge.
export function movementTypeBadgeClass(type) {
  if (type === 'add') return 'status-pill'
  if (type === 'remove') return 'status-pill is-muted'
  return 'status-pill is-neutral'
}

// Pure and exported. A difference of exactly 0 (a Set Exact that didn't actually change anything) is
// shown plainly, never with a misleading "+0" or a colored up/down tone.
export function formatSignedDifference(difference, unit) {
  if (difference > 0) return `+${difference} ${unit}`
  if (difference < 0) return `${difference} ${unit}`
  return `0 ${unit}`
}
export function differenceClass(difference) {
  if (difference > 0) return 'is-up'
  if (difference < 0) return 'is-down'
  return ''
}

const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

const blankFilters = { productName: '', type: 'All', actor: '', from: '', to: '' }

// Self-contained: owns its own data/filters/pagination, independent of AdminStockPage's Current Stock
// state — so switching views never disturbs the other tab's filters or in-progress edits.
export default function StockMovementHistory() {
  const [filtersInput, setFiltersInput] = useState(blankFilters)
  const [filters, setFilters] = useState(blankFilters)
  const [page, setPage] = useState(1)
  const [movements, setMovements] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actors, setActors] = useState([])
  // Best-effort annotation only, from a single unfiltered snapshot of current stock — never used to
  // decide what to display, only to label a historical product as no longer in the live catalog.
  const [existingProductNames, setExistingProductNames] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)
  const searchTimer = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const params = { page, limit: PAGE_SIZE }
      if (filters.productName.trim()) params.productName = filters.productName.trim()
      if (filters.type !== 'All') params.type = filters.type
      if (filters.actor) params.actor = filters.actor
      if (filters.from) params.from = filters.from
      if (filters.to) params.to = filters.to
      const { data } = await api.get('/stock/movements', { params })
      setMovements(data.movements)
      setTotal(data.total)
      setPages(data.pages)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [page, filters])
  useEffect(() => { setPage(1) }, [filters])
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  useEffect(() => {
    api.get('/stock/movements/actors').then(({ data }) => setActors(data.actors)).catch(() => {})
    // Unfiltered, capped at the API's own max — an approximation for catalogs under that size, used
    // only to label a history row as no longer in the live catalog, never to decide what is shown.
    api.get('/stock', { params: { limit: 100 } }).then(({ data }) => setExistingProductNames(new Set(data.rows.map((row) => row.productName)))).catch(() => {})
  }, [])

  function onProductNameInput(value) {
    setFiltersInput((current) => ({ ...current, productName: value }))
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => setFilters((current) => ({ ...current, productName: value })), 350)
  }
  function setFilter(field, value) {
    setFiltersInput((current) => ({ ...current, [field]: value }))
    setFilters((current) => ({ ...current, [field]: value }))
  }
  function resetFilters() {
    setFiltersInput(blankFilters)
    setFilters(blankFilters)
  }
  const filtersActive = Boolean(filters.productName.trim()) || filters.type !== 'All' || Boolean(filters.actor) || Boolean(filters.from) || Boolean(filters.to)

  function isKnownProduct(name) {
    return !existingProductNames || existingProductNames.has(name)
  }

  return <div className="adm-movement-history">
    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input value={filtersInput.productName} onChange={(event) => onProductNameInput(event.target.value)} placeholder="Search by product name…" aria-label="Search movements by product" /></label>
        <label className="sort-select"><select value={filtersInput.type} onChange={(event) => setFilter('type', event.target.value)} aria-label="Filter by movement type">{TYPE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="sort-select"><select value={filtersInput.actor} onChange={(event) => setFilter('actor', event.target.value)} aria-label="Filter by staff member">
          <option value="">All staff</option>
          {actors.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <label className="field"><span>From</span><input type="date" value={filtersInput.from} onChange={(event) => setFilter('from', event.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" value={filtersInput.to} onChange={(event) => setFilter('to', event.target.value)} /></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading movement history" /> : error ? (
        <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
      ) : !movements.length ? (
        <EmptyState title={filtersActive ? 'No movements match' : 'No stock movements recorded yet'} message={filtersActive ? 'Try a different search, type, staff member or date range.' : 'Manual stock adjustments will appear here once made.'} />
      ) : <>
        {/* Desktop/tablet: a full table, horizontally scrollable if the viewport is too narrow (same
            convention as every other admin table). Hidden below the mobile breakpoint via CSS, not JS,
            so both this and the card list below always render — no hydration/width-detection logic. */}
        <div className="admin-table-wrap adm-movement-table">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Stock Change</th><th>Reason</th><th>Staff</th><th></th></tr></thead>
            <tbody>
              {movements.map((movement) => <tr key={movement._id}>
                <td>{formatDateTime(movement.createdAt)}</td>
                <td>{movement.productName}{movement.variationLabel && movement.variationLabel !== 'Default' && ` — ${movement.variationLabel}`}{!isKnownProduct(movement.productName) && <span className="adm-field-hint">No longer in catalog</span>}</td>
                <td><span className={movementTypeBadgeClass(movement.type)}>{TYPE_LABEL[movement.type]}</span></td>
                <td>{movement.previousStock} → {movement.newStock} {movement.unit} <span className={`adm-history-delta ${differenceClass(movement.difference)}`}>({formatSignedDifference(movement.difference, movement.unit)})</span></td>
                <td>{movement.reason}</td>
                <td>{movement.actor.name}</td>
                <td><button type="button" className="text-link" onClick={() => setDetailTarget(movement)}>View Details</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>

        {/* Mobile: readable cards instead of a forced-wide table — staff name and the remaining fields
            are available through the details modal, per the requested mobile layout. */}
        <div className="adm-history-list adm-movement-cards">
          {movements.map((movement) => <div className="adm-history-item" key={movement._id}>
            <div className="adm-history-item-main">
              <span>{movement.productName}{movement.variationLabel && movement.variationLabel !== 'Default' ? ` — ${movement.variationLabel}` : ''}</span>
              <span className={movementTypeBadgeClass(movement.type)}>{TYPE_LABEL[movement.type]}</span>
            </div>
            <div className="adm-history-item-main">
              <span>{movement.previousStock} → {movement.newStock} {movement.unit}</span>
              <span className={`adm-history-delta ${differenceClass(movement.difference)}`}>{formatSignedDifference(movement.difference, movement.unit)}</span>
            </div>
            <div className="adm-history-item-meta"><span>{movement.reason}</span><span>{formatDateTime(movement.createdAt)}</span></div>
            <button type="button" className="text-link" onClick={() => setDetailTarget(movement)}>View Details</button>
          </div>)}
        </div>

        {pages > 1 && <nav className="adm-pagination" aria-label="Movement history pages">
          <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={page === pages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </nav>}
        <p className="adm-muted">{total} movement{total === 1 ? '' : 's'} total.</p>
      </>}
    </section>

    {detailTarget && <Modal title="Movement Details" onClose={() => setDetailTarget(null)}>
      <dl className="adm-detail-list">
        <div className="adm-detail-row"><dt>Product</dt><dd>{detailTarget.productName}</dd></div>
        <div className="adm-detail-row"><dt>Variation</dt><dd>{detailTarget.variationLabel}</dd></div>
        <div className="adm-detail-row"><dt>Unit</dt><dd>{detailTarget.unit}</dd></div>
        <div className="adm-detail-row"><dt>Movement type</dt><dd><span className={movementTypeBadgeClass(detailTarget.type)}>{TYPE_LABEL[detailTarget.type]}</span></dd></div>
        <div className="adm-detail-row"><dt>Previous stock</dt><dd>{detailTarget.previousStock} {detailTarget.unit}</dd></div>
        <div className="adm-detail-row"><dt>New stock</dt><dd>{detailTarget.newStock} {detailTarget.unit}</dd></div>
        <div className="adm-detail-row"><dt>Difference</dt><dd className={`adm-history-delta ${differenceClass(detailTarget.difference)}`}>{formatSignedDifference(detailTarget.difference, detailTarget.unit)}</dd></div>
        <div className="adm-detail-row"><dt>Reason</dt><dd>{detailTarget.reason}</dd></div>
        <div className="adm-detail-row"><dt>Staff member</dt><dd>{detailTarget.actor.name}</dd></div>
        <div className="adm-detail-row"><dt>Date and time</dt><dd>{formatDateTime(detailTarget.createdAt)}</dd></div>
      </dl>
      <div className="adm-modal-foot"><button type="button" className="button button-primary" onClick={() => setDetailTarget(null)}>Close</button></div>
    </Modal>}
  </div>
}
