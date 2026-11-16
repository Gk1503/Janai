import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes, ClipboardList, PackageX, ShoppingBag, Truck } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader, formatPrice } from '../components/UI'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

// A unit-aware stock total is never collapsed into one number (kg and L, say, must never be summed) —
// mirrors the identical convention already used on the Vendor Detail Page and Vendor Analytics.
export function formatStockByUnit(entries) {
  if (!entries || !entries.length) return '—'
  return entries.map((entry) => `${entry.quantity ?? entry.stock} ${entry.unit}`).join(' · ')
}

// Pure and exported so it can be unit-tested without rendering the page. Labels an order/bulk-order
// derived activity row in plain language — this is one timestamp on the order itself (Phase 2), not a
// row in a permanent stock movement ledger, and the wording must never imply otherwise.
export function describeOrderEvent(event) {
  const kind = event.type === 'bulk_order' ? 'Bulk request' : event.orderType === 'preorder' ? 'Pre-order' : 'Order'
  const action = event.event === 'restored' ? 'stock restored (cancelled/rejected)' : 'stock deducted'
  return `${kind} ${action}`
}

export default function AdminInventoryPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const { data: response } = await api.get('/inventory/overview')
      setData(response)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  return <div className="adm-inventory-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Inventory</h1><p>Stock levels, attention items and recent stock activity across the catalog.</p></div>
      <Link to="/admin/products" className="button button-outline"><Boxes size={15} />View Stock</Link>
    </div>

    {loading ? <section className="adm-panel"><Loader label="Loading inventory overview" /></section> : error ? (
      <section className="adm-panel"><div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div></section>
    ) : !data ? null : <>
      <section className="adm-metric-grid">
        <article className="adm-metric-card"><span className="adm-metric-icon"><Boxes size={18} /></span><small>Total Products</small><strong>{data.summary.totalProducts}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><ClipboardList size={18} /></span><small>Active Variations</small><strong>{data.summary.totalActiveVariations}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><PackageX size={18} /></span><small>Out of Stock</small><strong>{data.summary.outOfStockCount}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><AlertTriangle size={18} /></span><small>Low Stock</small><strong>{data.summary.lowStockCount}</strong></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><ShoppingBag size={18} /></span><small>Healthy (threshold set)</small><strong>{data.summary.healthyConfiguredCount}</strong></article>
        {/* Deliberately a separate card, not folded into "healthy" — a variation with no threshold
            configured is unknown, not confirmed healthy, per the Phase 2 convention that a threshold of
            0 is indistinguishable from "never set". */}
        <article className="adm-metric-card"><span className="adm-metric-icon"><ClipboardList size={18} /></span><small>No Threshold Set</small><strong>{data.summary.unconfiguredThresholdCount}</strong><span className="adm-field-hint">Not counted as low or healthy until a minimum is configured</span></article>
        <article className="adm-metric-card"><span className="adm-metric-icon"><Truck size={18} /></span><small>Incoming (Ordered)</small><strong>{data.summary.incoming.count}</strong><span className="adm-field-hint">{formatStockByUnit(data.summary.incoming.quantityByUnit)}</span></article>
      </section>

      <p className="adm-muted">Available stock by unit: {formatStockByUnit(data.summary.stockByUnit)}. Units are never combined into a single total.</p>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Stock Attention</h2>
        {!data.attention.outOfStock.length && !data.attention.lowStock.length ? (
          <EmptyState icon={ShoppingBag} title="Nothing needs attention" message="No item is currently out of stock or below its configured minimum." />
        ) : <>
          {Boolean(data.attention.outOfStock.length) && <div className="adm-soft-section">
            <div className="adm-form-section-head"><PackageX size={16} /><h3>Out of Stock ({data.attention.outOfStock.length})</h3></div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Product</th><th>Variation</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                  {data.attention.outOfStock.map((item, index) => <tr key={`${item.productId}:${item.variationId || index}`}>
                    <td>{item.productName}</td>
                    <td>{item.variationLabel || '—'}</td>
                    <td>{item.stock} {item.unit}</td>
                    <td><Link className="text-link" to="/admin/products">Manage</Link></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>}
          {Boolean(data.attention.lowStock.length) && <div className="adm-soft-section">
            <div className="adm-form-section-head"><AlertTriangle size={16} /><h3>Low Stock ({data.attention.lowStock.length})</h3></div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Product</th><th>Variation</th><th>Stock</th><th>Minimum</th><th></th></tr></thead>
                <tbody>
                  {data.attention.lowStock.map((item, index) => <tr key={`${item.productId}:${item.variationId || index}`}>
                    <td>{item.productName}</td>
                    <td>{item.variationLabel || '—'}</td>
                    <td>{item.stock} {item.unit}</td>
                    <td>{item.minStockThreshold} {item.unit}</td>
                    <td><Link className="text-link" to="/admin/products">Manage</Link></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>}
        </>}
      </section>

      <section className="adm-panel">
        <h2 className="adm-modal-section-title">Recent Stock Activity</h2>
        <p className="adm-muted">Order and bulk-request rows below reflect each order's own stock timestamp, not a permanent stock movement ledger — a dedicated movement history is a future phase.</p>
        {!data.recentActivity.receivedPurchases.length && !data.recentActivity.orderEvents.length ? (
          <EmptyState title="No recent activity" message="Recently received purchases and order stock events will appear here." />
        ) : <>
          {Boolean(data.recentActivity.receivedPurchases.length) && <div className="adm-soft-section">
            <div className="adm-form-section-head"><Truck size={16} /><h3>Recently Received Purchases</h3></div>
            <div className="adm-history-list">
              {data.recentActivity.receivedPurchases.map((purchase, index) => <div className="adm-history-item" key={index}>
                <div className="adm-stock-activity-row">
                  <span className={purchase.productExists === false ? 'adm-muted' : undefined}>{purchase.productName}</span>
                  <span>{purchase.quantity} {purchase.unit} · {purchase.vendorName}</span>
                  {/* The column is always reserved so the date column never shifts depending on who is
                      viewing — only its content is conditional on supplier-cost permission. */}
                  <span className="adm-stock-activity-amount">{data.canViewPurchaseValues ? formatPrice(purchase.totalAmount) : ''}</span>
                  <span className="adm-stock-activity-date">{formatDate(purchase.receivedAt)}</span>
                </div>
              </div>)}
            </div>
          </div>}
          {Boolean(data.recentActivity.orderEvents.length) && <div className="adm-soft-section">
            <div className="adm-form-section-head"><ClipboardList size={16} /><h3>Order-Derived Stock Events</h3></div>
            <div className="adm-history-list">
              {data.recentActivity.orderEvents.map((event) => <div className="adm-history-item" key={`${event.type}:${event.id}`}>
                <div className="adm-history-item-main">
                  <span>{describeOrderEvent(event)}</span>
                  <span>{formatDateTime(event.at)}</span>
                </div>
              </div>)}
            </div>
          </div>}
        </>}
      </section>
    </>}
  </div>
}
