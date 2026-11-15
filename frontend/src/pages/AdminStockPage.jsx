import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Check, Pencil, Search, X } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { EmptyState, Loader, productImage } from '../components/UI'
import StockAdjustmentModal from '../components/StockAdjustmentModal'
import StockMovementHistory from '../components/StockMovementHistory'

const STATUS_FILTERS = [
  { value: 'All', label: 'All statuses' },
  { value: 'outOfStock', label: 'Out of Stock' },
  { value: 'lowStock', label: 'Low Stock' },
  { value: 'unconfigured', label: 'Threshold Not Set' },
  { value: 'healthy', label: 'Healthy' },
]
const STATUS_LABEL = { outOfStock: 'Out of Stock', lowStock: 'Low Stock', unconfigured: 'Threshold Not Set', healthy: 'Healthy' }
const PAGE_SIZE = 20

// Pure and exported so it can be unit-tested without rendering the page. Mirrors the backend's own
// classifyVariationStock ordering (utils/productVariations.js) purely for the status-pill CSS modifier
// — the actual classification always comes from the API response, never recomputed here.
export function statusPillClass(status) {
  if (status === 'healthy') return 'status-pill'
  if (status === 'unconfigured') return 'status-pill is-neutral'
  return 'status-pill is-muted'
}

export default function AdminStockPage() {
  const toast = useToast()
  const { can } = useAuth()
  const canEditThreshold = can('products:manage')
  const canAdjustStock = can('products:manage') || can('inventory:update')
  // 'current' (the existing per-variation table) or 'history' (Stock Movement History, Phase 4) — a
  // view toggle within this same page, matching the exact pattern already used for Vendor Analytics on
  // AdminVendorsPage: no new route, no new sidebar item, each view owns its own independent state.
  const [view, setView] = useState('current')
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('All')
  const [editing, setEditing] = useState(null) // `${productId}:${variationId}` of the row being edited
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const searchTimer = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const params = { page, limit: PAGE_SIZE }
      if (search.trim()) params.search = search.trim()
      if (category !== 'All') params.category = category
      if (status !== 'All') params.status = status
      const { data } = await api.get('/stock', { params })
      setRows(data.rows)
      setTotal(data.total)
      setPages(data.pages)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [page, search, category, status])
  useEffect(() => { setPage(1) }, [search, category, status])
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  useEffect(() => { api.get('/categories').then(({ data }) => setCategories(data.categories)).catch(() => {}) }, [])

  function onSearchInput(value) {
    setSearchInput(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => setSearch(value), 350)
  }

  function resetFilters() {
    setSearchInput(''); setSearch(''); setCategory('All'); setStatus('All')
  }
  const filtersActive = Boolean(search.trim()) || category !== 'All' || status !== 'All'

  function startEdit(row) {
    setEditing(`${row.productId}:${row.variationId}`)
    setEditValue(String(row.minStockThreshold ?? 0))
    setEditError('')
  }
  function cancelEdit() {
    if (saving) return
    setEditing(null)
    setEditError('')
  }
  async function saveEdit(row) {
    const value = Number(editValue)
    if (editValue.trim() === '' || !Number.isFinite(value) || value < 0) { setEditError('Enter 0 or more.'); return }
    setSaving(true)
    setEditError('')
    try {
      await api.patch(`/stock/${row.productId}/variations/${row.variationId}/threshold`, { minStockThreshold: value })
      toast('Minimum stock threshold updated.')
      setEditing(null)
      await load()
    } catch (requestError) {
      setEditError(getApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  return <div className="adm-stock-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Stock Management</h1><p>Every product and variation, with its current stock, unit and minimum threshold.</p></div>
    </div>

    <div className="adm-toolbar">
      <button type="button" className={`button ${view === 'current' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('current')}>Current Stock</button>
      <button type="button" className={`button ${view === 'history' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('history')}>Movement History</button>
    </div>

    {view === 'history' ? <StockMovementHistory /> : <>
    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input value={searchInput} onChange={(event) => onSearchInput(event.target.value)} placeholder="Search by product or category…" aria-label="Search stock" /></label>
        <label className="sort-select"><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{categories.map((item) => <option key={item._id} value={item.name}>{item.name}</option>)}</select></label>
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by stock status">{STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading stock" /> : error ? (
        <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
      ) : !rows.length ? (
        <EmptyState title={filtersActive ? 'No stock rows match' : 'No products yet'} message={filtersActive ? 'Try a different search, category or status.' : 'Products will appear here once they are added.'} />
      ) : <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Category</th><th>Variation</th><th>Stock</th><th>Minimum Threshold</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const key = `${row.productId}:${row.variationId}`
                const isEditing = editing === key
                return <tr key={key}>
                  <td><div className="adm-product-cell"><img className="adm-product-thumb" src={productImage({ images: [row.productImage], category: row.category })} alt={row.productName} /><span>{row.productName}</span></div></td>
                  <td>{row.category}</td>
                  <td>{row.variationLabel}</td>
                  <td>{row.stock} {row.unit}</td>
                  <td>
                    {isEditing ? (
                      <div className="adm-stock-threshold-edit">
                        <input type="number" min="0" step="any" value={editValue} onChange={(event) => setEditValue(event.target.value)} autoFocus disabled={saving} />
                        <button type="button" className="icon-button" aria-label="Save threshold" disabled={saving} onClick={() => saveEdit(row)}><Check size={15} /></button>
                        <button type="button" className="icon-button" aria-label="Cancel" disabled={saving} onClick={cancelEdit}><X size={15} /></button>
                        {editError && <div className="form-error">{editError}</div>}
                      </div>
                    ) : (
                      <span>
                        {row.minStockThreshold > 0 ? `${row.minStockThreshold} ${row.unit}` : '—'}
                        {canEditThreshold && <button type="button" className="icon-button" aria-label={`Edit threshold for ${row.productName}`} onClick={() => startEdit(row)}><Pencil size={13} /></button>}
                      </span>
                    )}
                  </td>
                  <td><span className={statusPillClass(row.status)}>{STATUS_LABEL[row.status]}</span></td>
                  <td>
                    <Link className="text-link" to="/admin/products">View</Link>
                    {canAdjustStock && <button type="button" className="table-action" onClick={() => setAdjustTarget(row)}><Boxes size={14} />Adjust Stock</button>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && <nav className="adm-pagination" aria-label="Stock pages">
          <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={page === pages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </nav>}
        <p className="adm-muted">{total} row{total === 1 ? '' : 's'} total — one row per variation; a product with no real variations shows its single Default row.</p>
      </>}
    </section>

    {adjustTarget && <StockAdjustmentModal row={adjustTarget} onClose={() => setAdjustTarget(null)} onSaved={load} />}
    </>}
  </div>
}
