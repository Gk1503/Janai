import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock, CreditCard, MapPin, MessageSquareText, Package, Phone, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useCart, useToast } from '../context/AppContexts'
import { AddressFields, AddressPicker, Field, TimeSlotField, useDeliveryAddress } from '../components/Forms'
import { deliveryFeeFor, EmptyState, formatPrice, FREE_DELIVERY_MIN, Loader, OrderCard, ProductImage, QuantitySelector } from '../components/UI'
import { blankAddress, formatAddress, hasErrors, localDate, validateAddress, validateFutureDate } from '../utils/validation'

const formatDate = (value) => new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function PriceSummary({ subtotal, children }) {
  const fee = deliveryFeeFor(subtotal)
  return <>
    <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
    <div><span>Delivery fee</span><strong>{fee ? formatPrice(fee) : 'Free'}</strong></div>
    {fee > 0 && <p className="summary-hint">Add {formatPrice(FREE_DELIVERY_MIN - subtotal)} more for free delivery.</p>}
    <div className="summary-total"><span>Total Amount</span><strong>{formatPrice(subtotal + fee)}</strong></div>
    {children}
  </>
}

export function CartPage() {
  const { user } = useAuth()
  const { items, total, cartLoading, setQuantity, removeItem } = useCart()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!user) return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR BASKET</span><h1>My Cart</h1></div></div><EmptyState icon={ShoppingBag} title="Sign in to see your cart" message="Your basket is linked to your Janai account." action="Sign in" to="/login" /></section>
  async function remove(productId) { setBusy(true); try { await removeItem(productId); toast('Item removed from cart.') } catch (error) { toast(getApiError(error), 'error') } finally { setBusy(false) } }
  async function quantity(productId, value) { setBusy(true); try { await setQuantity(productId, value) } catch (error) { toast(getApiError(error), 'error') } finally { setBusy(false) } }
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR BASKET</span><h1>My Cart <small>{items.length}</small></h1><p>A little freshness is on its way.</p></div><Link className="text-link" to="/shop"><ArrowLeft size={15} /> Continue shopping</Link></div>{cartLoading ? <Loader label="Loading your basket" /> : !items.length ? <EmptyState icon={ShoppingBag} title="Your cart is empty" message="Add fresh picks from the shop and they’ll appear here." action="Find fresh picks" /> : <div className="cart-layout"><div className="cart-lines">{items.filter((item) => item.product).map(({ product, quantity: amount }) => <article className="cart-line" key={product._id}><Link to={`/product/${product._id}`} className="cart-line-image"><ProductImage product={product} /></Link><div className="cart-line-details"><Link to={`/product/${product._id}`}><strong>{product.name}</strong></Link><span>{formatPrice(product.price)} / {product.unit}</span><div className="cart-line-bottom"><QuantitySelector value={amount} onChange={(value) => quantity(product._id, value)} max={Math.max(1, product.stock)} compact /><strong>{formatPrice(product.price * amount)}</strong></div></div><button type="button" className="icon-button remove-item" aria-label={`Remove ${product.name}`} disabled={busy} onClick={() => remove(product._id)}><Trash2 size={17} /></button></article>)}<div className="delivery-note"><Truck size={18} /><span>{total >= FREE_DELIVERY_MIN ? 'Free delivery unlocked.' : `Add ${formatPrice(FREE_DELIVERY_MIN - total)} more for free delivery.`}</span><Link to="/shop">Add more</Link></div></div><aside className="summary-panel"><h2>Order summary</h2><PriceSummary subtotal={total}><Link className="button button-primary button-full" to="/checkout">Proceed to Checkout<ArrowRight size={16} /></Link></PriceSummary></aside></div>}</section>
}

export function CheckoutPage() {
  const { items, total, clearCart } = useCart()
  const toast = useToast()
  const navigate = useNavigate()
  const address = useDeliveryAddress()
  const [deliveryDate, setDeliveryDate] = useState(localDate())
  const [timeSlot, setTimeSlot] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dateError, setDateError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function placeOrder(event) {
    event.preventDefault(); setError('')
    const nextDateError = validateFutureDate(deliveryDate, { minOffset: 0 })
    setDateError(nextDateError)
    if (!address.validate() || nextDateError) { setError('Please fix the highlighted fields.'); return }
    setBusy(true)
    try {
      const deliveryAddress = await address.commit()
      const { data } = await api.post('/orders', { items: items.map(({ product, quantity }) => ({ productId: product._id, quantity })), deliveryAddress, deliveryDate, preferredTimeSlot: timeSlot, deliveryInstructions: instructions.trim(), paymentMethod: 'cod' })
      await clearCart(); toast(data.message || 'Order placed successfully.'); navigate(`/orders/${data.order._id}`)
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  if (!items.length) return <section className="page-container content-page"><EmptyState icon={ShoppingBag} title="Your cart is empty" message="Choose a few fresh picks before checkout." action="Browse shop" /></section>
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">ALMOST THERE</span><h1>Checkout</h1><p>Delivery, payment, and then your fresh picks are on their way.</p></div></div><form className="checkout-layout" onSubmit={placeOrder} noValidate><div className="checkout-main"><section className="form-panel"><h2><MapPin size={18} /> Delivery address</h2><AddressPicker state={address} /></section><section className="form-panel"><h2><CalendarDays size={18} /> Delivery schedule</h2><div className="form-grid"><Field label="Delivery Date" required error={dateError}><input className="date-input" type="date" min={localDate()} value={deliveryDate} onChange={(event) => { setDeliveryDate(event.target.value); setDateError('') }} /></Field><TimeSlotField value={timeSlot} onChange={setTimeSlot} /><Field label="Delivery Instructions" optional wide><textarea rows="2" maxLength="300" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="e.g. Ring the bell, leave with security" /></Field></div></section><section className="form-panel"><h2><CreditCard size={18} /> Payment</h2><label className="payment-choice"><input type="radio" checked readOnly /><span><strong>Cash on Delivery</strong><small>Pay when your order arrives. Online payments are coming soon.</small></span></label></section></div><aside className="summary-panel"><h2>Order summary</h2>{items.map(({ product, quantity }) => <div key={product._id}><span>{product.name} × {quantity}</span><strong>{formatPrice(product.price * quantity)}</strong></div>)}<PriceSummary subtotal={total}>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Placing order…' : 'Place Order'}<ArrowRight size={16} /></button></PriceSummary></aside></form></section>
}

export function PreOrdersPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  // { productId: quantity } — the pre-order basket. A ?product= link from a product page starts it off.
  const [basket, setBasket] = useState(() => { const id = searchParams.get('product'); return id ? { [id]: 1 } : {} })
  const [step, setStep] = useState('select')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() {
    try {
      const responses = await Promise.all([api.get('/products', { params: { preOrder: true, limit: 100 } }), user ? api.get('/preorders') : Promise.resolve({ data: { orders: [] } })])
      setProducts(responses[0].data.products); setOrders(responses[1].data.orders); setError('')
    } catch (requestError) { setError(getApiError(requestError)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user?._id])
  const lines = products.filter((product) => basket[product._id]).map((product) => ({ product, quantity: basket[product._id], subtotal: product.price * basket[product._id] }))
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
  const itemCount = lines.length
  function setQuantity(productId, quantity) {
    setBasket((current) => { const next = { ...current }; if (quantity > 0) next[productId] = quantity; else delete next[productId]; return next })
  }
  function goTo(nextStep) { setStep(nextStep); window.scrollTo({ top: 0, behavior: 'instant' }) }
  function continueToConfirm() {
    if (!user) { navigate('/login', { state: { from: '/pre-orders' } }); return }
    goTo('confirm')
  }
  async function cancel(id) {
    try { await api.put(`/preorders/${id}/cancel`); toast('Pre-order cancelled.'); await load() } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  async function placed(order) {
    setBasket({}); goTo('select'); toast('Pre-order confirmed.'); navigate(`/orders/${order._id}`)
  }

  if (step === 'confirm' && user && lines.length) return <ConfirmPreOrder lines={lines} subtotal={subtotal} onBack={() => goTo('select')} onPlaced={placed} />

  const summary = <aside className="summary-panel preorder-summary" id="preorder-summary"><h2><ShoppingBag size={18} /> Your pre-order</h2>{lines.length ? <><ul className="preorder-lines">{lines.map(({ product, quantity, subtotal: lineTotal }) => <li key={product._id}><ProductImage product={product} /><span className="preorder-line-copy"><strong>{product.name}</strong><small>Quantity: {quantity} {product.unit}</small><small>{formatPrice(product.price)} / {product.unit}</small></span><span className="preorder-line-total"><small>Subtotal</small><strong>{formatPrice(lineTotal)}</strong></span></li>)}</ul><PriceSummary subtotal={subtotal}><button type="button" className="button button-primary button-full" onClick={continueToConfirm}>{user ? 'Continue to Confirm' : 'Sign in to Continue'}<ArrowRight size={16} /></button></PriceSummary></> : <p className="muted-copy">Add products from the list to start your pre-order. Prices and totals appear here.</p>}</aside>

  return <div className="preorder-page"><section className="preorder-hero page-container"><div><span className="eyebrow">A LITTLE PLANNING, A LOT OF FRESH</span><h1>Plan Ahead,<br /><span>Stay Fresh</span></h1><p>Order today and schedule your delivery for the date you need.</p><div className="preorder-steps"><span className="done"><i>1</i>Choose Products</span><span><i>2</i>Select Date</span><span><i>3</i>Confirm Order</span></div></div><div className="preorder-hero-image"><img src="/fruit.jpg" alt="Fresh produce for a planned delivery" /></div></section>
    <section className="page-container preorder-layout"><div className="preorder-products"><div className="section-heading"><div><span className="eyebrow">STEP 1 · PRE-ORDER ITEMS</span><h2>Choose your fresh picks</h2></div></div>{loading ? <Loader /> : error ? <div className="inline-error">{error}</div> : products.length ? <div className="preorder-product-grid">{products.map((product) => <article className={`preorder-product${basket[product._id] ? ' selected' : ''}`} key={product._id}><ProductImage product={product} /><span className="preorder-product-copy"><strong>{product.name}</strong><small>{formatPrice(product.price)} / {product.unit}</small></span>{basket[product._id] ? <QuantitySelector compact min={0} value={basket[product._id]} onChange={(value) => setQuantity(product._id, value)} label={`${product.name} quantity`} /> : <button type="button" className="button button-outline preorder-add" onClick={() => setQuantity(product._id, 1)} aria-label={`Add ${product.name} to pre-order`}><Plus size={15} />Add</button>}</article>)}</div> : <EmptyState title="No pre-order items yet" message="Products with pre-order availability will appear here." />}</div>{summary}</section>
    {itemCount > 0 && <div className="mobile-checkout-bar"><span><small>{itemCount} {itemCount === 1 ? 'item' : 'items'} · Total</small><strong>{formatPrice(subtotal + deliveryFeeFor(subtotal))}</strong></span><button type="button" className="button button-primary" onClick={continueToConfirm}>{user ? 'Continue' : 'Sign in'}<ArrowRight size={16} /></button></div>}
    {user && <section className="page-container preorder-history"><div className="form-panel"><span className="eyebrow">ALREADY PLANNED</span><h2>Your scheduled pre-orders</h2>{orders.length ? orders.map((order) => <article className="preorder-row" key={order._id}><Link to={`/orders/${order._id}`}><strong>{order.items.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</strong><small>Delivery {formatDate(order.deliveryDate)}{order.preferredTimeSlot ? ` · ${order.preferredTimeSlot}` : ''} · {formatPrice(order.totalAmount)}</small><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus.replaceAll('_', ' ')}</span></Link>{order.orderStatus === 'placed' && <button className="icon-button remove-item" onClick={() => cancel(order._id)} aria-label="Cancel pre-order"><Trash2 size={17} /></button>}</article>) : <p className="muted-copy">Upcoming pre-orders will appear here.</p>}</div></section>}
  </div>
}

function ConfirmPreOrder({ lines, subtotal, onBack, onPlaced }) {
  const address = useDeliveryAddress()
  const [date, setDate] = useState(localDate(1))
  const [timeSlot, setTimeSlot] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dateError, setDateError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fee = deliveryFeeFor(subtotal)
  async function submit(event) {
    event.preventDefault(); setError('')
    const nextDateError = validateFutureDate(date, { minOffset: 1 })
    setDateError(nextDateError)
    if (!address.validate() || nextDateError) { setError('Please fix the highlighted fields.'); return }
    setBusy(true)
    try {
      const deliveryAddress = await address.commit()
      const { data } = await api.post('/preorders', { items: lines.map(({ product, quantity }) => ({ productId: product._id, quantity })), deliveryDate: date, deliveryAddress, preferredTimeSlot: timeSlot, deliveryInstructions: instructions.trim(), paymentMethod: 'cod' })
      onPlaced(data.order)
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  return <section className="page-container content-page confirm-preorder"><button type="button" className="text-link back-link" onClick={onBack}><ArrowLeft size={16} />Edit pre-order items</button><div className="page-title-row"><div><span className="eyebrow">FINAL STEP</span><h1>Confirm Your Pre-Order</h1><p>Review your items, choose a delivery day and confirm.</p></div></div>
    <form className="checkout-layout" onSubmit={submit} noValidate><div className="checkout-main">
      <section className="form-panel"><h2><CalendarDays size={18} /> Delivery schedule</h2><div className="form-grid"><Field label="Delivery Date" required error={dateError} hint="Pre-orders can be delivered from tomorrow onwards."><input className="date-input" type="date" min={localDate(1)} value={date} onChange={(event) => { setDate(event.target.value); setDateError('') }} /></Field><TimeSlotField value={timeSlot} onChange={setTimeSlot} /></div></section>
      <section className="form-panel"><h2><MapPin size={18} /> Delivery address</h2><AddressPicker state={address} /></section>
      <section className="form-panel"><h2><MessageSquareText size={18} /> Delivery instructions</h2><Field label="Instructions for the delivery partner" optional><textarea rows="2" maxLength="300" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="e.g. Call before arriving, leave at the gate" /></Field><label className="payment-choice"><input type="radio" checked readOnly /><span><strong>Cash on Delivery</strong><small>Pay when your pre-order arrives.</small></span></label></section>
    </div>
    <aside className="summary-panel confirm-summary"><h2>Pre-order summary</h2>
      <dl className="confirm-details"><div><dt><CalendarDays size={15} />Delivery Date</dt><dd>{date && !dateError ? formatDate(date) : 'Choose a date'}</dd></div><div><dt><Clock size={15} />Preferred Time</dt><dd>{timeSlot || 'Any time (optional)'}</dd></div><div><dt><MapPin size={15} />Delivery Address</dt><dd>{address.summary || 'Add your address'}</dd></div></dl>
      <ul className="preorder-lines">{lines.map(({ product, quantity, subtotal: lineTotal }) => <li key={product._id}><ProductImage product={product} /><span className="preorder-line-copy"><strong>{product.name}</strong><small>Quantity: {quantity} {product.unit}</small><small>{formatPrice(product.price)} / {product.unit}</small></span><span className="preorder-line-total"><small>Subtotal</small><strong>{formatPrice(lineTotal)}</strong></span></li>)}</ul>
      <PriceSummary subtotal={subtotal}>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Confirming…' : `Confirm Pre-Order · ${formatPrice(subtotal + fee)}`}<CheckCircle2 size={17} /></button></PriceSummary>
    </aside></form></section>
}

export function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [requests, setRequests] = useState([])
  const [filter, setFilter] = useState('All')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { Promise.all([api.get('/orders'), api.get('/bulk-orders')]).then(([a,b]) => { setOrders(a.data.orders); setRequests(b.data.requests) }).catch((e) => setError(getApiError(e))).finally(() => setLoading(false)) }, [])
  const records = [...orders.filter((order) => filter === 'All' || (filter === 'Pre Orders' && order.orderType === 'preorder')).map((order) => ({ ...order, kind: 'order' })), ...(filter === 'All' || filter === 'Bulk Orders' ? requests.map((request) => ({ ...request, kind: 'bulk' })) : [])].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR JANAI HISTORY</span><h1>My Orders</h1></div></div><div className="segmented-control">{['All','Pre Orders','Bulk Orders'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>{loading ? <Loader /> : error ? <div className="inline-error">{error}</div> : records.length ? <div className="orders-grid">{records.map((record) => record.kind === 'order' ? <OrderCard key={record._id} order={record} /> : <article className="order-card" key={record._id}><div className="order-card-head"><span>Bulk request #{String(record._id).slice(-8).toUpperCase()}</span><span className={`status-pill status-${record.status.toLowerCase()}`}>{record.status}</span></div><p className="order-card-text">{record.products.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</p><div className="order-card-foot"><span>Needed {new Date(record.requiredDate).toLocaleDateString('en-IN')}</span><strong>{record.orderType}</strong></div></article>)}</div> : <EmptyState icon={Package} title="Your next order starts here" message="Orders and bulk requests will appear here." action="Browse shop" />}</section>
}

export function OrderDetailPage() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get(`/orders/${id}`).then(({ data }) => setOrder(data.order)).catch((e) => setError(getApiError(e))) }, [id])
  if (error) return <div className="page-container"><EmptyState title="Order not found" message={error} action="My orders" to="/orders" /></div>
  if (!order) return <Loader />
  const itemsTotal = order.items.reduce((sum, item) => sum + item.quantity * item.price, 0)
  const fee = Math.max(0, order.totalAmount - itemsTotal)
  return <section className="page-container content-page"><Link className="text-link back-link" to="/orders"><ArrowLeft size={16} />My orders</Link><div className="page-title-row"><div><span className="eyebrow">{order.orderType === 'preorder' ? 'PRE-ORDER' : 'ORDER'} #{String(order._id).slice(-8).toUpperCase()}</span><h1>Order details</h1></div><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus.replaceAll('_',' ')}</span></div><div className="order-detail-layout"><section className="form-panel"><h2>Items</h2>{order.items.map((item) => <div className="order-detail-item" key={item.name}><ProductImage product={item} alt={item.name} /><span>{item.name}<small>Quantity: {item.quantity} {item.unit} × {formatPrice(item.price)}</small></span><strong>{formatPrice(item.quantity * item.price)}</strong></div>)}<div className="summary-panel summary-inline"><div><span>Subtotal</span><strong>{formatPrice(itemsTotal)}</strong></div><div><span>Delivery fee</span><strong>{fee ? formatPrice(fee) : 'Free'}</strong></div><div className="summary-total"><span>Total</span><strong>{formatPrice(order.totalAmount)}</strong></div></div></section><aside className="form-panel delivery-details"><h2>Delivery</h2><p><CalendarDays size={16} /><span>{formatDate(order.deliveryDate)}</span></p>{order.preferredTimeSlot && <p><Clock size={16} /><span>{order.preferredTimeSlot}</span></p>}<p><MapPin size={16} /><span><strong>{order.deliveryAddress.recipient}</strong><br />{formatAddress(order.deliveryAddress)}</span></p>{order.deliveryAddress.phone && <p><Phone size={16} /><span>+91 {order.deliveryAddress.phone}</span></p>}{order.deliveryInstructions && <p><MessageSquareText size={16} /><span>{order.deliveryInstructions}</span></p>}<p><CreditCard size={16} /><span>Cash on Delivery</span></p></aside></div></section>
}

export function ProfilePage() {
  const { user, logout, setUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState(() => ({ ...blankAddress, recipient: `${user.firstName || ''} ${user.lastName || ''}`.trim(), phone: String(user.phone || '').replace(/\D/g, '').slice(-10) }))
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  async function saveAddress(event) {
    event.preventDefault(); setError('')
    const nextErrors = validateAddress(address)
    setErrors(nextErrors)
    if (hasErrors(nextErrors)) return
    try { const { data } = await api.post('/auth/addresses', { ...address, label: 'Home' }); setUser(data.user); setAdding(false); setAddress({ ...blankAddress }); toast('Address saved.') } catch (e) { setError(getApiError(e)) }
  }
  async function removeAddress(id) {
    try { const { data } = await api.delete(`/auth/addresses/${id}`); setUser(data.user); toast('Address removed.') } catch (e) { toast(getApiError(e), 'error') }
  }
  function signOut() { logout(); navigate('/'); }
  return <section className="page-container content-page"><div className="page-title-row"><div><span className="eyebrow">YOUR JANAI ACCOUNT</span><h1>My Profile</h1></div></div><div className="profile-layout"><aside className="profile-sidebar"><div className="profile-avatar">{user.firstName?.[0]}{user.lastName?.[0]}</div><h2>{user.firstName} {user.lastName}</h2><p>{user.email}</p><small>{user.phone}</small><nav><Link to="/orders">My Orders<ArrowRight size={15} /></Link><Link to="/pre-orders">Pre Orders<ArrowRight size={15} /></Link><Link to="/bulk-orders">Bulk Order Requests<ArrowRight size={15} /></Link><Link to="/checkout">Payment methods<ArrowRight size={15} /></Link><button onClick={signOut}>Logout<ArrowRight size={15} /></button></nav></aside><div className="profile-content"><section className="form-panel"><div className="panel-heading"><div><span className="eyebrow">DELIVERY DETAILS</span><h2>Saved Addresses</h2></div><button className="text-link" onClick={() => { setAdding(!adding); setErrors({}) }}>{adding ? 'Cancel' : '+ Add address'}</button></div>{adding && <form className="address-form" onSubmit={saveAddress} noValidate><AddressFields value={address} onChange={setAddress} errors={errors} />{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary">Save address</button></form>}{user.addresses?.length ? user.addresses.map((item) => <article className="address-item" key={item._id}><MapPin size={17} /><span><strong>{item.recipient || item.label || 'Address'}{item.isDefault ? ' · Default' : ''}</strong><small>{formatAddress(item)}</small>{item.phone && <small>+91 {item.phone}</small>}</span><button className="icon-button" onClick={() => removeAddress(item._id)} aria-label="Remove address"><Trash2 size={16} /></button></article>) : !adding && <p className="muted-copy">No saved address yet.</p>}</section></div></div></section>
}
