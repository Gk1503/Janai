import { useEffect, useState } from 'react'
import { Boxes, CheckCircle2, Clock, Eye, Truck, UserPlus } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { DELIVERY_TRANSITIONS, orderActions } from '../utils/permissions'
import { EmptyState, Loader, Modal } from '../components/UI'
import {
  DELIVERY_DATE_FILTERS, OrderDetailsModal, OrderStatusBadge, Pagination, SummaryCards, Toolbar,
  customerName, customerPhone, formatDate, formatDateTime, matchesDate, matchesSearch, shortId, useDebouncedSearch,
} from './AdminOrderPages'

const PAGE_SIZE = 10
const PAYMENT_METHODS = { cod: 'Cash on Delivery', online: 'Online payment' }

// Delivery Management works only with orders that have reached (or finished) the delivery stage of the
// existing placed -> confirmed -> preparing -> out_for_delivery -> delivered workflow. "Ready" here is
// orderStatus 'preparing' — no new status is introduced, this page just groups the existing ones.
const DELIVERY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'preparing', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
]
const ADVANCE_LABEL = { out_for_delivery: 'Send out', delivered: 'Mark delivered' }
const assigneeName = (staff) => (staff ? (`${staff.firstName || ''} ${staff.lastName || ''}`.trim() || staff.adminId) : '')
const addressLine = (order) => { const a = order.deliveryAddress || {}; return [a.house, a.street, a.city].filter(Boolean).join(', ') || '—' }

function AssignModal({ order, eligibleStaff, onClose, onSaved }) {
  const toast = useToast()
  const [staffId, setStaffId] = useState(order.assignedDeliveryStaff?._id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.patch(`/admin/delivery/orders/${order._id}/assign`, { staffId: staffId || null })
      onSaved(data.order)
      toast(data.message)
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`Assign delivery · ${shortId(order._id)}`} onClose={onClose}>
    <p className="adm-modal-text">Choose who will deliver this order. Only active staff with delivery permissions are listed.</p>
    <label className="field"><span>Delivery staff</span>
      <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
        <option value="">— Unassigned —</option>
        {eligibleStaff.map((staff) => <option key={staff._id} value={staff._id}>{assigneeName(staff)} ({staff.loginId})</option>)}
      </select>
    </label>
    {!eligibleStaff.length && <p className="adm-muted">No active staff currently hold delivery permissions. Add one from Delivery Staff first.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="adm-modal-foot">
      <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save assignment'}</button>
    </div>
  </Modal>
}

export default function AdminDeliveryManagementPage() {
  const toast = useToast()
  const { can } = useAuth()
  const [orders, setOrders] = useState([])
  const [eligibleStaff, setEligibleStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { searchInput, search, onSearch, reset } = useDebouncedSearch()
  const [tab, setTab] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [assignTarget, setAssignTarget] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [ordersRes, staffRes] = await Promise.all([api.get('/admin/delivery/orders'), api.get('/admin/delivery/staff')])
      setOrders(ordersRes.data.orders)
      setEligibleStaff(staffRes.data.staff)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [search, tab, dateFilter])

  function applyUpdatedOrder(updated) {
    setOrders((current) => current.map((order) => (order._id === updated._id ? updated : order)))
  }

  async function advance(order, nextStatus) {
    setBusyId(order._id)
    try {
      const { data } = await api.patch(`/admin/orders/${order._id}/status`, { orderStatus: nextStatus })
      applyUpdatedOrder(data.order)
      toast(`${shortId(order._id)} marked as ${nextStatus.replaceAll('_', ' ')}.`)
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const rows = orders
    .filter((order) => tab === 'all' || order.orderStatus === tab)
    .filter((order) => matchesDate(order.deliveryDate, dateFilter))
    .filter((order) => matchesSearch([order._id, shortId(order._id), customerName(order), customerPhone(order), order.deliveryAddress?.recipient, addressLine(order)], search))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtersActive = Boolean(search.trim()) || tab !== 'all' || dateFilter !== 'all'
  const selected = orders.find((order) => order._id === selectedId)
  const assignOrder = orders.find((order) => order._id === assignTarget)

  // Overview cards reflect the full eligible set (same convention as the Orders page's own stat cards),
  // independent of whatever the toolbar below is currently filtering the table to.
  const countFor = (statuses) => orders.filter((order) => statuses.includes(order.orderStatus)).length
  const awaitingAssignment = orders.filter((order) => ['preparing', 'out_for_delivery'].includes(order.orderStatus) && !order.assignedDeliveryStaff).length
  const summary = [
    { icon: Boxes, label: 'Total eligible deliveries', value: orders.length },
    { icon: Clock, label: 'Awaiting assignment', value: awaitingAssignment },
    { icon: Truck, label: 'Out for delivery', value: countFor(['out_for_delivery']) },
    { icon: CheckCircle2, label: 'Delivered', value: countFor(['delivered']) },
  ]

  return <div className="adm-products-page adm-orders-page">
    <div className="adm-page-head">
      <div><h1>Delivery Management</h1><p>Orders ready for, or already on, delivery — "Ready" means the order has finished preparation.</p></div>
      {!loading && !error && <span className="adm-count-chip"><strong>{rows.length}</strong> {rows.length === 1 ? 'delivery' : 'deliveries'}</span>}
    </div>

    {!loading && !error && <SummaryCards cards={summary} />}

    <nav className="adm-status-tabs" aria-label="Delivery status">
      {DELIVERY_TABS.map((item) => <button type="button" key={item.key} className={`adm-status-tab${item.key === tab ? ' active' : ''}`} onClick={() => setTab(item.key)}>{item.label}{!loading && !error && <span>{item.key === 'all' ? orders.length : countFor([item.key])}</span>}</button>)}
    </nav>

    <Toolbar searchInput={searchInput} onSearch={onSearch} placeholder="Search by order ID, customer, phone or address…" filtersActive={filtersActive} onReset={() => { reset(); setTab('all'); setDateFilter('all') }}>
      <label className="sort-select"><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter by delivery date">{DELIVERY_DATE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </Toolbar>

    <section className="adm-panel">
      {loading ? <Loader label="Loading deliveries" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !orders.length ? (
        <EmptyState icon={Truck} title="No deliveries yet" message="Orders appear here once they're marked Preparing — ready for delivery." />
      ) : !rows.length ? (
        <EmptyState title="No deliveries found" message="Try changing your search or filters." />
      ) : <>
        <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Order ID</th><th>Customer</th><th>Address</th><th>Scheduled</th><th>Total</th><th>Payment</th><th>Assigned to</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visible.map((order) => {
                const nextStatus = DELIVERY_TRANSITIONS[order.orderStatus]
                const { canUpdate } = orderActions(can, order)
                return <tr key={order._id}>
                  <td data-label="Order ID"><button type="button" className="adm-link-button" onClick={() => setSelectedId(order._id)}>{shortId(order._id)}</button></td>
                  <td data-label="Customer"><span className="adm-cell-stack"><strong>{customerName(order)}</strong><small>{customerPhone(order)}</small></span></td>
                  <td data-label="Address" className="adm-col-address"><span className="adm-cell-wrap">{addressLine(order)}</span></td>
                  <td data-label="Scheduled"><span className="adm-cell-stack"><span>{formatDate(order.deliveryDate)}</span><small>{order.preferredTimeSlot || 'Any time'}</small></span></td>
                  <td data-label="Total"><strong>₹{Number(order.totalAmount).toLocaleString('en-IN')}</strong></td>
                  <td data-label="Payment"><span className="adm-cell-stack"><span>{PAYMENT_METHODS[order.paymentMethod] || order.paymentMethod}</span><span className={`status-pill status-payment-${order.paymentStatus}`}>{order.paymentStatus}</span></span></td>
                  <td data-label="Assigned to">{order.assignedDeliveryStaff ? <span className="adm-cell-stack"><strong>{assigneeName(order.assignedDeliveryStaff)}</strong><small>{formatDateTime(order.assignedAt)}</small></span> : <span className="adm-muted">Unassigned</span>}</td>
                  <td data-label="Status"><OrderStatusBadge status={order.orderStatus} /></td>
                  <td data-label="Actions" className="adm-col-actions"><span className="adm-row-actions">
                    <button type="button" className="table-action" onClick={() => setSelectedId(order._id)}><Eye size={14} />View</button>
                    {can('delivery:update') && order.orderStatus !== 'delivered' && <button type="button" className="table-action" onClick={() => setAssignTarget(order._id)}><UserPlus size={14} />{order.assignedDeliveryStaff ? 'Reassign' : 'Assign'}</button>}
                    {canUpdate && nextStatus && <button type="button" className="table-action is-primary" disabled={busyId === order._id} onClick={() => advance(order, nextStatus)}>{busyId === order._id ? 'Saving…' : ADVANCE_LABEL[nextStatus]}</button>}
                  </span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} onChange={setPage} label="Delivery pages" />
      </>}
    </section>

    {selected && <OrderDetailsModal order={selected} busy={busyId === selected._id} onClose={() => setSelectedId(null)} onStatusChange={(order, orderStatus) => advance(order, orderStatus)} />}
    {assignOrder && <AssignModal order={assignOrder} eligibleStaff={eligibleStaff} onClose={() => setAssignTarget(null)} onSaved={applyUpdatedOrder} />}
  </div>
}
