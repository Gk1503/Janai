import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, ClipboardList, Package, Plus, Save, ShoppingBag, Users, X } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader } from '../components/UI'

const tabs = ['Overview', 'Products', 'Orders', 'Pre-orders', 'Bulk requests', 'Customers']
const statuses = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']
const bulkStatuses = ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed']
// Common selling units for produce and groceries; an existing custom unit is kept in the list.
const units = ['kg', '500 g', '250 g', 'piece', 'dozen', 'bunch', 'pack', 'box', 'litre', '500 ml']
const productCategories = ['Fruits', 'Vegetables', 'Groceries', 'Combo Packs', 'Seasonal Specials']
const newProduct = { name: '', category: 'Fruits', subCategory: '', description: '', price: '', unit: 'kg', image: '', stock: 0, rating: 4.7, reviews: 0, preOrderAvailable: false, bulkAvailable: false, featured: false }

export default function AdminPage() {
  const toast = useToast()
  const [tab, setTab] = useState('Overview')
  const [data, setData] = useState({ products: [], orders: [], preorders: [], bulk: [], users: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [product, setProduct] = useState(null)
  const [busy, setBusy] = useState(false)
  async function load() {
    setLoading(true)
    try {
      const [products, orders, preorders, bulk, users] = await Promise.all([api.get('/products', { params: { limit: 100 } }), api.get('/admin/orders'), api.get('/admin/preorders'), api.get('/admin/bulk-orders'), api.get('/admin/users')])
      setData({ products: products.data.products, orders: orders.data.orders, preorders: preorders.data.orders, bulk: bulk.data.requests, users: users.data.users }); setError('')
    } catch (requestError) { setError(getApiError(requestError)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  async function saveProduct(event) {
    event.preventDefault(); setBusy(true)
    const payload = { ...product, price: Number(product.price), stock: Number(product.stock), images: product.image ? [product.image] : [] }
    try { if (product._id) await api.put(`/products/${product._id}`, payload); else await api.post('/products', payload); toast('Product saved.'); setProduct(null); await load() } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy(false) }
  }
  async function removeProduct(item) {
    if (!window.confirm(`Remove ${item.name} from the catalog?`)) return
    try { await api.delete(`/products/${item._id}`); toast('Product removed.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  async function orderStatus(order, value) {
    try { await api.patch(`/admin/orders/${order._id}/status`, { orderStatus: value }); toast('Order status updated.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  async function bulkStatus(request, value) {
    try { await api.patch(`/admin/bulk-orders/${request._id}/status`, { status: value }); toast('Bulk request updated.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  async function userRole(item, value) {
    try { await api.patch(`/admin/users/${item._id}/role`, { role: value }); toast('Role updated.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  return <section className="page-container admin-page"><div className="admin-heading"><div><span className="eyebrow">JANAI OPERATIONS</span><h1>Admin Dashboard</h1></div></div><nav className="admin-tabs">{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>{loading ? <Loader label="Loading Janai operations" /> : error ? <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div> : <div className="admin-content">{tab === 'Overview' && <><div className="admin-stat-grid">{[[ShoppingBag,'Orders',data.orders.length],[CalendarDays,'Pre-orders',data.preorders.length],[ClipboardList,'Bulk requests',data.bulk.length],[Users,'Customers',data.users.length]].map(([Icon,label,value]) => <article key={label}><span><Icon size={19} /></span><small>{label}</small><strong>{value}</strong></article>)}</div><section className="admin-panel"><div className="panel-heading"><h2>Recent orders</h2><button className="text-link" onClick={() => setTab('Orders')}>View all<ArrowRight size={14} /></button></div>{data.orders.slice(0,5).map((order) => <div className="admin-list-row" key={order._id}><Package size={17} /><span>#{String(order._id).slice(-8)} · {order.user?.firstName || 'Customer'}</span><strong>₹{order.totalAmount}</strong><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus.replaceAll('_',' ')}</span></div>)}</section></>}
      {tab === 'Products' && <section className="admin-panel"><div className="panel-heading"><h2>Product catalog</h2><button className="button button-primary" onClick={() => setProduct({ ...newProduct })}><Plus size={15} />Add product</button></div>{product && <form className="admin-product-form" onSubmit={saveProduct}><div className="panel-heading"><h3>{product._id ? 'Edit product' : 'New product'}</h3><button className="icon-button" type="button" onClick={() => setProduct(null)} aria-label="Close"><X size={17} /></button></div><div className="form-grid"><label className="field"><span>Name</span><input required value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></label><label className="field"><span>Category</span><select value={product.category} onChange={(event) => setProduct({ ...product, category: event.target.value })}>{productCategories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="field"><span>Description</span><input required value={product.description} onChange={(event) => setProduct({ ...product, description: event.target.value })} /></label><label className="field"><span>Price</span><input required type="number" min="0" step="0.01" value={product.price} onChange={(event) => setProduct({ ...product, price: event.target.value })} /></label><label className="field"><span>Unit</span><select required value={product.unit} onChange={(event) => setProduct({ ...product, unit: event.target.value })}>{[...new Set([...units, product.unit].filter(Boolean))].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><label className="field"><span>Stock</span><input required type="number" min="0" value={product.stock} onChange={(event) => setProduct({ ...product, stock: event.target.value })} /></label><label className="field field-wide"><span>Image URL</span><input value={product.image} onChange={(event) => setProduct({ ...product, image: event.target.value })} /></label></div><div className="admin-checkboxes">{[['preOrderAvailable','Pre-order'],['bulkAvailable','Bulk'],['featured','Featured']].map(([key,label]) => <label key={key}><input type="checkbox" checked={Boolean(product[key])} onChange={(event) => setProduct({ ...product, [key]: event.target.checked })} />{label}</label>)}</div><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}<Save size={15} /></button></form>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>{data.products.map((item) => <tr key={item._id}><td>{item.name}</td><td>{item.category}</td><td>₹{item.price} / {item.unit}</td><td>{item.stock}</td><td><button className="table-action" onClick={() => setProduct({ ...item, image: item.images?.[0] || '' })}>Edit</button><button className="table-action danger" onClick={() => removeProduct(item)}>Delete</button></td></tr>)}</tbody></table></div></section>}
      {(tab === 'Orders' || tab === 'Pre-orders') && <section className="admin-panel"><h2>{tab}</h2>{(tab === 'Orders' ? data.orders : data.preorders).length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Delivery</th><th>Time slot</th><th>Total</th><th>Status</th></tr></thead><tbody>{(tab === 'Orders' ? data.orders : data.preorders).map((order) => <tr key={order._id}><td>#{String(order._id).slice(-8)}</td><td>{order.user?.firstName || 'Customer'} {order.user?.lastName || ''}</td><td>{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</td><td>{order.preferredTimeSlot || 'Any time'}</td><td>₹{order.totalAmount}</td><td><select value={order.orderStatus} onChange={(event) => orderStatus(order, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></td></tr>)}</tbody></table></div> : <EmptyState title="No orders yet" message="Customer orders will appear here." />}</section>}
      {tab === 'Bulk requests' && <section className="admin-panel"><h2>Bulk order requests</h2>{data.bulk.length ? data.bulk.map((request) => <article className="bulk-history-card" key={request._id}><div><strong>{request.name} · {request.organization || request.orderType}</strong><small>{request.products.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</small><small>{request.phone} · {request.email}</small><small>{request.deliveryAddress}</small></div><select value={request.status} onChange={(event) => bulkStatus(request, event.target.value)}>{bulkStatuses.map((status) => <option key={status}>{status}</option>)}</select></article>) : <EmptyState title="No requests yet" message="Bulk requests will appear here." />}</section>}
      {tab === 'Customers' && <section className="admin-panel"><h2>Customers</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th></tr></thead><tbody>{data.users.map((item) => <tr key={item._id}><td>{item.firstName} {item.lastName}</td><td>{item.email}</td><td>{item.phone}</td><td><select value={item.role} onChange={(event) => userRole(item, event.target.value)}><option value="customer">Customer</option><option value="admin">Admin</option></select></td></tr>)}</tbody></table></div></section>}</div>}</section>
}
