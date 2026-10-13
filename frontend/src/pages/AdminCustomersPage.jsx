import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Search, ShoppingBag, UserCheck, UserPlus, Users } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader, formatPrice } from '../components/UI'

const PAGE_SIZE = 10
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const initials = (customer) => `${customer.firstName?.[0] || ''}${customer.lastName?.[0] || ''}`.toUpperCase() || '—'

function useDebouncedSearch() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  function onSearch(value) {
    setSearchInput(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSearch(value), 250)
  }
  function reset() { window.clearTimeout(timer.current); setSearchInput(''); setSearch('') }
  return { searchInput, search, onSearch, reset }
}

function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null
  return <nav className="adm-pagination" aria-label="Customer pages">
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => onChange(number)}>{number}</button>)}
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

const METRICS = [
  { key: 'totalCustomers', label: 'Total Customers', icon: Users },
  { key: 'newCustomers', label: 'New Customers', icon: UserPlus },
  { key: 'customersWithOrders', label: 'Customers with Orders', icon: ShoppingBag },
  { key: 'activeCustomers', label: 'Active Customers', icon: UserCheck },
]

export default function AdminCustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { searchInput, search, onSearch, reset } = useDebouncedSearch()
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params = { role: 'customer', limit: PAGE_SIZE, page }
      if (search.trim()) params.q = search.trim()
      const { data } = await api.get('/admin/users', { params })
      setCustomers(data.users)
      setTotal(data.total)
      setPages(data.pages)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    try {
      const { data } = await api.get('/admin/customers/stats')
      setStats(data)
      setStatsError('')
    } catch (requestError) {
      setStatsError(getApiError(requestError))
    }
  }

  useEffect(() => { load() }, [page, search])
  useEffect(() => { setPage(1) }, [search])
  useEffect(() => { loadStats() }, [])

  const filtersActive = Boolean(search.trim())

  return <div className="adm-products-page adm-customers-page">
    <div className="adm-page-head">
      <div><h1>Customers</h1><p>Manage your registered customers and their activity.</p></div>
    </div>

    <section className="adm-metric-grid">
      {METRICS.map(({ key, label, icon: Icon }) => <article className="adm-metric-card" key={key}>
        <span className="adm-metric-icon"><Icon size={18} /></span>
        <small>{label}</small>
        <strong>{stats ? stats[key] : statsError ? '—' : '…'}</strong>
      </article>)}
    </section>
    {statsError && <div className="inline-error">{statsError}<button className="text-link" onClick={loadStats}>Retry</button></div>}

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input type="search" value={searchInput} onChange={(event) => onSearch(event.target.value)} placeholder="Search by name, email or phone…" aria-label="Search customers" /></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={reset}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading customers" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !customers.length ? (
        filtersActive ? <EmptyState title="No customers found" message="Try a different search." /> : <EmptyState icon={Users} title="No customers yet" message="Registered customers will appear here." />
      ) : <>
        <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Customer</th><th>Contact</th><th>Total Orders</th><th>Total Spent</th><th>Joined On</th><th>Actions</th></tr></thead>
            <tbody>
              {customers.map((customer) => <tr key={customer._id}>
                <td data-label="Customer"><div className="adm-product-cell"><span className="adm-avatar">{initials(customer)}</span><span>{`${customer.firstName} ${customer.lastName}`.trim() || '—'}</span></div></td>
                <td data-label="Contact"><span className="adm-cell-stack"><span>{customer.phone || '—'}</span><small>{customer.email || '—'}</small></span></td>
                <td data-label="Total Orders">{customer.totalOrders}</td>
                <td data-label="Total Spent"><strong>{formatPrice(customer.totalSpent)}</strong></td>
                <td data-label="Joined On">{formatDate(customer.createdAt)}</td>
                <td data-label="Actions" className="adm-col-actions"><span className="adm-row-actions"><button type="button" className="table-action is-view" onClick={() => navigate(`/admin/customers/${customer._id}`)}><Eye size={14} />View Details</button></span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} onChange={setPage} />
        <p className="adm-muted">{total} {total === 1 ? 'customer' : 'customers'} total.</p>
      </>}
    </section>
  </div>
}
