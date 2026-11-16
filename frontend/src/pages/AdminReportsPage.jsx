import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileText, IndianRupee, ShoppingBag, Truck, Users } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, formatPrice, Loader } from '../components/UI'

const RANGES = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7 days' }, { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' }, { key: 'lastMonth', label: 'Last month' }, { key: 'custom', label: 'Custom' },
]
const TABS = [
  { key: 'sales', label: 'Sales' }, { key: 'orders', label: 'Orders' }, { key: 'products', label: 'Products & categories' }, { key: 'customers', label: 'Customers' },
  { key: 'preorders', label: 'Pre-orders' }, { key: 'bulk', label: 'Bulk orders' }, { key: 'inventory', label: 'Inventory' },
]
const STATUS_LABELS = { placed: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }
// Report days are India days (the backend fixes them to IST), so "today" for the date picker is too.
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const number = (value) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const shortPeriod = (period) => (period.length === 7 ? period : period.slice(5))

async function readError(error) {
  const data = error.response?.data
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || 'Could not export the report.' } catch { return 'Could not export the report.' }
  }
  return getApiError(error)
}

function Change({ value }) {
  if (value === null || value === undefined) return <span className="rpt-change is-flat" title="No data in the previous period to compare with">n/a</span>
  if (value === 0) return <span className="rpt-change is-flat">0%</span>
  return <span className={`rpt-change ${value > 0 ? 'is-up' : 'is-down'}`}>{value > 0 ? '▲' : '▼'} {Math.abs(value)}%</span>
}

// Dependency-free bar chart. Bars are drawn from the real series; every bar has a text tooltip.
function BarChart({ rows, valueKey, format = number, label }) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 0)
  if (!rows.length || max === 0) return <p className="adm-muted rpt-empty">No activity in this period.</p>
  const width = Math.max(rows.length * 22, 320)
  const step = width / rows.length
  return <div className="rpt-chart">
    <svg viewBox={`0 0 ${width} 180`} role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" y1="150" x2={width} y2="150" className="rpt-axis" />
      {rows.map((row, index) => {
        const value = Number(row[valueKey]) || 0
        const height = (value / max) * 130
        return <rect key={row.period} x={index * step + step * 0.15} y={150 - height} width={step * 0.7} height={Math.max(height, value > 0 ? 2 : 0)} rx="2" className="rpt-bar"><title>{`${row.period}: ${format(value)}`}</title></rect>
      })}
    </svg>
    <div className="rpt-chart-scale"><span>{shortPeriod(rows[0].period)}</span><span>peak {format(max)}</span><span>{shortPeriod(rows[rows.length - 1].period)}</span></div>
  </div>
}

function Bars({ items }) {
  const max = Math.max(...items.map((item) => item.value), 0)
  if (!max) return <p className="adm-muted rpt-empty">No data in this period.</p>
  return <ul className="rpt-hbars">{items.map((item) => <li key={item.label}><span>{item.label}</span><div><i style={{ width: `${(item.value / max) * 100}%` }} /></div><strong>{item.text ?? number(item.value)}</strong></li>)}</ul>
}

function Table({ columns, rows, empty = 'No data in this period.' }) {
  if (!rows.length) return <p className="adm-muted rpt-empty">{empty}</p>
  return <div className="admin-table-wrap"><table className="admin-table adm-responsive-table">
    <thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.id ?? row.period ?? row.name ?? row.category ?? row.label ?? row.date ?? row.status ?? row.unit ?? index}>{columns.map((column) => <td key={column.label} data-label={column.label}>{column.render(row)}</td>)}</tr>)}</tbody>
  </table></div>
}

function Panel({ title, note, children }) {
  return <section className="adm-panel rpt-panel"><div className="panel-heading"><h2>{title}</h2></div>{children}{note && <p className="adm-muted rpt-note">{note}</p>}</section>
}

function Stats({ items }) {
  return <div className="adm-order-stats">{items.map(({ label, value, hint }) => <article className="adm-order-stat" key={label}><small>{label}</small><strong>{value}</strong>{hint && <small>{hint}</small>}</article>)}</div>
}

function SalesTab({ data }) {
  const { summary, previous, changes } = data
  return <>
    <Stats items={[
      { label: 'Order value', value: formatPrice(summary.orderValue), hint: `${summary.activeOrders} orders, cancelled excluded` },
      { label: 'Delivered order value', value: formatPrice(summary.deliveredValue), hint: `${summary.deliveredOrders} delivered` },
      { label: 'Average order value', value: formatPrice(summary.averageOrderValue) },
      { label: 'Collected revenue', value: data.collection.tracked ? formatPrice(summary.collectedValue) : 'Not tracked', hint: data.collection.tracked ? `${summary.collectedOrders} paid orders` : 'Cash on delivery is not recorded' },
    ]} />
    <Panel title="Compared with the previous period" note={data.collection.note}>
      <Table columns={[
        { label: 'Measure', render: (row) => row.label }, { label: 'This period', render: (row) => row.now }, { label: 'Previous period', render: (row) => row.before }, { label: 'Change', render: (row) => <Change value={row.change} /> },
      ]} rows={[
        { label: 'Order value', now: formatPrice(summary.orderValue), before: formatPrice(previous.orderValue), change: changes.orderValue },
        { label: 'Delivered order value', now: formatPrice(summary.deliveredValue), before: formatPrice(previous.deliveredValue), change: changes.deliveredValue },
        { label: 'Orders (not cancelled)', now: summary.activeOrders, before: previous.activeOrders, change: changes.activeOrders },
        { label: 'Average order value', now: formatPrice(summary.averageOrderValue), before: formatPrice(previous.averageOrderValue), change: changes.averageOrderValue },
      ]} />
    </Panel>
    <Panel title="Order value over time"><BarChart rows={data.series} valueKey="orderValue" format={formatPrice} label="Order value over time" /></Panel>
    <Panel title="Delivered value over time"><BarChart rows={data.series} valueKey="deliveredValue" format={formatPrice} label="Delivered order value over time" /></Panel>
    <Panel title="Normal orders and pre-orders">
      <Table columns={[{ label: 'Type', render: (row) => (row.type === 'preorder' ? 'Pre-orders' : 'Normal orders') }, { label: 'Orders', render: (row) => row.orders }, { label: 'Order value', render: (row) => formatPrice(row.orderValue) }, { label: 'Delivered value', render: (row) => formatPrice(row.deliveredValue) }]} rows={data.byType} />
    </Panel>
  </>
}

function OrdersTab({ data }) {
  const t = data.totals
  return <>
    <Stats items={[{ label: 'Total orders', value: t.total }, { label: 'Pending', value: t.pending }, { label: 'Processing', value: t.processing, hint: 'Confirmed + preparing' }, { label: 'Out for delivery', value: t.outForDelivery }, { label: 'Delivered', value: t.delivered }, { label: 'Cancelled', value: t.cancelled }]} />
    <Panel title="Status distribution"><Bars items={data.distribution.map((entry) => ({ label: STATUS_LABELS[entry.status], value: entry.count, text: `${entry.count} (${entry.percent}%)` }))} /></Panel>
    <Panel title="Orders placed over time"><BarChart rows={data.series} valueKey="placed" label="Orders placed over time" /></Panel>
    <Panel title="Normal orders and pre-orders" note={`Bulk order requests are a separate quotation workflow and are not part of these totals (${data.bulkRequests} received in this period).`}>
      <Table columns={['total', 'pending', 'processing', 'outForDelivery', 'delivered', 'cancelled'].reduce((cols, key) => [...cols, { label: { total: 'Total', pending: 'Pending', processing: 'Processing', outForDelivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }[key], render: (row) => row[key] }], [{ label: 'Type', render: (row) => row.name }])}
        rows={[{ name: 'Normal orders', ...data.byType.normal }, { name: 'Pre-orders', ...data.byType.preorder }]} />
    </Panel>
  </>
}

function StockTables({ data }) {
  return <>
    <Panel title={`Low stock (${data.threshold} or fewer)`} note={data.lowStock.truncated ? 'Showing the 50 lowest.' : ''}>
      <Table columns={[{ label: 'Product', render: (row) => row.name }, { label: 'Category', render: (row) => row.category }, { label: 'In stock', render: (row) => `${number(row.stock)} ${row.unit}` }]} rows={data.lowStock.products} empty="No products are running low." />
    </Panel>
    <Panel title="Out of stock" note={data.outOfStock.truncated ? 'Showing the first 50.' : ''}>
      <Table columns={[{ label: 'Product', render: (row) => row.name }, { label: 'Category', render: (row) => row.category }]} rows={data.outOfStock.products} empty="Nothing is out of stock." />
    </Panel>
  </>
}

function ProductsTab({ data, by, onBy }) {
  return <>
    <Panel title="Best-selling products" note="Sales use the price and quantity saved on each order, not today's prices. Cancelled orders are excluded.">
      <label className="sort-select rpt-inline-select"><select value={by} onChange={(event) => onBy(event.target.value)} aria-label="Rank products by"><option value="sales">Rank by sales value</option><option value="quantity">Rank by quantity sold</option></select></label>
      <Table columns={[{ label: 'Product', render: (row) => row.name }, { label: 'Quantity sold', render: (row) => `${number(row.quantity)} ${row.unit}` }, { label: 'Sales value', render: (row) => formatPrice(row.sales) }, { label: 'Order lines', render: (row) => row.orders }]} rows={data.topProducts} />
    </Panel>
    <Panel title="Category performance" note={data.categoryNote}>
      <Bars items={data.categories.map((entry) => ({ label: entry.category, value: entry.sales, text: formatPrice(entry.sales) }))} />
    </Panel>
    <StockTables data={data} />
  </>
}

function CustomersTab({ data }) {
  return <>
    <Stats items={[{ label: 'Total customers', value: data.totalCustomers }, { label: 'New in period', value: data.newCustomers, hint: <Change value={data.newCustomersChange} /> }, { label: 'Customers who ordered', value: data.activeCustomers }, { label: 'Repeat customers', value: data.repeatCustomers, hint: '2 or more orders' }]} />
    <Panel title="New customers over time"><BarChart rows={data.registrations} valueKey="registrations" label="New customers over time" /></Panel>
    <Panel title="Orders per customer"><Bars items={data.buckets.map((bucket) => ({ label: bucket.label, value: bucket.customers }))} /></Panel>
    <Panel title="Top customers by order value" note="Cancelled orders are excluded. Contact details are not shown in reports.">
      <Table columns={[{ label: 'Customer', render: (row) => row.name }, { label: 'Orders', render: (row) => row.orders }, { label: 'Order value', render: (row) => formatPrice(row.value) }]} rows={data.topCustomers} />
    </Panel>
  </>
}

function PreordersTab({ data }) {
  return <>
    <Stats items={[{ label: 'Pre-orders placed', value: data.total }, { label: 'Upcoming', value: data.upcoming, hint: `Active, delivery ${data.asOf} or later` }, { label: 'Completed', value: data.completed, hint: 'Delivered' }, { label: 'Cancelled', value: data.cancelled }, { label: 'Overdue', value: data.overdue, hint: 'Active, delivery date passed' }]} />
    <Panel title="Delivery date distribution" note="Pre-orders placed in this period that are not cancelled, by the day they are due.">
      <BarChart rows={data.deliveryDates.map((row) => ({ period: row.date, orders: row.orders }))} valueKey="orders" label="Pre-orders by delivery date" />
      <Table columns={[{ label: 'Delivery date', render: (row) => row.date }, { label: 'Pre-orders', render: (row) => row.orders }, { label: 'Value', render: (row) => formatPrice(row.value) }]} rows={data.deliveryDates} />
    </Panel>
    <Panel title="Pre-orders placed over time"><BarChart rows={data.series} valueKey="placed" label="Pre-orders placed over time" /></Panel>
  </>
}

function BulkTab({ data }) {
  return <>
    <Stats items={[{ label: 'Requests received', value: data.total }, { label: 'With a quotation', value: data.quotedRequests }, { label: 'Awaiting decision', value: formatPrice(data.openQuotationValue), hint: 'Quoted, not yet approved' }, { label: 'Approved and beyond', value: formatPrice(data.approvedQuotationValue), hint: 'Approved, processing, completed' }]} />
    <Panel title="Requests by status" note={data.note}>
      <Table columns={[{ label: 'Status', render: (row) => row.status }, { label: 'Requests', render: (row) => row.count }, { label: 'Quotation value', render: (row) => formatPrice(row.quotationValue) }]} rows={data.statuses} />
    </Panel>
    <Panel title="Requests over time"><BarChart rows={data.series} valueKey="requests" label="Bulk requests over time" /></Panel>
  </>
}

function InventoryTab({ data }) {
  const m = data.movement
  return <>
    <Stats items={[{ label: 'Total products', value: data.totals.totalProducts }, { label: 'Total stock', value: number(data.totals.totalStock), hint: 'Units of different products added together' }, { label: 'Low stock', value: data.totals.lowStock, hint: `${data.threshold} or fewer` }, { label: 'Out of stock', value: data.totals.outOfStock }]} />
    <StockTables data={data} />
    <Panel title="Goods received from suppliers" note={m.note}>
      <Table columns={[{ label: 'Unit', render: (row) => row.unit }, { label: 'Purchases received', render: (row) => row.purchases }, { label: 'Quantity', render: (row) => number(row.quantity) }]} rows={m.receivedFromSuppliers} empty="No supplier purchases were received in this period." />
    </Panel>
  </>
}

export default function AdminReportsPage() {
  const toast = useToast()
  const [range, setRange] = useState('last30')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [appliedCustom, setAppliedCustom] = useState(null)
  const [tab, setTab] = useState('sales')
  const [by, setBy] = useState('sales')
  const [lowStock, setLowStock] = useState(10)
  const [overview, setOverview] = useState(null)
  const [report, setReport] = useState({ key: '', data: null, error: '', loading: true })
  const [exporting, setExporting] = useState('')

  const params = useMemo(() => {
    if (range !== 'custom') return { range }
    return appliedCustom ? { range, ...appliedCustom } : null
  }, [range, appliedCustom])
  const tabParams = useMemo(() => (params ? { ...params, ...(tab === 'products' ? { by } : {}), ...(tab === 'products' || tab === 'inventory' ? { lowStock } : {}) } : null), [params, tab, by, lowStock])
  const queryKey = tabParams ? `${tab}|${JSON.stringify(tabParams)}` : ''
  const overviewKey = params ? JSON.stringify(params) : ''
  const customError = range === 'custom' && custom.from && custom.to && custom.to < custom.from ? 'The end date cannot be before the start date.' : ''

  useEffect(() => {
    if (!overviewKey) return undefined
    let current = true
    api.get('/admin/reports/overview', { params: JSON.parse(overviewKey) }).then(({ data }) => { if (current) setOverview({ key: overviewKey, ...data }) }).catch((error) => { if (current) toast(getApiError(error), 'error') })
    return () => { current = false }
  }, [overviewKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!queryKey) return undefined
    let current = true
    api.get(`/admin/reports/${tab}`, { params: tabParams })
      .then(({ data }) => { if (current) setReport({ key: queryKey, data, error: '', loading: false }) })
      .catch((error) => { if (current) setReport({ key: queryKey, data: null, error: getApiError(error), loading: false }) })
    return () => { current = false }
  }, [queryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyCustom(event) {
    event.preventDefault()
    if (!custom.from || !custom.to || customError) return
    setAppliedCustom({ from: custom.from, to: custom.to })
  }

  async function download(format) {
    if (!tabParams) return
    setExporting(format)
    try {
      const response = await api.get('/admin/reports/export', { params: { section: tab, format, ...tabParams }, responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = /filename="([^"]+)"/.exec(response.headers['content-disposition'] || '')?.[1] || `janai-${tab}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) { toast(await readError(error), 'error') } finally { setExporting('') }
  }

  const cards = overview?.key === overviewKey ? overview.cards : null
  const fresh = report.key === queryKey
  const loading = Boolean(queryKey) && !fresh
  const data = fresh ? report.data : null
  const rangeInfo = overview?.key === overviewKey ? overview.range : null

  return <div className="adm-products-page rpt-page">
    <div className="adm-page-head">
      <div><h1>Reports &amp; Analytics</h1><p>{rangeInfo ? `${rangeInfo.from} to ${rangeInfo.to} · ${rangeInfo.timezone}` : 'Sales, orders, customers and stock for the period you choose.'}</p></div>
      <div className="rpt-export">
        <button type="button" className="button button-outline" disabled={!tabParams || Boolean(exporting)} onClick={() => download('csv')}><Download size={16} />{exporting === 'csv' ? 'Preparing…' : 'Export CSV'}</button>
        <button type="button" className="button button-outline" disabled={!tabParams || Boolean(exporting)} onClick={() => download('pdf')}><FileText size={16} />{exporting === 'pdf' ? 'Preparing…' : 'Export PDF'}</button>
      </div>
    </div>

    <div className="rpt-filters">
      <div className="segmented-control rpt-ranges" role="group" aria-label="Date range">
        {RANGES.map((item) => <button key={item.key} type="button" className={range === item.key ? 'selected' : ''} onClick={() => setRange(item.key)}>{item.label}</button>)}
      </div>
      {range === 'custom' && <form className="rpt-custom" onSubmit={applyCustom}>
        <label>From<input type="date" max={todayIst()} value={custom.from} onChange={(event) => setCustom((c) => ({ ...c, from: event.target.value }))} /></label>
        <label>To<input type="date" max={todayIst()} value={custom.to} onChange={(event) => setCustom((c) => ({ ...c, to: event.target.value }))} /></label>
        <button type="submit" className="button button-primary" disabled={!custom.from || !custom.to || Boolean(customError)}>Apply</button>
        {customError && <small className="field-error" role="alert">{customError}</small>}
      </form>}
    </div>

    {range === 'custom' && !params ? <EmptyState icon={BarChart3} title="Choose a date range" message="Pick a start and end date, then press Apply." action="" /> : <>
      <div className="adm-order-stats rpt-cards">
        {[
          { icon: IndianRupee, label: 'Total revenue', value: cards && formatPrice(cards.revenue.value), change: cards?.revenue.change, hint: 'Value of delivered orders' },
          { icon: ShoppingBag, label: 'Total orders', value: cards && number(cards.totalOrders.value), change: cards?.totalOrders.change, hint: 'Placed in the period' },
          { icon: Truck, label: 'Delivered orders', value: cards && number(cards.deliveredOrders.value), change: cards?.deliveredOrders.change, hint: 'Of orders placed in the period' },
          { icon: BarChart3, label: 'Average order value', value: cards && formatPrice(cards.averageOrderValue.value), change: cards?.averageOrderValue.change, hint: 'Cancelled orders excluded' },
          { icon: Users, label: 'Total customers', value: cards && number(cards.totalCustomers.value), hint: cards ? `${cards.totalCustomers.newInPeriod} new in period` : '' },
        ].map(({ icon: Icon, label, value, change, hint }) => <article className="adm-order-stat" key={label}>
          <span className="adm-order-stat-icon"><Icon size={18} /></span><small>{label}</small><strong>{value ?? '…'}</strong>
          <small>{change !== undefined && cards && <Change value={change} />} {hint}</small>
        </article>)}
      </div>
      <p className="adm-muted rpt-note">Revenue is the value of delivered orders. Payment on delivery is not recorded, so actual cash collected cannot be reported. Bulk-order quotations are never counted as revenue.</p>

      <nav className="adm-status-tabs" aria-label="Report sections">
        {TABS.map((item) => <button key={item.key} type="button" className={`adm-status-tab${tab === item.key ? ' active' : ''}`} onClick={() => setTab(item.key)}>{item.label}</button>)}
      </nav>
      {(tab === 'inventory' || tab === 'products') && <label className="sort-select rpt-inline-select"><select value={lowStock} onChange={(event) => setLowStock(Number(event.target.value))} aria-label="Low-stock level">{[5, 10, 20, 50].map((level) => <option key={level} value={level}>Low stock: {level} or fewer</option>)}</select></label>}

      {loading ? <Loader label="Loading report" /> : report.error ? <div className="inline-error">{report.error}</div> : data && <div className="rpt-body">
        {tab === 'sales' && <SalesTab data={data} />}
        {tab === 'orders' && <OrdersTab data={data} />}
        {tab === 'products' && <ProductsTab data={data} by={by} onBy={setBy} />}
        {tab === 'customers' && <CustomersTab data={data} />}
        {tab === 'preorders' && <PreordersTab data={data} />}
        {tab === 'bulk' && <BulkTab data={data} />}
        {tab === 'inventory' && <InventoryTab data={data} />}
      </div>}
    </>}
import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { EmptyState, Loader } from '../components/UI'
import { localDate } from '../utils/validation'

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

const SOURCE_LABELS = {
  manual: 'Manual adjustment',
  order_placed: 'Order placed',
  order_cancelled: 'Order cancelled',
  preorder_confirmed: 'Pre-order confirmed',
  bulk_approved: 'Bulk order approved',
  bulk_rejected: 'Bulk order rejected',
  vendor_received: 'Vendor purchase received',
}
const TYPE_LABELS = { add: 'Add', remove: 'Remove', set_exact: 'Set Exact' }
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const PRODUCT_PAGE_LIMIT = 20

function ProductReportPagination({ page, pages, onChange }) {
  if (pages <= 1) return null
  return <nav className="adm-pagination" aria-label="Product report pages">
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span className="adm-muted">Page {page} of {pages}</span>
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

// Pure and exported so the date-preset math (today/yesterday/last7/last30/thisMonth/custom) can be
// unit-tested without rendering the page. Resolves to the YYYY-MM-DD pair the backend expects — the
// backend itself interprets these as Asia/Kolkata local dates (see stockReportController.js), so this
// only ever needs the browser's own local "today", exactly like the existing checkout date picker
// (utils/validation.js's localDate) already assumes for this India-only app.
export function resolveReportRange(preset, customFrom, customTo) {
  if (preset === 'custom') {
    if (!customFrom || !customTo) return { error: 'Choose both a start and end date.' }
    if (customFrom > customTo) return { error: 'The start date must be on or before the end date.' }
    return { from: customFrom, to: customTo }
  }
  if (preset === 'today') return { from: localDate(0), to: localDate(0) }
  if (preset === 'yesterday') return { from: localDate(-1), to: localDate(-1) }
  if (preset === 'last7') return { from: localDate(-6), to: localDate(0) }
  if (preset === 'last30') return { from: localDate(-29), to: localDate(0) }
  if (preset === 'thisMonth') {
    const now = new Date()
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: localDate(0) }
  }
  return { error: 'Choose a date range.' }
}

export default function AdminReportsPage() {
  // Defaults to the last 30 days (Phase 7.3) — a wider default window than Phases 7.1/7.2 originally
  // shipped with, since the product-wise report's opening/closing-unavailable rows are far more common
  // over a short window; custom ranges remain fully selectable regardless, and every other preset
  // (today/yesterday/last7/thisMonth) is unaffected.
  const [preset, setPreset] = useState('last30')
  const [customFrom, setCustomFrom] = useState(localDate(-29))
  const [customTo, setCustomTo] = useState(localDate(0))
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [staffSummary, setStaffSummary] = useState(null)
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [variationFilter, setVariationFilter] = useState('')
  const [productPage, setProductPage] = useState(1)
  const [productSummary, setProductSummary] = useState(null)
  const [productLoading, setProductLoading] = useState(true)
  const [productError, setProductError] = useState('')

  async function load() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setError(range.error); setSummary(null); setLoading(false); return }
    setLoading(true)
    try {
      const { data } = await api.get('/stock/reports/summary', { params: { from: range.from, to: range.to } })
      setSummary(data)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadStaff() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setStaffError(range.error); setStaffSummary(null); setStaffLoading(false); return }
    setStaffLoading(true)
    try {
      const { data } = await api.get('/stock/reports/staff', { params: { from: range.from, to: range.to } })
      setStaffSummary(data)
      setStaffError('')
    } catch (requestError) {
      setStaffError(getApiError(requestError))
      setStaffSummary(null)
    } finally {
      setStaffLoading(false)
    }
  }

  async function loadProducts() {
    const range = resolveReportRange(preset, customFrom, customTo)
    if (range.error) { setProductError(range.error); setProductSummary(null); setProductLoading(false); return }
    setProductLoading(true)
    try {
      const params = { from: range.from, to: range.to, page: productPage, limit: PRODUCT_PAGE_LIMIT }
      if (productFilter.trim()) params.product = productFilter.trim()
      if (productFilter.trim() && variationFilter.trim()) params.variationId = variationFilter.trim()
      const { data } = await api.get('/stock/reports/products', { params })
      setProductSummary(data)
      setProductError('')
    } catch (requestError) {
      setProductError(getApiError(requestError))
      setProductSummary(null)
    } finally {
      setProductLoading(false)
    }
  }

  useEffect(() => { load(); loadStaff() }, [preset, customFrom, customTo])
  // A changed date range or filter always restarts at page 1 — a stale page number from a previous,
  // larger result set must never be carried into a new query.
  useEffect(() => { setProductPage(1) }, [preset, customFrom, customTo, productFilter, variationFilter])
  useEffect(() => { loadProducts() }, [preset, customFrom, customTo, productFilter, variationFilter, productPage])

  const hasMovements = Boolean(summary?.byUnit?.length)
  const hasStaffAdjustments = Boolean(staffSummary?.staff?.length)
  const hasProductRows = Boolean(productSummary?.rows?.length)

  return <div className="adm-reports-page adm-data-page">
    <div className="adm-page-head">
      <div><h1>Reports</h1><p>Inventory movement summary — stock added and removed across your chosen date range.</p></div>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="sort-select"><select value={preset} onChange={(event) => setPreset(event.target.value)} aria-label="Date range">{PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {preset === 'custom' && <>
          <label className="field"><span>From</span><input type="date" value={customFrom} max={localDate(0)} onChange={(event) => setCustomFrom(event.target.value)} aria-label="Custom range start date" /></label>
          <label className="field"><span>To</span><input type="date" value={customTo} max={localDate(0)} onChange={(event) => setCustomTo(event.target.value)} aria-label="Custom range end date" /></label>
        </>}
      </div>
      {summary && !error && <p className="adm-muted">Showing {summary.from} to {summary.to}.</p>}
    </section>

    <section className="adm-panel">
      {loading ? <Loader label="Loading inventory movement summary" /> : error ? (
        <div className="inline-error">{error}<button type="button" className="text-link" onClick={load}>Retry</button></div>
      ) : !hasMovements ? (
        <EmptyState icon={BarChart3} title="No stock movements in this range" message="Try a wider date range." />
      ) : <>
        <h2 className="adm-modal-section-title">Inventory Movement Summary</h2>
        <div className="adm-report-unit-grid">
          {summary.byUnit.map((row) => <article className="adm-report-unit-card" key={row.unit}>
            <strong className="adm-report-unit-name">{row.unit}</strong>
            <div className="adm-report-unit-figures">
              <div><small>Added</small><strong>+{row.added} {row.unit}</strong></div>
              <div><small>Removed</small><strong>-{row.removed} {row.unit}</strong></div>
              <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
              <div><small>Movements</small><strong>{row.movementCount}</strong></div>
            </div>
          </article>)}
        </div>
        <p className="adm-muted">Quantities of different units are never combined into one total.</p>

        <h2 className="adm-modal-section-title">Additions &amp; Removals by Source</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Source</th><th>Unit</th><th>Added</th><th>Removed</th><th>Net</th><th>Movements</th></tr></thead>
            <tbody>{summary.bySource.map((row) => <tr key={`${row.source}-${row.unit}`}>
              <td>{SOURCE_LABELS[row.source] || row.source}</td>
              <td>{row.unit}</td>
              <td>+{row.added}</td>
              <td>-{row.removed}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <h2 className="adm-modal-section-title">Additions &amp; Removals by Movement Type</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Type</th><th>Unit</th><th>Added</th><th>Removed</th><th>Net</th><th>Movements</th></tr></thead>
            <tbody>{summary.byType.map((row) => <tr key={`${row.type}-${row.unit}`}>
              <td>{TYPE_LABELS[row.type] || row.type}</td>
              <td>{row.unit}</td>
              <td>+{row.added}</td>
              <td>-{row.removed}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>

    <section className="adm-panel">
      {staffLoading ? <Loader label="Loading staff adjustment report" /> : staffError ? (
        <div className="inline-error">{staffError}<button type="button" className="text-link" onClick={loadStaff}>Retry</button></div>
      ) : !hasStaffAdjustments ? (
        <EmptyState icon={BarChart3} title="No manual adjustments in this range" message="Try a wider date range." />
      ) : <>
        <h2 className="adm-modal-section-title">Staff Adjustment Report</h2>
        <p className="adm-muted">Manual stock adjustments only — automatic movements from orders, pre-orders, bulk orders and vendor purchases are excluded.</p>
        {staffSummary.staff.map((entry) => {
          const primaryName = entry.nameHistory[0]?.name || 'Unknown staff'
          return <article className="adm-staff-card" key={entry.actorId}>
            <header className="adm-staff-card-head">
              <div>
                <div className="adm-staff-card-name">{primaryName}</div>
                {entry.nameHistory.length > 1 && <details className="adm-staff-namehistory">
                  <summary>{entry.nameHistory.length} historical names</summary>
                  <ul>{entry.nameHistory.map((item) => <li key={item.name}>{item.name} — {item.adjustmentCount} adjustment{item.adjustmentCount === 1 ? '' : 's'} (last {formatDateTime(item.lastSeenAt)})</li>)}</ul>
                </details>}
              </div>
              <div className="adm-staff-card-stats">
                <div><small>Total adjustments</small><strong>{entry.totalAdjustments}</strong></div>
                <div><small>Set Exact</small><strong>{entry.setExactCount}</strong></div>
                <div><small>Last adjustment</small><strong>{formatDateTime(entry.lastAdjustmentAt)}</strong></div>
              </div>
            </header>

            <div className="adm-report-unit-grid">
              {entry.byUnit.map((row) => <article className="adm-report-unit-card" key={row.unit}>
                <strong className="adm-report-unit-name">{row.unit}</strong>
                <div className="adm-report-unit-figures">
                  <div><small>Added</small><strong>+{row.added} {row.unit}</strong></div>
                  <div><small>Removed</small><strong>-{row.removed} {row.unit}</strong></div>
                  <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
                  <div><small>Adjustments</small><strong>{row.count}</strong></div>
                </div>
              </article>)}
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Reason</th><th>Adjustments</th></tr></thead>
                <tbody>{entry.byReason.map((row) => <tr key={row.reason}><td>{row.reason}</td><td>{row.count}</td></tr>)}</tbody>
              </table>
            </div>
          </article>
        })}
      </>}
    </section>

    <section className="adm-panel">
      <h2 className="adm-modal-section-title">Product-wise Inventory Movement</h2>
      <p className="adm-muted">Ledger-recorded quantities grouped by product, variation and their historically recorded unit. A product's unit can change without a ledger entry, so opening and closing balances cannot be verified from this data and are always shown as unavailable below.</p>

      <div className="adm-toolbar">
        <label className="field">
          <span>Product ID</span>
          <input type="text" value={productFilter} onChange={(event) => { setProductFilter(event.target.value); if (!event.target.value.trim()) setVariationFilter('') }} placeholder="Optional" aria-label="Filter by product ID" />
        </label>
        <label className="field">
          <span>Variation ID</span>
          <input type="text" value={variationFilter} onChange={(event) => setVariationFilter(event.target.value)} placeholder="Optional — requires a product ID" aria-label="Filter by variation ID" disabled={!productFilter.trim()} />
        </label>
        {(productFilter || variationFilter) && <button type="button" className="text-link" onClick={() => { setProductFilter(''); setVariationFilter('') }}>Clear filters</button>}
      </div>

      {productLoading ? <Loader label="Loading product-wise inventory report" /> : productError ? (
        <div className="inline-error">{productError}<button type="button" className="text-link" onClick={loadProducts}>Retry</button></div>
      ) : !hasProductRows ? (
        <EmptyState icon={BarChart3} title="No ledger-recorded movements in this range" message="Try a wider date range, or clear the product/variation filters." />
      ) : <>
        <div className="admin-table-wrap adm-product-report-table">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Variation</th><th>Unit</th><th>Incoming</th><th>Outgoing</th><th>Net</th><th>Movements</th><th>Opening</th><th>Closing</th></tr></thead>
            <tbody>{productSummary.rows.map((row) => <tr key={`${row.productId}-${row.variationId}-${row.unit}`}>
              <td>{row.productName}{row.isDeleted && <> <span className="status-pill is-muted">Deleted</span></>}</td>
              <td>{row.variationLabel}</td>
              <td>{row.unit}</td>
              <td>+{row.incoming}</td>
              <td>-{row.outgoing}</td>
              <td>{row.net > 0 ? '+' : ''}{row.net}</td>
              <td>{row.movementCount}</td>
              <td><span className="adm-balance-unavailable" title="Cannot be verified — a unit change leaves no ledger trace, so continuity cannot be proven.">Unavailable</span></td>
              <td><span className="adm-balance-unavailable" title="Cannot be verified — a unit change leaves no ledger trace, so continuity cannot be proven.">Unavailable</span></td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="adm-product-report-cards">
          {productSummary.rows.map((row) => <article className="adm-product-row-card" key={`${row.productId}-${row.variationId}-${row.unit}`}>
            <div className="adm-product-row-card-head">
              <strong>{row.productName}{row.isDeleted && <> <span className="status-pill is-muted">Deleted</span></>}</strong>
              <span className="adm-muted">{row.variationLabel} · {row.unit}</span>
            </div>
            <div className="adm-product-row-card-figures">
              <div><small>Incoming</small><strong>+{row.incoming} {row.unit}</strong></div>
              <div><small>Outgoing</small><strong>-{row.outgoing} {row.unit}</strong></div>
              <div><small>Net</small><strong>{row.net > 0 ? '+' : ''}{row.net} {row.unit}</strong></div>
              <div><small>Movements</small><strong>{row.movementCount}</strong></div>
            </div>
            <p className="adm-balance-unavailable">Opening and closing balances are unavailable — a unit change leaves no ledger trace, so continuity cannot be proven.</p>
          </article>)}
        </div>

        <ProductReportPagination page={productSummary.page} pages={productSummary.pages} onChange={setProductPage} />
      </>}
    </section>
  </div>
}
