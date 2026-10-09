import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, productImage } from '../components/UI'
import ProductFormModal from '../components/ProductFormModal'

const PAGE_SIZE = 10
const STATUS_FILTERS = [
  { value: 'All', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'preorder', label: 'Pre-order available' },
  { value: 'out_of_stock', label: 'Out of stock' },
]

function productStatus(product) {
  if (Number(product.stock) <= 0) return { key: 'out_of_stock', label: 'Out of stock' }
  if (product.preOrderAvailable) return { key: 'preorder', label: 'Pre-order available' }
  return { key: 'active', label: 'Active' }
}

export default function AdminProductsPage() {
  const toast = useToast()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)
  const [formTarget, setFormTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const searchTimer = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const params = { limit: 100, sort: 'newest' }
      if (category !== 'All') params.category = category
      if (search.trim()) params.q = search.trim()
      const { data } = await api.get('/products', { params })
      setProducts(data.products)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [category, search])
  useEffect(() => { setPage(1) }, [category, search, status])
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  useEffect(() => { api.get('/categories').then(({ data }) => setCategories(data.categories)).catch(() => {}) }, [])

  function onSearchInput(value) {
    setSearchInput(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => setSearch(value), 350)
  }

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setCategory('All')
    setStatus('All')
  }

  const filtered = status === 'All' ? products : products.filter((product) => productStatus(product).key === status)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtersActive = Boolean(search.trim()) || category !== 'All' || status !== 'All'

  async function confirmDelete() {
    setDeleting(true)
    try {
      await api.delete(`/products/${deleteTarget._id}`)
      toast('Product deleted.')
      setDeleteTarget(null)
      await load()
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return <div className="adm-products-page">
    <div className="adm-page-head">
      <div><h1>Products</h1><p>Manage your grocery products</p></div>
      <button type="button" className="button button-primary" onClick={() => setFormTarget({})}><Plus size={15} />Add Product</button>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input value={searchInput} onChange={(event) => onSearchInput(event.target.value)} placeholder="Search products…" aria-label="Search products" /></label>
        <label className="sort-select"><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{categories.map((item) => <option key={item._id} value={item.name}>{item.name}</option>)}</select></label>
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">{STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading products" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !products.length ? (
        <>
          <EmptyState title="No products have been added yet" message="Add your first product to start selling on Janai." />
          <div className="adm-empty-action"><button type="button" className="button button-primary" onClick={() => setFormTarget({})}><Plus size={15} />Add Product</button></div>
        </>
      ) : !filtered.length ? (
        <EmptyState title="No products found" message="Try changing your search or filters." />
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {visible.map((product) => {
                  const statusInfo = productStatus(product)
                  return <tr key={product._id}>
                    <td><div className="adm-product-cell"><img className="adm-product-thumb" src={productImage(product)} alt={product.name} /><span>{product.name}</span></div></td>
                    <td>{product.category}</td>
                    <td>₹{Number(product.price).toLocaleString('en-IN')} / {product.unit}</td>
                    <td>{product.stock} {product.unit}</td>
                    <td><span className={`status-pill${statusInfo.key === 'out_of_stock' ? ' is-muted' : ''}`}>{statusInfo.label}</span></td>
                    <td>
                      <button type="button" className="table-action" onClick={() => setFormTarget(product)}><Pencil size={14} />Edit</button>
                      <button type="button" className="table-action danger" onClick={() => setDeleteTarget(product)}><Trash2 size={14} />Delete</button>
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && <nav className="adm-pagination" aria-label="Product pages">
            <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
            {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
            <button type="button" disabled={page === pages} onClick={() => setPage((current) => current + 1)}>Next</button>
          </nav>}
        </>
      )}
    </section>

    {formTarget && <ProductFormModal product={formTarget._id ? formTarget : null} onClose={() => setFormTarget(null)} onSaved={load} />}

    {deleteTarget && <Modal title="Delete Product?" onClose={() => setDeleteTarget(null)}>
      <p className="adm-modal-text">Are you sure you want to delete <strong>“{deleteTarget.name}”</strong>? This cannot be undone.</p>
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
        <button type="button" className="button button-danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>}
  </div>
}
