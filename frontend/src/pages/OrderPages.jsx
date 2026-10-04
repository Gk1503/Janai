import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CreditCard, MapPin, Package, ShoppingBag, Trash2, Truck } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useCart, useToast } from '../context/AppContexts'
import { EmptyState, Loader, OrderCard, QuantitySelector } from '../components/UI'

const blankAddress = { recipient: '', phone: '', street: '', city: '', state: '', postalCode: '' }
const localDate = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export function CartPage() {
  const { user } = useAuth()
  const { items, total, cartLoading, setQuantity, removeItem } = useCart()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!user) return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR BASKET</span><h1>My Cart</h1></div></div><EmptyState icon={ShoppingBag} title="Sign in to see your cart" message="Your basket is linked to your Janai account." action="Sign in" to="/login" /></section>
  async function remove(productId) { setBusy(true); try { await removeItem(productId); toast('Item removed from cart.') } catch (error) { toast(getApiError(error), 'error') } finally { setBusy(false) } }
  async function quantity(productId, value) { setBusy(true); try { await setQuantity(productId, value) } catch (error) { toast(getApiError(error), 'error') } finally { setBusy(false) } }
  const fee = total >= 500 || !total ? 0 : 25
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR BASKET</span><h1>My Cart <small>{items.length}</small></h1><p>A little freshness is on its way.</p></div><Link className="text-link" to="/shop"><ArrowLeft size={15} /> Continue shopping</Link></div>{cartLoading ? <Loader label="Loading your basket" /> : !items.length ? <EmptyState icon={ShoppingBag} title="Your cart is empty" message="Add fresh picks from the shop and they’ll appear here." action="Find fresh picks" /> : <div className="cart-layout"><div className="cart-lines">{items.filter((item) => item.product).map(({ product, quantity: amount }) => <article className="cart-line" key={product._id}><Link to={`/product/${product._id}`} className="cart-line-image"><img src={product.images?.[0] || '/fruit.jpg'} alt={product.name} /></Link><div className="cart-line-details"><Link to={`/product/${product._id}`}><strong>{product.name}</strong></Link><span>₹{product.price} / {product.unit}</span><div className="cart-line-bottom"><QuantitySelector value={amount} onChange={(value) => quantity(product._id, value)} max={Math.max(1, product.stock)} compact /><strong>₹{(product.price * amount).toLocaleString('en-IN')}</strong></div></div><button type="button" className="icon-button remove-item" aria-label={`Remove ${product.name}`} disabled={busy} onClick={() => remove(product._id)}><Trash2 size={16} /></button></article>)}<div className="delivery-note"><Truck size={17} /><span>{total >= 500 ? 'Free delivery unlocked.' : `Add ₹${500 - total} more for free delivery.`}</span><Link to="/shop">Add more</Link></div></div><aside className="summary-panel"><h2>Order summary</h2><div><span>Subtotal</span><strong>₹{total.toLocaleString('en-IN')}</strong></div><div><span>Delivery charges</span><strong>{fee ? `₹${fee}` : 'Free'}</strong></div><div className="summary-total"><span>Total Amount</span><strong>₹{(total + fee).toLocaleString('en-IN')}</strong></div><Link className="button button-primary button-full" to="/checkout">Proceed to Checkout<ArrowRight size={16} /></Link></aside></div>}</section>
}

export function CheckoutPage() {
  const { user } = useAuth()
  const { items, total, clearCart } = useCart()
  const toast = useToast()
  const navigate = useNavigate()
  const [address, setAddress] = useState(() => user.addresses?.find((item) => item.isDefault) || user.addresses?.[0] || blankAddress)
  const [deliveryDate, setDeliveryDate] = useState(localDate())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fee = total >= 500 || !total ? 0 : 25
  async function placeOrder(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { data } = await api.post('/orders', { items: items.map(({ product, quantity }) => ({ productId: product._id, quantity })), deliveryAddress: address, deliveryDate, paymentMethod: 'cod' })
      await clearCart(); toast(data.message || 'Order placed successfully.'); navigate(`/orders/${data.order._id}`)
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  if (!items.length) return <section className="page-container content-page"><EmptyState icon={ShoppingBag} title="Your cart is empty" message="Choose a few fresh picks before checkout." action="Browse shop" /></section>
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">ALMOST THERE</span><h1>Checkout</h1><p>Delivery, payment, and then your fresh picks are on their way.</p></div></div><form className="checkout-layout" onSubmit={placeOrder}><div className="checkout-main"><section className="form-panel"><h2><MapPin size={18} /> Delivery address</h2><div className="form-grid">{[['recipient','Full name'],['phone','Phone'],['street','Street address'],['city','City'],['state','State'],['postalCode','PIN code']].map(([key,label]) => <label className="field" key={key}><span>{label}</span><input required value={address[key] || ''} onChange={(event) => setAddress({ ...address, [key]: event.target.value })} /></label>)}</div></section><section className="form-panel"><h2><CalendarDays size={18} /> Delivery date</h2><label className="field"><span>Choose a day</span><input type="date" required min={localDate()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label></section><section className="form-panel"><h2><CreditCard size={18} /> Payment</h2><label className="payment-choice"><input type="radio" checked readOnly /><span><strong>Cash on Delivery</strong><small>Pay when your order arrives</small></span></label><p className="muted-copy">Online payments are not available yet.</p></section>{error && <div className="form-error">{error}</div>}</div><aside className="summary-panel"><h2>Order summary</h2>{items.map(({ product, quantity }) => <div key={product._id}><span>{product.name} × {quantity}</span><strong>₹{(product.price * quantity).toLocaleString('en-IN')}</strong></div>)}<div><span>Delivery</span><strong>{fee ? `₹${fee}` : 'Free'}</strong></div><div className="summary-total"><span>Total</span><strong>₹{(total + fee).toLocaleString('en-IN')}</strong></div><button className="button button-primary button-full" disabled={busy}>{busy ? 'Placing order…' : 'Place Order'}<ArrowRight size={16} /></button></aside></form></section>
}

export function PreOrdersPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [productId, setProductId] = useState(new URLSearchParams(window.location.search).get('product') || '')
  const [quantity, setQuantity] = useState(1)
  const [date, setDate] = useState(localDate(1))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = products.find((product) => product._id === productId)
  async function load() {
    try {
      const responses = await Promise.all([api.get('/products', { params: { preOrder: true, limit: 100 } }), user ? api.get('/preorders') : Promise.resolve({ data: { orders: [] } })])
      setProducts(responses[0].data.products); setOrders(responses[1].data.orders)
      setProductId((current) => current || responses[0].data.products[0]?._id || '')
    } catch (requestError) { setError(getApiError(requestError)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user?._id])
  async function submit(event) {
    event.preventDefault()
    if (!user) { window.location.assign('/login'); return }
    const address = user.addresses?.find((item) => item.isDefault) || user.addresses?.[0]
    if (!address) { setError('Add a delivery address to your profile first.'); return }
    setBusy(true); setError('')
    try { const { data } = await api.post('/preorders', { items: [{ productId, quantity }], deliveryDate: date, deliveryAddress: address, paymentMethod: 'cod' }); toast(data.message); await load() } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  async function cancel(id) {
    try { await api.put(`/preorders/${id}/cancel`); toast('Pre-order cancelled.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  return <div className="preorder-page"><section className="preorder-hero page-container"><div><span className="eyebrow">A LITTLE PLANNING, A LOT OF FRESH</span><h1>Plan Ahead,<br /><span>Stay Fresh</span></h1><p>Order today and schedule your delivery for the date you need.</p><div className="preorder-steps"><span><i>1</i>Choose Products</span><span><i>2</i>Select Date</span><span><i>3</i>Confirm Order</span></div></div><div className="preorder-hero-image"><img src="/fruit.jpg" alt="Fresh produce for a planned delivery" /></div></section><section className="page-container preorder-content"><div className="section-heading"><div><span className="eyebrow">POPULAR PRE-ORDER ITEMS</span><h2>Choose your fresh picks</h2></div></div>{loading ? <Loader /> : products.length ? <div className="preorder-product-grid">{products.slice(0, 6).map((product) => <button type="button" className={`preorder-product${productId === product._id ? ' selected' : ''}`} key={product._id} onClick={() => setProductId(product._id)}><img src={product.images?.[0] || '/fruit.jpg'} alt="" /><span><strong>{product.name}</strong><small>₹{product.price} / {product.unit}</small></span></button>)}</div> : <EmptyState title="No pre-order items yet" message="Products with pre-order availability will appear here." />}</section><section className="page-container preorder-booking"><form className="form-panel" onSubmit={submit}><span className="eyebrow">SCHEDULE YOUR DELIVERY</span><h2>Your delivery day</h2><label className="field"><span>Delivery date</span><input type="date" min={localDate(1)} required value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field"><span>Quantity {selected ? `(${selected.unit})` : ''}</span><QuantitySelector value={quantity} onChange={setQuantity} max={Math.max(1, selected?.stock || 99)} /></label>{!user && <p className="inline-hint">Sign in and add an address before confirming.</p>}{user && !user.addresses?.length && <p className="inline-hint">Add a delivery address in <Link to="/profile">your profile</Link>.</p>}{error && <div className="form-error">{error}</div>}<button className="button button-primary button-full" disabled={busy || loading || !selected || !user || !user.addresses?.length}>{busy ? 'Scheduling…' : 'Confirm Pre-Order'}<ArrowRight size={16} /></button></form>{user && <aside className="form-panel"><span className="eyebrow">ALREADY PLANNED</span><h2>Your scheduled pre-orders</h2>{orders.length ? orders.map((order) => <article className="preorder-row" key={order._id}><div><strong>{order.items.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</strong><small>Delivery {new Date(order.deliveryDate).toLocaleDateString()}</small><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus}</span></div>{order.orderStatus === 'placed' && <button className="icon-button remove-item" onClick={() => cancel(order._id)} aria-label="Cancel pre-order"><Trash2 size={16} /></button>}</article>) : <p className="muted-copy">Upcoming pre-orders will appear here.</p>}</aside>}</section></div>
}

export function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [requests, setRequests] = useState([])
  const [filter, setFilter] = useState('All')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { Promise.all([api.get('/orders'), api.get('/bulk-orders')]).then(([a,b]) => { setOrders(a.data.orders); setRequests(b.data.requests) }).catch((e) => setError(getApiError(e))).finally(() => setLoading(false)) }, [])
  const records = [...orders.filter((order) => filter === 'All' || (filter === 'Pre Orders' && order.orderType === 'preorder')).map((order) => ({ ...order, kind: 'order' })), ...(filter === 'All' || filter === 'Bulk Orders' ? requests.map((request) => ({ ...request, kind: 'bulk' })) : [])].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR JANAI HISTORY</span><h1>My Orders</h1></div></div><div className="segmented-control">{['All','Pre Orders','Bulk Orders'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>{loading ? <Loader /> : error ? <div className="inline-error">{error}</div> : records.length ? <div className="orders-grid">{records.map((record) => record.kind === 'order' ? <OrderCard key={record._id} order={record} /> : <article className="order-card" key={record._id}><div className="order-card-head"><span>Bulk request #{String(record._id).slice(-8).toUpperCase()}</span><span className={`status-pill status-${record.status.toLowerCase()}`}>{record.status}</span></div><p>{record.products.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</p><div className="order-card-foot"><span>Needed {new Date(record.requiredDate).toLocaleDateString()}</span><strong>{record.orderType}</strong></div></article>)}</div> : <EmptyState icon={Package} title="Your next order starts here" message="Orders and bulk requests will appear here." action="Browse shop" />}</section>
}

export function OrderDetailPage() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get(`/orders/${id}`).then(({ data }) => setOrder(data.order)).catch((e) => setError(getApiError(e))) }, [id])
  if (error) return <div className="page-container"><EmptyState title="Order not found" message={error} action="My orders" to="/orders" /></div>
  if (!order) return <Loader />
  return <section className="page-container content-page"><Link className="back-link" to="/orders"><ArrowLeft size={16} />My orders</Link><div className="page-title-row"><div><span className="eyebrow">ORDER #{String(order._id).slice(-8).toUpperCase()}</span><h1>Order details</h1></div><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus.replaceAll('_',' ')}</span></div><div className="order-detail-layout"><section className="form-panel"><h2>Items</h2>{order.items.map((item) => <div className="order-detail-item" key={item.name}><img src={item.image || '/fruit.jpg'} alt={item.name} /><span>{item.name}<small>{item.quantity} {item.unit} × ₹{item.price}</small></span><strong>₹{item.quantity * item.price}</strong></div>)}<div className="summary-total"><span>Total</span><strong>₹{order.totalAmount}</strong></div></section><aside className="form-panel"><h2>Delivery</h2><p><CalendarDays size={16} /> {new Date(order.deliveryDate).toLocaleDateString()}</p><p><MapPin size={16} /> {order.deliveryAddress.street}, {order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode}</p><p><CreditCard size={16} /> Cash on Delivery</p></aside></div></section>
}

export function ProfilePage() {
  const { user, logout, setUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState(blankAddress)
  const [error, setError] = useState('')
  async function saveAddress(event) {
    event.preventDefault(); setError('')
    try { const { data } = await api.post('/auth/addresses', address); setUser(data.user); setAdding(false); toast('Address saved.') } catch (e) { setError(getApiError(e)) }
  }
  async function removeAddress(id) {
    try { const { data } = await api.delete(`/auth/addresses/${id}`); setUser(data.user); toast('Address removed.') } catch (e) { toast(getApiError(e), 'error') }
  }
  function signOut() { logout(); navigate('/'); }
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR JANAI ACCOUNT</span><h1>My Profile</h1></div></div><div className="profile-layout"><aside className="profile-sidebar"><div className="profile-avatar">{user.firstName?.[0]}{user.lastName?.[0]}</div><h2>{user.firstName} {user.lastName}</h2><p>{user.email}</p><small>{user.phone}</small><nav><Link to="/orders">My Orders<ArrowRight size={15} /></Link><Link to="/pre-orders">Pre Orders<ArrowRight size={15} /></Link><Link to="/bulk-orders">Bulk Order Requests<ArrowRight size={15} /></Link><Link to="/checkout">Payment methods<ArrowRight size={15} /></Link><button onClick={signOut}>Logout<ArrowRight size={15} /></button></nav></aside><div className="profile-content"><section className="form-panel"><div className="panel-heading"><div><span className="eyebrow">DELIVERY DETAILS</span><h2>Saved Addresses</h2></div><button className="text-link" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Add address'}</button></div>{adding && <form className="form-grid" onSubmit={saveAddress}>{[['recipient','Name'],['phone','Phone'],['street','Street'],['city','City'],['state','State'],['postalCode','PIN code']].map(([key,label]) => <label className="field" key={key}><span>{label}</span><input required value={address[key]} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} /></label>)}{error && <div className="form-error field-wide">{error}</div>}<button className="button button-primary">Save address</button></form>}{user.addresses?.length ? user.addresses.map((item) => <article className="address-item" key={item._id}><MapPin size={17} /><span><strong>{item.label || 'Address'}{item.isDefault ? ' · Default' : ''}</strong><small>{item.recipient}, {item.street}, {item.city}, {item.state} {item.postalCode}</small></span><button className="icon-button" onClick={() => removeAddress(item._id)} aria-label="Remove address"><Trash2 size={15} /></button></article>) : !adding && <p className="muted-copy">No saved address yet.</p>}</section></div></div></section>
}
