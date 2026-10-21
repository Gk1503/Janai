import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock, MapPin, Navigation, Phone, ShieldCheck, Truck, Wallet } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, formatPrice } from '../components/UI'
import { DELIVERY_TRANSITIONS } from '../utils/permissions'
import { OrderStatusBadge, SummaryCards, customerName, customerPhone, formatDate, shortId } from './AdminOrderPages'

const PAYMENT_METHODS = { cod: 'Cash on Delivery', online: 'Online payment' }
const ADVANCE_LABEL = { out_for_delivery: 'Start Delivery', delivered: 'Mark as Delivered' }
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'preparing', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
]

// Readable labels + plain-language explanations for the two permissions this portal actually uses.
// Deliberately not the generic admin-panel wording ("View deliveries" / "Update deliveries" in
// utils/permissions.js's PERMISSION_GROUPS) — these are addressed to the rider, not the owner
// configuring access.
const DELIVERY_PERMISSION_LABELS = [
  { permission: 'delivery:view', label: 'View Assigned Deliveries', description: 'Lets you see the orders currently assigned to you — customer name and phone, delivery address, schedule and payment details.' },
  { permission: 'delivery:update', label: 'Update Delivery Status', description: 'Lets you move your assigned orders forward: starting delivery (Ready → Out for Delivery) and marking an order as Delivered.' },
]

export function PermissionDetailModal({ item, onClose }) {
  return <Modal title={item.label} onClose={onClose}>
    <p className="adm-modal-text">{item.description}</p>
    <p className="rider-permission-code">Permission code: <code>{item.permission}</code></p>
    <div className="adm-modal-foot">
      <button type="button" className="button button-outline" onClick={onClose}>Close</button>
    </div>
  </Modal>
}

// Reads straight from the authenticated session's own permissions (via `can`, already backed by
// user.permissions from /auth/me or the OTP-verify response) — never hardcoded, and a permission the
// account does not hold is simply left out, never shown as granted or as a disabled placeholder.
// Each pill is a real <button> (not a clickable <div>) so it's focusable and Enter/Space-activatable
// without extra handlers; the detail view reuses the shared Modal component, which already closes on
// Escape and on a click outside it (components/UI.jsx), matching the rest of the app.
export function MyPermissions({ can }) {
  const [active, setActive] = useState(null)
  const granted = DELIVERY_PERMISSION_LABELS.filter((item) => can(item.permission))
  if (!granted.length) return null
  return <section className="rider-permissions" aria-label="My permissions">
    <h2>My Permissions</h2>
    <div className="rider-permission-list">
      {granted.map((item) => <button type="button" key={item.permission} className="rider-permission-pill" onClick={() => setActive(item)}><ShieldCheck size={14} />{item.label}</button>)}
    </div>
    {active && <PermissionDetailModal item={active} onClose={() => setActive(null)} />}
  </section>
}

function addressLines(address = {}) {
  const line = [address.house, address.street, address.landmark].filter(Boolean).join(', ')
  const cityLine = [address.city, address.state, address.postalCode].filter(Boolean).join(', ')
  return { line: line || '—', cityLine }
}

// Google Maps' plain search URL needs no API key and no paid dependency — it just opens the Maps app
// (or maps.google.com) with the destination pre-filled.
function mapsHrefFor(address = {}) {
  const query = [address.house, address.street, address.landmark, address.city, address.state, address.postalCode].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function ConfirmDeliveredModal({ order, busy, onClose, onConfirm }) {
  return <Modal title="Mark as delivered?" onClose={onClose}>
    <p className="adm-modal-text">Confirm that <strong>{customerName(order)}</strong>'s order ({shortId(order._id)}) has been handed over. This cannot be undone.</p>
    <div className="adm-modal-foot">
      <button type="button" className="button button-outline" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Updating…' : 'Yes, mark delivered'}</button>
    </div>
  </Modal>
}

export function DeliveryCard({ order, busy, canUpdate, onAdvance }) {
  const nextStatus = canUpdate ? DELIVERY_TRANSITIONS[order.orderStatus] : undefined
  const phone = customerPhone(order)
  const telHref = phone && phone !== '—' ? `tel:+91${phone.replace(/\D/g, '')}` : null
  const address = order.deliveryAddress || {}
  const { line, cityLine } = addressLines(address)

  return <article className="order-card rider-order-card">
    <div className="order-card-head"><span>{shortId(order._id)}</span><OrderStatusBadge status={order.orderStatus} /></div>

    <div className="rider-card-customer">
      <strong>{customerName(order)}</strong>
      {telHref ? <a className="rider-call-link" href={telHref}><Phone size={14} />+91 {phone}</a> : <span className="adm-muted">Phone not available</span>}
    </div>

    <div className="rider-card-address">
      <MapPin size={16} />
      <div className="rider-card-address-text">
        {address.recipient && <span>{address.recipient}</span>}
        <small>{line}</small>
        {cityLine && <small>{cityLine}</small>}
        {order.deliveryInstructions && <small className="rider-instructions">“{order.deliveryInstructions}”</small>}
      </div>
    </div>

    <div className="rider-card-meta">
      <span><CalendarDays size={14} />{formatDate(order.deliveryDate)}</span>
      <span><Clock size={14} />{order.preferredTimeSlot || 'Any time'}</span>
    </div>
    <div className="rider-card-meta">
      <span><Wallet size={14} />{formatPrice(order.totalAmount)}</span>
      <span>{PAYMENT_METHODS[order.paymentMethod] || order.paymentMethod || '—'}</span>
      <span className={`status-pill status-payment-${order.paymentStatus}`}>{order.paymentStatus || 'pending'}</span>
    </div>

    <div className="rider-card-actions">
      <a className="button button-outline" href={mapsHrefFor(address)} target="_blank" rel="noreferrer"><Navigation size={15} />Open Navigation</a>
      {canUpdate && nextStatus && <button type="button" className="button button-primary" disabled={busy} onClick={() => onAdvance(order, nextStatus)}>{busy ? 'Updating…' : ADVANCE_LABEL[nextStatus]}</button>}
    </div>
  </article>
}

export default function DeliveryDashboardPage() {
  const toast = useToast()
  const { can } = useAuth()
  const canUpdate = can('delivery:update')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [busyId, setBusyId] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/delivery/my-orders')
      setOrders(data.orders)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function advance(order, nextStatus) {
    setBusyId(order._id)
    try {
      const { data } = await api.patch(`/delivery/my-orders/${order._id}/status`, { orderStatus: nextStatus })
      setOrders((current) => current.map((item) => (item._id === data.order._id ? data.order : item)))
      toast(`${shortId(order._id)} marked as ${nextStatus.replaceAll('_', ' ')}.`)
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setBusyId(null)
    }
  }

  // "Mark as Delivered" needs confirmation first; "Start Delivery" doesn't. Either way, a second tap
  // while the first is still in flight is ignored.
  function requestAdvance(order, nextStatus) {
    if (busyId) return
    if (nextStatus === 'delivered') { setConfirmTarget(order); return }
    advance(order, nextStatus)
  }
  function confirmDelivered() {
    const order = confirmTarget
    setConfirmTarget(null)
    advance(order, 'delivered')
  }

  // Counts come only from this rider's own orders, never any admin/global order list.
  const countFor = (status) => orders.filter((order) => order.orderStatus === status).length
  const summary = [
    { icon: Clock, label: 'Ready to deliver', value: countFor('preparing') },
    { icon: Truck, label: 'Out for delivery', value: countFor('out_for_delivery') },
    { icon: CheckCircle2, label: 'Delivered', value: countFor('delivered') },
  ]
  const rows = tab === 'all' ? orders : orders.filter((order) => order.orderStatus === tab)

  return <div className="rider-dashboard">
    <div className="rider-dashboard-head"><h1>My Deliveries</h1><p>Orders currently assigned to you.</p></div>

    <MyPermissions can={can} />

    {!loading && !error && <SummaryCards cards={summary} />}

    <nav className="adm-status-tabs" aria-label="Delivery status">
      {TABS.map((item) => <button type="button" key={item.key} className={`adm-status-tab${item.key === tab ? ' active' : ''}`} onClick={() => setTab(item.key)}>{item.label}{!loading && !error && <span>{item.key === 'all' ? orders.length : countFor(item.key)}</span>}</button>)}
    </nav>

    {loading ? <Loader label="Loading your deliveries" /> : error ? (
      <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
    ) : !orders.length ? (
      <EmptyState icon={Truck} title="No deliveries yet" message="Orders will show up here once they're assigned to you." />
    ) : !rows.length ? (
      <EmptyState icon={Truck} title="No orders in this filter" message="Try a different status filter." />
    ) : <div className="rider-order-grid">
      {rows.map((order) => <DeliveryCard key={order._id} order={order} busy={busyId === order._id} canUpdate={canUpdate} onAdvance={requestAdvance} />)}
    </div>}

    {confirmTarget && <ConfirmDeliveredModal order={confirmTarget} busy={busyId === confirmTarget._id} onClose={() => setConfirmTarget(null)} onConfirm={confirmDelivered} />}
  </div>
}
