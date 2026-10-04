import { useEffect, useState } from 'react'
import { ArrowRight, Building2, CheckCircle2, Package, Plus, Users, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { Loader } from '../components/UI'

const audiences = [
  { icon: Building2, title: 'Businesses & offices', text: 'Reliable pantry and team orders.' },
  { icon: Users, title: 'Events & parties', text: 'Fresh produce for your gathering.' },
  { icon: Package, title: 'Large families', text: 'Bigger baskets, made simple.' },
]
const orderTypes = ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other']
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export default function BulkOrdersPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [products, setProducts] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', email: '', organization: '', orderType: 'Business', products: [{ productId: '', quantity: 1 }], requiredDate: tomorrow(), deliveryAddress: '', additionalRequirements: '' })
  useEffect(() => {
    Promise.all([api.get('/products', { params: { bulk: true, limit: 100 } }), user ? api.get('/bulk-orders') : Promise.resolve({ data: { requests: [] } })])
      .then(([catalog, history]) => {
        setProducts(catalog.data.products)
        setRequests(history.data.requests)
        setForm((current) => ({ ...current, name: current.name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(), phone: current.phone || user?.phone || '', email: current.email || user?.email || '', products: current.products.map((item) => ({ ...item, productId: item.productId || catalog.data.products[0]?._id || '' })) }))
      })
      .catch((requestError) => setError(getApiError(requestError)))
      .finally(() => setLoading(false))
  }, [user?._id])
  function setField(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  function updateProduct(index, field, value) { setForm((current) => ({ ...current, products: current.products.map((item, position) => position === index ? { ...item, [field]: value } : item) })) }
  function addProduct() { setForm((current) => ({ ...current, products: [...current.products, { productId: products[0]?._id || '', quantity: 1 }] })) }
  function removeProduct(index) { setForm((current) => ({ ...current, products: current.products.filter((_, position) => position !== index) })) }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    const lines = form.products.map((item) => {
      const product = products.find((entry) => entry._id === item.productId)
      return { name: product?.name || '', quantity: Number(item.quantity), unit: product?.unit || 'kg' }
    })
    try {
      const { data } = await api.post('/bulk-orders', { ...form, products: lines })
      toast(data.message || 'Bulk order request submitted.')
      setForm((current) => ({ ...current, products: [{ productId: products[0]?._id || '', quantity: 1 }], additionalRequirements: '' }))
      if (user) { const { data: history } = await api.get('/bulk-orders'); setRequests(history.requests) }
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  return <div className="bulk-page"><section className="bulk-hero page-container"><div className="bulk-hero-copy"><span className="eyebrow">BIGGER PLANS, FRESHER BASKETS</span><h1>Bulk Orders<br /><span>for Businesses,<br />Events &amp; More</span></h1><p>Need groceries for your business, office, event or large gathering? Tell us what you need and our team will help plan your order.</p><a className="button button-primary" href="#bulk-request">Request Bulk Order<ArrowRight size={16} /></a></div><div className="bulk-hero-art"><img src="/grocery.jpg" alt="Fresh groceries for a bulk order" /><span className="bulk-art-caption"><CheckCircle2 size={18} /> Thoughtful local sourcing</span></div></section><section className="page-container bulk-audience"><div className="section-heading"><div><span className="eyebrow">IDEAL FOR</span><h2>One reliable source for more.</h2></div></div><div className="audience-grid">{audiences.map(({ icon: Icon, title, text }) => <article key={title}><span><Icon size={20} /></span><strong>{title}</strong><p>{text}</p></article>)}</div></section><section className="bulk-process-band"><div className="page-container bulk-process"><div><span className="eyebrow">HOW IT WORKS</span><h2>Share your list. We’ll take it from there.</h2></div><div className="process-steps"><span><i>1</i>Send your request</span><span><i>2</i>We review quantities</span><span><i>3</i>We follow up to confirm</span></div></div></section><section className="page-container bulk-request-section" id="bulk-request"><div className="bulk-form-intro"><span className="eyebrow">LET’S PLAN YOUR ORDER</span><h2>Request a bulk order</h2><p>Share the items, quantities and delivery date you have in mind. Submitting this form is a request, not a confirmed order.</p><div className="bulk-response-note"><Package size={19} /><span><strong>Every request is reviewed by Janai.</strong><br />We’ll follow up to confirm availability and pricing.</span></div>{!user && <p className="signed-in-note">Have an account? <Link to="/login">Sign in</Link> to see request history.</p>}</div><form className="bulk-form" onSubmit={submit}><div className="bulk-form-grid"><label className="field"><span>Name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} /></label><label className="field"><span>Phone</span><input required type="tel" value={form.phone} onChange={(event) => setField('phone', event.target.value)} /></label><label className="field"><span>Email</span><input required type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} /></label><label className="field"><span>Business / Organization</span><input value={form.organization} onChange={(event) => setField('organization', event.target.value)} /></label><label className="field"><span>Order type</span><select value={form.orderType} onChange={(event) => setField('orderType', event.target.value)}>{orderTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span>Required date</span><input required type="date" min={tomorrow()} value={form.requiredDate} onChange={(event) => setField('requiredDate', event.target.value)} /></label></div><div className="bulk-product-fields"><div className="bulk-form-subheading"><div><h3>Products and quantities</h3><p>Select from current bulk-available items.</p></div><button type="button" className="text-link" onClick={addProduct}><Plus size={15} /> Add product</button></div>{loading ? <Loader label="Loading bulk products" /> : form.products.map((item, index) => <div className="bulk-product-row" key={`bulk-${index}`}><label className="field"><span>Product</span><select required value={item.productId} onChange={(event) => updateProduct(index, 'productId', event.target.value)}><option value="">Choose product</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name} · ₹{product.price}/{product.unit}</option>)}</select></label><label className="field"><span>Quantity</span><input required type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateProduct(index, 'quantity', event.target.value)} /></label>{form.products.length > 1 && <button className="icon-button remove-item" type="button" aria-label="Remove product" onClick={() => removeProduct(index)}><X size={16} /></button>}</div>)}</div><label className="field"><span>Delivery address</span><textarea required rows="3" value={form.deliveryAddress} onChange={(event) => setField('deliveryAddress', event.target.value)} /></label><label className="field"><span>Additional requirements</span><textarea rows="3" maxLength="2000" value={form.additionalRequirements} onChange={(event) => setField('additionalRequirements', event.target.value)} /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || loading || !products.length}>{busy ? 'Submitting…' : 'Submit Bulk Order'}<ArrowRight size={16} /></button></form></section>{user && <section className="page-container page-section"><div className="section-heading"><div><span className="eyebrow">YOUR REQUESTS</span><h2>Bulk order history</h2></div></div>{requests.length ? <div className="bulk-history-list">{requests.map((request) => <article className="bulk-history-card" key={request._id}><div><strong>{request.organization || request.orderType}</strong><small>{request.products.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</small><small>Needed {new Date(request.requiredDate).toLocaleDateString()}</small></div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status}</span></article>)}</div> : <p className="muted-copy">Your bulk order requests will appear here.</p>}</section>}</div>
}
