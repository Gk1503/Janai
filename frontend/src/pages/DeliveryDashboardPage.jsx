import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Clock, MapPin, Navigation, Phone, ShieldCheck, Truck, Wallet } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal, formatPrice } from '../components/UI'
import { adminNavigation } from '../components/adminNavigation'
import { DELIVERY_TRANSITIONS, PERMISSION_GROUPS, PERMISSION_LIST } from '../utils/permissions'
import { OrderStatusBadge, SummaryCards, customerName, customerPhone, formatDate, shortId } from './AdminOrderPages'

const PAYMENT_METHODS = { cod: 'Cash on Delivery', online: 'Online payment' }
const ADVANCE_LABEL = { out_for_delivery: 'Start Delivery', delivered: 'Mark as Delivered' }
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'preparing', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
]

// Rider-specific wording for the two permissions this portal's own actions already use — richer and
// more concrete than the generic admin-panel catalog entry for the same permission
// (utils/permissions.js's PERMISSION_GROUPS), which is written for the owner configuring access, not
// the rider reading about their own access.
const DELIVERY_OVERRIDES = {
  'delivery:view': { label: 'View Assigned Deliveries', description: 'Lets you see the orders currently assigned to you — customer name and phone, delivery address, schedule and payment details.' },
  'delivery:update': { label: 'Update Delivery Status', description: 'Lets you move your assigned orders forward: starting delivery (Ready → Out for Delivery) and marking an order as Delivered.' },
}

// Flat permission -> {label, description, groupLabel} lookup built from the shared catalog
// (utils/permissions.js's PERMISSION_GROUPS), so this page never keeps its own permission list — any
// permission added to the catalog later is picked up here automatically. A permission somehow missing
// from the catalog still gets a safe fallback (see MyPermissions), never silently dropped.
const PERMISSION_DETAILS = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => [
    item.permission,
    { groupLabel: group.label, label: item.label, description: item.description, ...(DELIVERY_OVERRIDES[item.permission] || {}) },
  ])),
)

// Already on the one dedicated page for these two — offering a second link to /admin/delivery (the
// desktop admin-panel delivery listing) would just be a confusing, redundant detour out of this portal.
const SKIP_NAV_FOR = new Set(['delivery:view', 'delivery:update'])

// Reuses the exact same permission -> route map the admin sidebar itself is built from
// (components/adminNavigation.js), so a permission only ever offers a link to a module that genuinely
// exists and is independently gated by that same permission, both by App.jsx's RequirePermission and by
// the backend route behind it. Matches by group (not just the exact permission clicked) so, for
// example, clicking "Cancel orders" still offers "Open All Orders", not nothing, since cancelling an
// order happens on that same page as viewing it.
function navTargetFor(permission) {
  if (SKIP_NAV_FOR.has(permission)) return null
  const group = PERMISSION_GROUPS.find((entry) => entry.items.some((item) => item.permission === permission));
  const groupPermissions = new Set((group?.items || [{ permission }]).map((item) => item.permission))
  for (const navGroup of adminNavigation) {
    for (const navItem of navGroup.items) {
      const accessPermissions = navItem.access?.permission ? [navItem.access.permission] : (navItem.access?.any || [])
      if (accessPermissions.some((permissionCode) => groupPermissions.has(permissionCode))) return navItem
    }
  }
  return null
}

export function PermissionDetailModal({ item, onClose }) {
  const target = navTargetFor(item.permission)
  return <Modal title={item.label} onClose={onClose}>
    <p className="adm-modal-text">{item.description}</p>
    <p className="rider-permission-code">Permission code: <code>{item.permission}</code></p>
    <div className="adm-modal-foot">
      <button type="button" className="button button-outline" onClick={onClose}>Close</button>
      {target && <Link className="button button-primary" to={target.path} onClick={onClose}>Open {target.label}</Link>}
    </div>
  </Modal>
}

// Reads straight from the authenticated session's own effective permissions (via `can`, already backed
// by user.permissions from /auth/me or the OTP-verify response) — every entry in the full catalog
// (PERMISSION_LIST) is checked, so this reflects exactly what the account holds, never a hardcoded
// subset, and a permission the account does not hold is simply left out, never shown as granted or as a
// disabled placeholder. Each pill is a real <button> (not a clickable <div>) so it's focusable and
// Enter/Space-activatable without extra handlers; the detail view reuses the shared Modal component,
// which already closes on Escape and on a click outside it (components/UI.jsx), matching the rest of
// the app.
export function MyPermissions({ can }) {
  const [active, setActive] = useState(null)
  const grantedPermissions = PERMISSION_LIST.filter((permission) => can(permission))
  if (!grantedPermissions.length) return null

  const groups = []
  for (const permission of grantedPermissions) {
    const details = PERMISSION_DETAILS[permission] || { groupLabel: 'Other', label: permission, description: 'No description is available for this permission yet.' }
    const item = { permission, label: details.label, description: details.description }
    let group = groups.find((entry) => entry.label === details.groupLabel)
    if (!group) { group = { label: details.groupLabel, items: [] }; groups.push(group) }
    group.items.push(item)
  }

  return <section className="rider-permissions" aria-label="My permissions">
    <h2>My Permissions</h2>
    {groups.map((group) => <div className="rider-permission-group" key={group.label}>
      <h3>{group.label}</h3>
      <div className="rider-permission-list">
        {group.items.map((item) => <button type="button" key={item.permission} className="rider-permission-pill" onClick={() => setActive(item)}><ShieldCheck size={14} />{item.label}</button>)}
      </div>
    </div>)}
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
