import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Hash, Mail, MapPin, Phone, ShoppingBag, Wallet } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader, formatPrice } from '../components/UI'
import { OrderDetailsModal, OrderTable } from './AdminOrderPages'

const PAGE_SIZE = 10
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const initials = (customer) => `${customer.firstName?.[0] || ''}${customer.lastName?.[0] || ''}`.toUpperCase() || '—'

function DetailRow({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="adm-detail-row"><dt>{label}</dt><dd>{children}</dd></div>
}

function ProfileItem({ icon: Icon, label, children, title }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="adm-profile-item">
    <span className="adm-profile-icon"><Icon size={16} /></span>
    <div className="adm-profile-item-body"><small>{label}</small><strong title={title}>{children}</strong></div>
  </div>
}

function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null
  return <nav className="adm-pagination" aria-label="Order pages">
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => onChange(number)}>{number}</button>)}
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

export default function AdminCustomerDetailPage() {
  const { id } = useParams()
  const [customer, setCustomer] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/admin/customers/${id}`)
      setCustomer(data.customer)
      setOrders(data.orders)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const pages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE))
  const visible = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selected = orders.find((order) => order._id === selectedId)

  return <div className="adm-products-page adm-customers-page">
    <Link to="/admin/customers" className="adm-back-link"><ArrowLeft size={15} />Back to Customers</Link>

    {loading ? <section className="adm-panel"><Loader label="Loading customer" /></section> : error ? (
      <section className="adm-panel"><div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div></section>
    ) : !customer ? (
      <section className="adm-panel"><EmptyState title="Customer not found" message="This customer may no longer exist." /></section>
    ) : <>
      <div className="adm-page-head">
        <div className="adm-product-cell"><span className="adm-avatar">{initials(customer)}</span><div><h1>{`${customer.firstName} ${customer.lastName}`.trim() || 'Customer'}</h1><p>Customer since {formatDate(customer.createdAt)}</p></div></div>
      </div>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Customer profile</h2>
        <div className="adm-profile-grid">
          <ProfileItem icon={Mail} label="Email"><a href={`mailto:${customer.email}`} className="adm-inline-link">{customer.email}</a></ProfileItem>
          <ProfileItem icon={Phone} label="Phone"><a href={`tel:${customer.phone}`} className="adm-inline-link">{customer.phone || '—'}</a></ProfileItem>
          <ProfileItem icon={Hash} label="Customer ID" title={customer._id}>{customer._id}</ProfileItem>
          <ProfileItem icon={CalendarDays} label="Registered on">{formatDate(customer.createdAt)}</ProfileItem>
        </div>
      </section>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title"><MapPin size={14} />Saved Addresses{customer.addresses?.length > 0 && <span className="adm-count-chip"><strong>{customer.addresses.length}</strong></span>}</h2>
        {!customer.addresses?.length ? <p className="adm-muted">No saved addresses for this customer.</p> : <div className="adm-address-grid">
          {customer.addresses.map((address) => <article className="adm-address-card" key={address._id}>
            <div className="adm-address-card-head">
              <span className="adm-address-label"><MapPin size={13} />{address.label || 'Address'}</span>
              {address.isDefault && <span className="status-pill">Default</span>}
            </div>
            <dl className="adm-detail-list">
              <DetailRow label="Recipient">{address.recipient}</DetailRow>
              <DetailRow label="Phone">{address.phone}</DetailRow>
              <DetailRow label="House / Flat">{address.house}</DetailRow>
              <DetailRow label="Street / Area">{address.street}</DetailRow>
              <DetailRow label="Landmark">{address.landmark}</DetailRow>
              <DetailRow label="City / State">{[address.city, address.state].filter(Boolean).join(', ')}</DetailRow>
              <DetailRow label="Pincode">{address.postalCode}</DetailRow>
            </dl>
          </article>)}
        </div>}
      </section>

      <section className="adm-metric-grid cols-2">
        <article className="adm-metric-card"><span className="adm-metric-icon"><ShoppingBag size={18} /></span><small>Total Orders</small><strong>{customer.totalOrders}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><Wallet size={18} /></span><small>Total Spent</small><strong>{formatPrice(customer.totalSpent)}</strong></article>
      </section>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Order History{orders.length > 0 && <span className="adm-count-chip"><strong>{orders.length}</strong> {orders.length === 1 ? 'order' : 'orders'}</span>}</h2>
        {!orders.length ? <EmptyState icon={ShoppingBag} title="No orders yet" message="This customer has not placed any orders." /> : <>
          <OrderTable orders={visible} columns={['id', 'date', 'items', 'total', 'paymentMethod', 'paymentStatus', 'status', 'actions']} onView={(order) => setSelectedId(order._id)} />
          <Pagination page={page} pages={pages} onChange={setPage} />
        </>}
      </section>
    </>}

    {selected && <OrderDetailsModal order={selected} onClose={() => setSelectedId(null)} readOnly />}
  </div>
}
