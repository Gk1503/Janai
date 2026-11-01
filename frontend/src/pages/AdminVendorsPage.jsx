import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Eye, Pencil, Plus, Search, Warehouse } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal } from '../components/UI'
import VendorFormModal from '../components/VendorFormModal'
import VendorAnalytics from '../components/VendorAnalytics'

const STATUS_FILTERS = ['All', 'Active', 'Inactive']

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

// Pure and exported so search/status filtering can be unit-tested without rendering the page or
// simulating typing (this project's SSR test harness cannot fire input events).
export function filterVendors(vendors, { search = '', status = 'All' } = {}) {
  const query = search.trim().toLowerCase()
  return vendors.filter((vendor) => {
    const matchesSearch = !query
      || vendor.name.toLowerCase().includes(query)
      || (vendor.contactPerson || '').toLowerCase().includes(query)
      || (vendor.phone || '').toLowerCase().includes(query)
    const matchesStatus = status === 'All' || vendor.status === status
    return matchesSearch && matchesStatus
  })
}

export default function AdminVendorsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [formTarget, setFormTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [deactivateError, setDeactivateError] = useState('')
  const [deactivating, setDeactivating] = useState(false)
  // 'list' (the existing vendor table) or 'analytics' (Stage 8) — a view toggle within this same
  // page/route, not a new navigation item or page.
  const [view, setView] = useState('list')

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/vendors')
      setVendors(data.vendors)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = filterVendors(vendors, { search, status })
  const filtersActive = Boolean(search.trim()) || status !== 'All'

  function resetFilters() {
    setSearch('')
    setStatus('All')
  }

  function closeDeactivateDialog() {
    if (deactivating) return
    setDeactivateTarget(null)
    setDeactivateError('')
  }

  async function confirmDeactivate() {
    if (deactivating) return
    setDeactivating(true)
    setDeactivateError('')
    try {
      await api.patch(`/vendors/${deactivateTarget._id}/deactivate`)
      toast('Vendor deactivated.')
      setDeactivateTarget(null)
      await load()
    } catch (requestError) {
      setDeactivateError(getApiError(requestError))
    } finally {
      setDeactivating(false)
    }
  }

  return <div className="adm-vendors-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Vendors</h1><p>Manage the suppliers you purchase products from, independently of any single product.</p></div>
      {view === 'list' && <button type="button" className="button button-primary" onClick={() => setFormTarget({})}><Plus size={15} />Add Vendor</button>}
    </div>

    <div className="adm-toolbar">
      <button type="button" className={`button ${view === 'list' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('list')}>Vendors</button>
      <button type="button" className={`button ${view === 'analytics' ? 'button-primary' : 'button-outline'}`} onClick={() => setView('analytics')}>Analytics</button>
    </div>

    {view === 'list' ? <>
      <section className="adm-panel adm-toolbar-panel">
        <div className="adm-toolbar">
          <label className="shop-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, contact person or phone…" aria-label="Search vendors" /></label>
          <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">{STATUS_FILTERS.map((value) => <option key={value} value={value}>{value === 'All' ? 'All statuses' : value}</option>)}</select></label>
          {filtersActive && <button type="button" className="filter-reset" onClick={resetFilters}>Clear filters</button>}
        </div>
      </section>

      <section className="adm-panel">
        {loading ? <Loader label="Loading vendors" /> : error ? (
          <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
        ) : !vendors.length ? (
          <EmptyState icon={Warehouse} title="No vendors yet" message="Add a vendor to start tracking suppliers independently of any product." />
        ) : !filtered.length ? (
          <EmptyState title="No vendors found" message="Try changing your search or filters." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Vendor</th><th>Contact Person</th><th>Phone</th><th>Email</th><th>Products</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map((vendor) => <tr key={vendor._id}>
                  <td>{vendor.name}</td>
                  <td>{vendor.contactPerson || '—'}</td>
                  <td>{vendor.phone || '—'}</td>
                  <td>{vendor.email || '—'}</td>
                  <td>{vendor.productCount} {vendor.productCount === 1 ? 'Product' : 'Products'}</td>
                  <td><span className={`status-pill${vendor.status === 'Inactive' ? ' is-muted' : ''}`}>{vendor.status}</span></td>
                  <td>{formatDate(vendor.createdAt)}</td>
                  <td>
                    <button type="button" className="table-action is-view" onClick={() => navigate(`/admin/vendors/${vendor._id}`)}><Eye size={14} />View Details</button>
                    <button type="button" className="table-action" onClick={() => setFormTarget(vendor)}><Pencil size={14} />Edit</button>
                    {vendor.status === 'Active' && <button type="button" className="table-action danger" onClick={() => setDeactivateTarget(vendor)}><Ban size={14} />Deactivate</button>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </> : <VendorAnalytics vendors={vendors} />}

    {formTarget && <VendorFormModal vendor={formTarget._id ? formTarget : null} onClose={() => setFormTarget(null)} onSaved={load} />}

    {deactivateTarget && <Modal title="Deactivate Vendor?" onClose={closeDeactivateDialog}>
      <p className="adm-modal-text">Are you sure you want to deactivate “{deactivateTarget.name}”? This keeps every existing product link and procurement history — nothing is deleted, and it can be reversed by editing the vendor again.</p>
      {deactivateError && <div className="form-error">{deactivateError}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={closeDeactivateDialog} disabled={deactivating}>Cancel</button>
        <button type="button" className="button button-danger" onClick={confirmDeactivate} disabled={deactivating}>{deactivating ? 'Deactivating…' : 'Deactivate Vendor'}</button>
      </div>
    </Modal>}
  </div>
}
