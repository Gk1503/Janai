import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Clock, CreditCard, Eye, Mail, MapPin, Phone, ReceiptText, Search, StickyNote, User } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, formatPrice, Loader, Modal, ProductImage } from '../components/UI'

const PAGE_SIZE = 10

// Backend Order.orderStatus values (models/Order.js) with admin-facing labels.
const ORDER_STATUSES = [
  { value: 'placed', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]
const statusLabel = (value) => ORDER_STATUSES.find((item) => item.value === value)?.label || String(value || '').replaceAll('_', ' ')
// The next step in the normal flow: Pending → Confirmed → Preparing → Out for delivery → Delivered.
const NEXT_STEP = {
  placed: { value: 'confirmed', label: 'Confirm' },
  confirmed: { value: 'preparing', label: 'Start preparing' },
  preparing: { value: 'out_for_delivery', label: 'Send out' },
  out_for_delivery: { value: 'delivered', label: 'Mark delivered' },
}
const ACTIVE_STATUSES = ['placed', 'confirmed', 'preparing', 'out_for_delivery']
// Backend BulkOrder.status values (models/BulkOrder.js).
const BULK_STATUSES = ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed']
const PAYMENT_METHODS = { cod: 'Cash on Delivery', online: 'Online payment' }

const ORDER_VIEWS = {
  all: { title: 'All Orders', description: 'Every customer order placed on Janai.', statusFilter: true, columns: ['id', 'customer', 'date', 'items', 'total', 'payment', 'status', 'actions'] },
  pending: { title: 'Pending Orders', description: 'New orders waiting to be confirmed.', statuses: ['placed'], columns: ['id', 'customer', 'date', 'items', 'total', 'payment', 'status', 'actions'] },
  processing: { title: 'Processing', description: 'Confirmed orders that are being prepared.', statuses: ['confirmed', 'preparing'], columns: ['id', 'customer', 'date', 'deliveryDate', 'items', 'total', 'status', 'actions'] },
  'out-for-delivery': { title: 'Out for Delivery', description: 'Orders currently on their way to customers.', statuses: ['out_for_delivery'], columns: ['id', 'customer', 'deliveryDate', 'items', 'total', 'payment', 'status', 'actions'] },
  delivered: { title: 'Delivered', description: 'Completed orders.', statuses: ['delivered'], columns: ['id', 'customer', 'deliveryDate', 'total', 'paymentStatus', 'status', 'actions'] },
  cancelled: { title: 'Cancelled', description: 'Orders that were cancelled.', statuses: ['cancelled'], columns: ['id', 'customer', 'date', 'total', 'cancelInfo', 'status', 'actions'] },
}
const PREORDER_VIEWS = {
  all: { title: 'All Pre Orders', description: 'Every pre-order scheduled by customers.', statusFilter: true, columns: ['id', 'customer', 'products', 'total', 'deliveryDate', 'timeSlot', 'status', 'actions'] },
  scheduled: { title: 'Scheduled', description: 'Active pre-orders with a delivery date from today onwards, soonest first.', upcoming: true, columns: ['id', 'customer', 'products', 'total', 'deliveryDate', 'timeSlot', 'status', 'actions'] },
}
const BULK_VIEWS = {
  all: { title: 'All Bulk Orders', description: 'Every bulk order request received.', statusFilter: true },
  requests: { title: 'Requests', description: 'New requests awaiting a decision (Pending or Reviewing).', statuses: ['Pending', 'Reviewing'] },
}

const ORDER_DATE_FILTERS = [{ value: 'all', label: 'Any order date' }, { value: 'today', label: 'Ordered today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]
const DELIVERY_DATE_FILTERS = [{ value: 'all', label: 'Any delivery date' }, { value: 'today', label: 'Delivery today' }, { value: 'tomorrow', label: 'Delivery tomorrow' }, { value: 'next7', label: 'Next 7 days' }, { value: 'past', label: 'Past deliveries' }]

const shortId = (id) => `#${String(id).slice(-8).toUpperCase()}`
const dayStart = (offset = 0) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + offset); return date }
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const customerName = (order) => (order.user ? `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim() : '') || order.deliveryAddress?.recipient || 'Customer'
const customerPhone = (order) => order.user?.phone || order.deliveryAddress?.phone || '—'
const itemsSubtotal = (order) => (order.items || []).reduce((sum, item) => sum + item.price * item.quantity, 0)

function matchesDate(value, filter) {
  if (filter === 'all') return true
  const time = new Date(value).getTime()
  if (filter === 'today') return time >= dayStart().getTime() && time < dayStart(1).getTime()
  if (filter === 'tomorrow') return time >= dayStart(1).getTime() && time < dayStart(2).getTime()
  if (filter === 'next7') return time >= dayStart().getTime() && time < dayStart(8).getTime()
  if (filter === 'past') return time < dayStart().getTime()
  return time >= dayStart(-(Number(filter) - 1)).getTime()
}

function matchesSearch(fields, query) {
  const needle = query.trim().toLowerCase()
  return !needle || fields.some((field) => String(field || '').toLowerCase().includes(needle))
}

export function OrderStatusBadge({ status }) {
  return <span className={`status-pill status-${String(status).toLowerCase()}`}>{statusLabel(status)}</span>
}

function PaymentStatusBadge({ status }) {
  return <span className={`status-pill status-payment-${status}`}>{status || 'pending'}</span>
}

function Pagination({ page, pages, onChange, label }) {
  if (pages <= 1) return null
  return <nav className="adm-pagination" aria-label={label}>
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    {Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} className={number === page ? 'active' : ''} onClick={() => onChange(number)}>{number}</button>)}
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

// Search box + selects, matching the Products toolbar.
function Toolbar({ searchInput, onSearch, placeholder, children, filtersActive, onReset }) {
  return <section className="adm-panel adm-toolbar-panel">
    <div className="adm-toolbar">
      <label className="shop-search"><Search size={16} /><input type="search" value={searchInput} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>
      {children}
      {filtersActive && <button type="button" className="filter-reset" onClick={onReset}>Clear filters</button>}
    </div>
  </section>
}

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

// One product per line with its quantity, e.g. Tomatoes · 2 kg.
function ProductLines({ lines }) {
  return <span className="adm-product-lines">{lines.map((line, index) => <span key={`${line.name}-${index}`}>{line.name} <small>· {line.quantity} {line.unit}</small></span>)}</span>
}

function OrderCell({ column, order, onView, onAdvance, busyId }) {
  const items = order.items || []
  switch (column) {
    case 'id': return <button type="button" className="adm-link-button" onClick={() => onView(order)}>{shortId(order._id)}</button>
    case 'customer': return <span className="adm-cell-stack"><strong>{customerName(order)}</strong><small>{customerPhone(order)}</small></span>
    case 'date': return formatDate(order.createdAt)
    case 'deliveryDate': return formatDate(order.deliveryDate)
    case 'items': return `${items.length} ${items.length === 1 ? 'item' : 'items'}`
    case 'products': return <ProductLines lines={items} />
    case 'total': return <strong>{formatPrice(order.totalAmount)}</strong>
    case 'payment': return <span className="adm-cell-stack"><span>{PAYMENT_METHODS[order.paymentMethod] || order.paymentMethod}</span><PaymentStatusBadge status={order.paymentStatus} /></span>
    case 'paymentStatus': return <PaymentStatusBadge status={order.paymentStatus} />
    case 'timeSlot': return order.preferredTimeSlot || 'Any time'
    case 'cancelInfo': return <span className="adm-cell-stack"><span>Last updated {formatDateTime(order.updatedAt)}</span><small>{order.orderType === 'preorder' ? 'Pre-order' : 'Order'} · payment {order.paymentStatus || 'pending'}</small></span>
    case 'status': return <OrderStatusBadge status={order.orderStatus} />
    case 'actions': {
      const next = NEXT_STEP[order.orderStatus]
      return <span className="adm-row-actions"><button type="button" className="table-action" onClick={() => onView(order)}><Eye size={14} />View</button>{next && <button type="button" className="table-action is-primary" disabled={busyId === order._id} onClick={() => onAdvance(order, next.value)}>{next.label}</button>}</span>
    }
    default: return null
  }
}

const COLUMN_LABELS = { id: 'Order ID', customer: 'Customer', date: 'Order date', deliveryDate: 'Delivery date', items: 'Items', products: 'Products & quantity', total: 'Total', payment: 'Payment', paymentStatus: 'Payment status', timeSlot: 'Preferred time', cancelInfo: 'Cancellation', status: 'Status', actions: 'Actions' }

// Reusable order table; on phones each row becomes a labelled card (see .adm-responsive-table).
export function OrderTable({ orders, columns, onView, onAdvance, busyId }) {
  return <div className="admin-table-wrap">
    <table className="admin-table adm-responsive-table">
      <thead><tr>{columns.map((column) => <th key={column}>{COLUMN_LABELS[column]}</th>)}</tr></thead>
      <tbody>{orders.map((order) => <tr key={order._id}>{columns.map((column) => <td key={column} data-label={COLUMN_LABELS[column]} className={`adm-col-${column}`}><OrderCell column={column} order={order} onView={onView} onAdvance={onAdvance} busyId={busyId} /></td>)}</tr>)}</tbody>
    </table>
  </div>
}

function DetailRow({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="adm-detail-row"><dt>{label}</dt><dd>{children}</dd></div>
}

export function OrderDetailsModal({ order, onClose, onStatusChange, busy }) {
  const [status, setStatus] = useState(order.orderStatus)
  const [confirmCancel, setConfirmCancel] = useState(false)
  useEffect(() => { setStatus(order.orderStatus) }, [order.orderStatus])
  const address = order.deliveryAddress || {}
  const subtotal = itemsSubtotal(order)
  const deliveryCharge = Math.max(0, Number(order.totalAmount) - subtotal)
  const isPreorder = order.orderType === 'preorder'
  function save() {
    if (status === order.orderStatus) return
    if (status === 'cancelled') { setConfirmCancel(true); return }
    onStatusChange(order, status)
  }

  return <Modal title={`${isPreorder ? 'Pre-order' : 'Order'} ${shortId(order._id)}`} onClose={onClose} wide>
    <section className="adm-detail-section">
      <h3 className="adm-modal-section-title"><ReceiptText size={14} />{isPreorder ? 'Pre-order information' : 'Order information'}</h3>
      <dl className="adm-detail-grid">
        <DetailRow label="Order ID">{String(order._id).toUpperCase()}</DetailRow>
        <DetailRow label="Order date">{formatDateTime(order.createdAt)}</DetailRow>
        <DetailRow label="Status"><OrderStatusBadge status={order.orderStatus} /></DetailRow>
        <DetailRow label="Delivery date">{formatDate(order.deliveryDate)}</DetailRow>
        <DetailRow label="Preferred time">{order.preferredTimeSlot || 'Any time'}</DetailRow>
        <DetailRow label="Last updated">{formatDateTime(order.updatedAt)}</DetailRow>
      </dl>
    </section>

    <div className="adm-detail-columns">
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title"><User size={14} />Customer</h3>
        {order.user ? <dl className="adm-detail-list">
          <DetailRow label="Name">{customerName(order)}</DetailRow>
          <DetailRow label="Phone">{order.user.phone}</DetailRow>
          <DetailRow label="Email">{order.user.email}</DetailRow>
        </dl> : <p className="adm-muted">This customer account no longer exists.</p>}
      </section>
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title"><MapPin size={14} />Delivery address</h3>
        <dl className="adm-detail-list">
          <DetailRow label="Full name">{address.recipient}</DetailRow>
          <DetailRow label="Mobile">{address.phone}</DetailRow>
          <DetailRow label="House / Flat">{address.house}</DetailRow>
          <DetailRow label="Street / Area">{address.street}</DetailRow>
          <DetailRow label="Landmark">{address.landmark}</DetailRow>
          <DetailRow label="City / State">{[address.city, address.state].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Pincode">{address.postalCode}</DetailRow>
        </dl>
      </section>
    </div>

    {order.deliveryInstructions && <p className="adm-note"><StickyNote size={15} /><span><strong>Delivery instructions:</strong> {order.deliveryInstructions}</span></p>}

    <section className="adm-detail-section">
      <h3 className="adm-modal-section-title">Items ({order.items?.length || 0})</h3>
      <ul className="adm-order-items">{(order.items || []).map((item, index) => <li key={`${item.name}-${index}`}>
        <ProductImage product={item} alt={item.name} />
        <span className="adm-cell-stack"><strong>{item.name}</strong><small>{item.quantity} {item.unit} × {formatPrice(item.price)} / {item.unit}</small></span>
        <strong>{formatPrice(item.price * item.quantity)}</strong>
      </li>)}</ul>
    </section>

    <div className="adm-detail-columns">
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title"><CreditCard size={14} />Payment</h3>
        <dl className="adm-detail-list">
          <DetailRow label="Method">{PAYMENT_METHODS[order.paymentMethod] || order.paymentMethod}</DetailRow>
          <DetailRow label="Status"><PaymentStatusBadge status={order.paymentStatus} /></DetailRow>
        </dl>
      </section>
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title">Summary</h3>
        <dl className="adm-detail-list adm-summary-list">
          <DetailRow label="Subtotal">{formatPrice(subtotal)}</DetailRow>
          <DetailRow label="Delivery charge">{deliveryCharge ? formatPrice(deliveryCharge) : 'Free'}</DetailRow>
          <div className="adm-detail-row adm-detail-total"><dt>Final total</dt><dd>{formatPrice(order.totalAmount)}</dd></div>
        </dl>
      </section>
    </div>

    <section className="adm-detail-section adm-status-editor">
      <h3 className="adm-modal-section-title">Update status</h3>
      <div className="adm-status-row">
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Order status">{ORDER_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <button type="button" className="button button-primary" disabled={busy || status === order.orderStatus} onClick={save}>{busy ? 'Saving…' : 'Save status'}</button>
      </div>
      {confirmCancel && <div className="adm-confirm-box" role="alert">
        <p>Cancel order <strong>{shortId(order._id)}</strong>? The customer will see it as cancelled.</p>
        <div className="adm-modal-foot"><button type="button" className="button button-outline" onClick={() => { setConfirmCancel(false); setStatus(order.orderStatus) }}>Keep order</button><button type="button" className="button button-danger" disabled={busy} onClick={() => { setConfirmCancel(false); onStatusChange(order, 'cancelled') }}>Cancel order</button></div>
      </div>}
    </section>
  </Modal>
}

// Shared page for Orders and Pre Orders: both live in the Order collection, separated by orderType.
function OrderListPage({ kind, view }) {
  const toast = useToast()
  const config = (kind === 'preorder' ? PREORDER_VIEWS : ORDER_VIEWS)[view]
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { searchInput, search, onSearch, reset } = useDebouncedSearch()
  const [status, setStatus] = useState('All')
  const [dateFilter, setDateFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = kind === 'preorder' ? await api.get('/admin/preorders') : await api.get('/admin/orders', { params: { type: 'normal' } })
      setOrders(data.orders)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [search, status, dateFilter])

  async function updateStatus(order, orderStatus) {
    setBusyId(order._id)
    try {
      const { data } = await api.patch(`/admin/orders/${order._id}/status`, { orderStatus })
      setOrders((current) => current.map((item) => item._id === order._id ? { ...item, orderStatus: data.order.orderStatus, updatedAt: data.order.updatedAt } : item))
      toast(`${shortId(order._id)} marked as ${statusLabel(orderStatus).toLowerCase()}.`)
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const today = dayStart().getTime()
  const dateField = kind === 'preorder' ? 'deliveryDate' : 'createdAt'
  let rows = orders
    .filter((order) => !config.statuses || config.statuses.includes(order.orderStatus))
    .filter((order) => !config.upcoming || (ACTIVE_STATUSES.includes(order.orderStatus) && new Date(order.deliveryDate).getTime() >= today))
    .filter((order) => status === 'All' || order.orderStatus === status)
    .filter((order) => matchesDate(order[dateField], dateFilter))
    .filter((order) => matchesSearch([order._id, shortId(order._id), customerName(order), customerPhone(order), order.user?.email, order.deliveryAddress?.recipient, ...(order.items || []).map((item) => item.name)], search))
  if (config.upcoming) rows = [...rows].sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtersActive = Boolean(search.trim()) || status !== 'All' || dateFilter !== 'all'
  const selected = orders.find((order) => order._id === selectedId)
  const noun = kind === 'preorder' ? 'pre-orders' : 'orders'

  return <div className="adm-products-page adm-orders-page">
    <div className="adm-page-head">
      <div><h1>{config.title}</h1><p>{config.description}</p></div>
      {!loading && !error && <span className="adm-count-chip"><strong>{rows.length}</strong> {rows.length === 1 ? noun.slice(0, -1) : noun}</span>}
    </div>

    <Toolbar searchInput={searchInput} onSearch={onSearch} placeholder={`Search ${noun} by ID, customer, phone or product…`} filtersActive={filtersActive} onReset={() => { reset(); setStatus('All'); setDateFilter('all') }}>
      {config.statusFilter && <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="All">All statuses</option>{ORDER_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
      <label className="sort-select"><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter by date">{(kind === 'preorder' ? DELIVERY_DATE_FILTERS : ORDER_DATE_FILTERS).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </Toolbar>

    <section className="adm-panel">
      {loading ? <Loader label={`Loading ${noun}`} /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !rows.length ? (
        filtersActive ? <EmptyState title={`No ${noun} found`} message="Try changing your search or filters." /> : <EmptyState icon={kind === 'preorder' ? CalendarDays : Clock} title={`No ${config.title.toLowerCase()} yet`} message={`${kind === 'preorder' ? 'Pre-orders' : 'Orders'} in this list will appear here as customers place them.`} />
      ) : <>
        <OrderTable orders={visible} columns={config.columns} onView={(order) => setSelectedId(order._id)} onAdvance={updateStatus} busyId={busyId} />
        <Pagination page={page} pages={pages} onChange={setPage} label={`${config.title} pages`} />
      </>}
    </section>

    {selected && <OrderDetailsModal order={selected} busy={busyId === selected._id} onClose={() => setSelectedId(null)} onStatusChange={updateStatus} />}
  </div>
}

export function AdminOrdersPage({ view = 'all' }) { return <OrderListPage kind="order" view={view} /> }
export function AdminPreOrdersPage({ view = 'all' }) { return <OrderListPage kind="preorder" view={view} /> }

function BulkRequestModal({ request, onClose, onStatusChange, busy }) {
  const [status, setStatus] = useState(request.status)
  useEffect(() => { setStatus(request.status) }, [request.status])
  return <Modal title={`Bulk request ${shortId(request._id)}`} onClose={onClose} wide>
    <section className="adm-detail-section">
      <h3 className="adm-modal-section-title"><ReceiptText size={14} />Request information</h3>
      <dl className="adm-detail-grid">
        <DetailRow label="Request ID">{String(request._id).toUpperCase()}</DetailRow>
        <DetailRow label="Received">{formatDateTime(request.createdAt)}</DetailRow>
        <DetailRow label="Status"><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status}</span></DetailRow>
        <DetailRow label="Order type">{request.orderType}</DetailRow>
        <DetailRow label="Required date">{formatDate(request.requiredDate)}</DetailRow>
        <DetailRow label="Account">{request.user ? 'Signed-in customer' : 'Guest request'}</DetailRow>
      </dl>
    </section>
    <div className="adm-detail-columns">
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title"><User size={14} />Contact</h3>
        <dl className="adm-detail-list">
          <DetailRow label="Name">{request.name}</DetailRow>
          <DetailRow label="Business">{request.organization}</DetailRow>
          <DetailRow label="Phone"><a href={`tel:${request.phone}`} className="adm-inline-link"><Phone size={13} />{request.phone}</a></DetailRow>
          <DetailRow label="Email"><a href={`mailto:${request.email}`} className="adm-inline-link"><Mail size={13} />{request.email}</a></DetailRow>
        </dl>
      </section>
      <section className="adm-detail-section">
        <h3 className="adm-modal-section-title"><MapPin size={14} />Delivery address</h3>
        <p className="adm-detail-text">{request.deliveryAddress}</p>
      </section>
    </div>
    <section className="adm-detail-section">
      <h3 className="adm-modal-section-title">Requested products ({request.products.length})</h3>
      <ul className="adm-order-items adm-bulk-items">{request.products.map((item, index) => <li key={`${item.name}-${index}`}><span className="adm-cell-stack"><strong>{item.name}</strong></span><strong>{item.quantity} {item.unit}</strong></li>)}</ul>
      <p className="adm-muted">Pricing is agreed with the customer during review; the request does not store an amount.</p>
    </section>
    {request.additionalRequirements && <p className="adm-note"><StickyNote size={15} /><span><strong>Additional requirements:</strong> {request.additionalRequirements}</span></p>}
    <section className="adm-detail-section adm-status-editor">
      <h3 className="adm-modal-section-title">Update status</h3>
      <div className="adm-status-row">
        <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Request status">{BULK_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <button type="button" className="button button-primary" disabled={busy || status === request.status} onClick={() => onStatusChange(request, status)}>{busy ? 'Saving…' : 'Save status'}</button>
      </div>
    </section>
  </Modal>
}

export function AdminBulkOrdersPage({ view = 'all' }) {
  const toast = useToast()
  const config = BULK_VIEWS[view]
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { searchInput, search, onSearch, reset } = useDebouncedSearch()
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/bulk-orders')
      setRequests(data.requests)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [search, status])

  async function updateStatus(request, value) {
    setBusyId(request._id)
    try {
      const { data } = await api.patch(`/admin/bulk-orders/${request._id}/status`, { status: value })
      setRequests((current) => current.map((item) => item._id === request._id ? { ...item, ...data.request } : item))
      toast(`Bulk request ${shortId(request._id)} marked as ${value.toLowerCase()}.`)
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const rows = requests
    .filter((request) => !config.statuses || config.statuses.includes(request.status))
    .filter((request) => status === 'All' || request.status === status)
    .filter((request) => matchesSearch([request._id, shortId(request._id), request.name, request.organization, request.phone, request.email, ...request.products.map((item) => item.name)], search))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtersActive = Boolean(search.trim()) || status !== 'All'
  const selected = requests.find((request) => request._id === selectedId)
  const statusOptions = config.statuses || BULK_STATUSES

  return <div className="adm-products-page adm-orders-page">
    <div className="adm-page-head">
      <div><h1>{config.title}</h1><p>{config.description}</p></div>
      {!loading && !error && <span className="adm-count-chip"><strong>{rows.length}</strong> {rows.length === 1 ? 'request' : 'requests'}</span>}
    </div>

    <Toolbar searchInput={searchInput} onSearch={onSearch} placeholder="Search by ID, name, business, phone or product…" filtersActive={filtersActive} onReset={() => { reset(); setStatus('All') }}>
      <label className="sort-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="All">All statuses</option>{statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    </Toolbar>

    <section className="adm-panel">
      {loading ? <Loader label="Loading bulk orders" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !rows.length ? (
        filtersActive ? <EmptyState title="No bulk orders found" message="Try changing your search or filters." /> : <EmptyState title={view === 'requests' ? 'No open requests' : 'No bulk orders yet'} message="Bulk order requests from customers will appear here." />
      ) : <>
        <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Request ID</th><th>Customer / Business</th><th>Contact</th><th>Requested products</th><th>Required date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{visible.map((request) => <tr key={request._id}>
              <td data-label="Request ID" className="adm-col-id"><button type="button" className="adm-link-button" onClick={() => setSelectedId(request._id)}>{shortId(request._id)}</button></td>
              <td data-label="Customer"><span className="adm-cell-stack"><strong>{request.name}</strong><small>{request.organization || request.orderType}</small></span></td>
              <td data-label="Contact"><span className="adm-cell-stack"><span>{request.phone}</span><small>{request.email}</small></span></td>
              <td data-label="Products"><ProductLines lines={request.products} /></td>
              <td data-label="Required date">{formatDate(request.requiredDate)}</td>
              <td data-label="Status"><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status}</span></td>
              <td data-label="Actions" className="adm-col-actions"><span className="adm-row-actions"><button type="button" className="table-action" onClick={() => setSelectedId(request._id)}><Eye size={14} />View</button>{request.status === 'Pending' && <button type="button" className="table-action is-primary" disabled={busyId === request._id} onClick={() => updateStatus(request, 'Reviewing')}>Start review</button>}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} onChange={setPage} label={`${config.title} pages`} />
      </>}
    </section>

    {selected && <BulkRequestModal request={selected} busy={busyId === selected._id} onClose={() => setSelectedId(null)} onStatusChange={updateStatus} />}
  </div>
}
