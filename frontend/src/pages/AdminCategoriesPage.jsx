import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, categoryImages } from '../components/UI'
import CategoryFormModal from '../components/CategoryFormModal'

const STATUS_FILTERS = ['All', 'Active', 'Inactive']

export default function AdminCategoriesPage() {
  const toast = useToast()
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [formTarget, setFormTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBlocked, setDeleteBlocked] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [categoriesRes, productsRes] = await Promise.all([
        api.get('/categories'),
        api.get('/products', { params: { limit: 100 } }),
      ])
      setCategories(categoriesRes.data.categories)
      setProducts(productsRes.data.products)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const counts = useMemo(() => products.reduce((acc, product) => {
    acc[product.category] = (acc[product.category] || 0) + 1
    return acc
  }, {}), [products])

  const rows = categories.map((category) => ({
    ...category,
    image: category.image || categoryImages[category.name] || '/fruit.jpg',
    count: counts[category.name] || 0,
  }))

  const query = search.trim().toLowerCase()
  const filtered = rows.filter((category) => {
    const matchesSearch = !query || category.name.toLowerCase().includes(query) || category.description.toLowerCase().includes(query)
    const matchesStatus = status === 'All' || category.status === status
    return matchesSearch && matchesStatus
  })
  const filtersActive = Boolean(search.trim()) || status !== 'All'

  function resetFilters() {
    setSearch('')
    setStatus('All')
  }

  function closeDeleteDialog() {
    setDeleteTarget(null)
    setDeleteBlocked(null)
    setDeleteError('')
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await api.delete(`/categories/${deleteTarget._id}`)
      toast('Category deleted successfully.')
      closeDeleteDialog()
      await load()
    } catch (requestError) {
      const status = requestError.response?.status
      if (status === 409) {
        setDeleteBlocked({ count: requestError.response?.data?.productCount ?? 0 })
      } else if (status === 404) {
        toast('Category no longer exists.', 'error')
        closeDeleteDialog()
        await load()
      } else {
        setDeleteError(getApiError(requestError))
      }
    } finally {
      setDeleting(false)
    }
  }

  return <div className="adm-categories-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Categories</h1><p>Organize and manage your grocery product categories.</p></div>
      <button type="button" className="button button-primary" onClick={() => setFormTarget({})}><Plus size={15} />Add Category</button>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories…" aria-label="Search categories" /></label>
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">{STATUS_FILTERS.map((value) => <option key={value} value={value}>{value === 'All' ? 'All statuses' : value}</option>)}</select></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading categories" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !filtered.length ? (
        <EmptyState title="No categories found" message="Try changing your search or filters." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Category</th><th>Description</th><th>Products</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((category) => <tr key={category._id}>
                <td><div className="adm-product-cell"><img className="adm-product-thumb" src={category.image} alt={category.name} /><span>{category.name}</span></div></td>
                <td>{category.description}</td>
                <td>{category.count} {category.count === 1 ? 'Product' : 'Products'}</td>
                <td><span className={`status-pill${category.status === 'Inactive' ? ' is-muted' : ''}`}>{category.status}</span></td>
                <td>
                  <button type="button" className="table-action" onClick={() => setFormTarget(category)}><Pencil size={14} />Edit</button>
                  <button type="button" className="table-action danger" onClick={() => setDeleteTarget(category)}><Trash2 size={14} />Delete</button>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {formTarget && <CategoryFormModal category={formTarget._id ? formTarget : null} onClose={() => setFormTarget(null)} onSaved={load} />}

    {deleteTarget && <Modal title={deleteBlocked ? 'Cannot Delete Category' : 'Delete Category?'} onClose={closeDeleteDialog}>
      {deleteBlocked ? (
        <>
          <p className="adm-modal-text">This category contains {deleteBlocked.count} {deleteBlocked.count === 1 ? 'product' : 'products'}. Please move or reassign these products to another category before deleting this category.</p>
          <div className="adm-modal-foot">
            <button type="button" className="button button-outline" onClick={closeDeleteDialog}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="adm-modal-text">Are you sure you want to delete “{deleteTarget.name}”? This action cannot be undone.</p>
          {deleteError && <div className="form-error">{deleteError}</div>}
          <div className="adm-modal-foot">
            <button type="button" className="button button-outline" onClick={closeDeleteDialog} disabled={deleting}>Cancel</button>
            <button type="button" className="button button-danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Category'}</button>
          </div>
        </>
      )}
    </Modal>}
  </div>
}
