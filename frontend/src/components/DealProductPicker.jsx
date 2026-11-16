import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, formatPrice, Loader, Modal, ProductImage } from './UI'

const SCOPES = [
  ['marked', (name) => `Marked for ${name}`],
  ['included', () => 'In this promotion'],
  ['all', () => 'All products'],
]

const stockLabel = (stock) => (stock <= 0 ? 'Out of stock' : stock <= 5 ? `Low stock (${stock})` : 'In stock')

// "Add Products" for one section of Deals Management. The server decides what is selectable (a product must be
// marked for the section in Product Edit, or already be in the promotion) and does every write; nothing here
// creates a product or a promotion.
export default function DealProductPicker({ section, name, promotions, initialPromotionId, onClose, onChanged }) {
  const toast = useToast()
  const [promotionId, setPromotionId] = useState(initialPromotionId || promotions[0]?._id || '')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [scope, setScope] = useState('marked')
  const [categories, setCategories] = useState([])
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.get('/categories').then(({ data }) => setCategories(data.categories.map((entry) => entry.name))).catch(() => {}) }, [])

  const fetchPage = useCallback(async (target, append) => {
    setLoading(true)
    try {
      const params = { section, scope: scope === 'included' && !promotionId ? 'marked' : scope, page: target }
      if (promotionId) params.promotionId = promotionId
      if (query.trim()) params.q = query.trim()
      if (category !== 'All') params.category = category
      const { data } = await api.get('/admin/deals/products', { params })
      setRows((current) => (append ? [...current, ...data.products] : data.products))
      setPage(target)
      setHasMore(data.hasMore)
      setError('')
    } catch (requestError) { setError(getApiError(requestError)) } finally { setLoading(false) }
  }, [section, promotionId, query, category, scope])

  useEffect(() => {
    const timer = window.setTimeout(() => { setSelected(new Set()); fetchPage(1, false) }, query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [fetchPage, query])

  // A product can be ticked when it is eligible (marked for this section) or already in the promotion (to remove it).
  const selectable = useMemo(() => rows.filter((row) => row.marked || row.included), [rows])
  const picked = rows.filter((row) => selected.has(row._id))
  const toAdd = picked.filter((row) => !row.included)
  const toRemove = picked.filter((row) => row.included)
  const allVisible = selectable.length > 0 && selectable.every((row) => selected.has(row._id))

  const toggle = (id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelected(allVisible ? new Set() : new Set(selectable.map((row) => row._id)))

  async function apply(body, message) {
    if (!promotionId) return
    setBusy(true)
    try {
      await api.post(`/admin/deals/${promotionId}/products`, body)
      toast(message)
      setSelected(new Set())
      onChanged()
      await fetchPage(1, false)
    } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy(false) }
  }

  const target = promotions.find((promotion) => promotion._id === promotionId)
  return <Modal title={`Add products to ${name}`} onClose={onClose} wide>
    <div className="deal-picker-modal">
      {!promotions.length ? <EmptyState title={`No ${name} promotion yet`} message="Create a promotion first, then come back to choose its products. Nothing is created automatically." action="" /> : <>
        <label className="field"><span>Promotion</span><select value={promotionId} onChange={(event) => setPromotionId(event.target.value)} aria-label="Promotion">{promotions.map((promotion) => <option key={promotion._id} value={promotion._id}>{promotion.title || `Untitled promotion`}{promotion.isActive ? '' : ' (inactive)'}</option>)}</select></label>
        <div className="adm-toolbar deal-toolbar">
          <label className="shop-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by product name…" aria-label="Search products" /></label>
          <label className="sort-select"><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
          <label className="sort-select"><select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Show">{SCOPES.map(([value, label]) => <option key={value} value={value}>{label(name)}</option>)}</select></label>
        </div>
        {scope === 'all' && <small className="adm-muted">Products that are not marked for {name} cannot be selected. Mark them under Promotional Placement when editing the product.</small>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="deal-picker-list" aria-busy={loading}>
          {loading && !rows.length ? <Loader label="Loading products" /> : !rows.length ? <EmptyState title={scope === 'marked' ? `No products are marked for ${name}` : 'No products found'} message={scope === 'marked' ? `Open a product, choose ${name} under Promotional Placement and save. It will then appear here.` : 'Try a different search or filter.'} action="" /> : <>
            <label className="deal-pick-row is-head"><input type="checkbox" checked={allVisible} disabled={!selectable.length} onChange={toggleAll} aria-label="Select all visible products" /><span>Select all visible ({selectable.length})</span></label>
            {rows.map((row) => {
              const usable = row.marked || row.included
              return <label key={row._id} className={`deal-pick-row${selected.has(row._id) ? ' selected' : ''}${usable ? '' : ' is-disabled'}`}>
                <input type="checkbox" checked={selected.has(row._id)} disabled={!usable} onChange={() => toggle(row._id)} aria-label={`Select ${row.name}`} />
                <ProductImage product={{ ...row, images: row.image ? [row.image] : [] }} className="deal-pick-thumb" />
                <span className="deal-pick-info"><strong>{row.name}</strong><small>{row.category} · {formatPrice(row.price)} / {row.unit}</small></span>
                <span className="deal-pick-tags">
                  <span className={`stock-tag${row.stock <= 0 ? ' is-out' : ''}`}>{stockLabel(row.stock)}</span>
                  {row.included && <span className="deal-type-pill is-discount">In {target?.title || 'promotion'}</span>}
                  {row.marked ? <span className="deal-type-pill">Marked: {name}</span> : !row.included && <span className="deal-type-pill is-muted">Not marked</span>}
                </span>
              </label>
            })}
            {hasMore && <button type="button" className="button button-outline" disabled={loading} onClick={() => fetchPage(page + 1, true)}>{loading ? 'Loading…' : 'Load more'}</button>}
          </>}
        </div>
        <div className="adm-modal-actions">
          <button type="button" className="button button-outline" onClick={onClose}>Close</button>
          <button type="button" className="button button-outline" disabled={busy || !toRemove.length} onClick={() => apply({ remove: toRemove.map((row) => row._id) }, `Removed ${toRemove.length} from ${target?.title || 'the promotion'}.`)}>Remove selected ({toRemove.length})</button>
          <button type="button" className="button button-primary" disabled={busy || !toAdd.length} onClick={() => apply({ add: toAdd.map((row) => row._id) }, `Added ${toAdd.length} to ${target?.title || 'the promotion'}.`)}>Add selected ({toAdd.length})</button>
        </div>
      </>}
    </div>
  </Modal>
}
