import { useEffect, useState } from 'react'
import { ArrowRight, Building2, CheckCircle2, Package, Plus, ShoppingBag, Users, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { AddressFields, Field } from '../components/Forms'
import { formatPrice, Loader, ProductImage } from '../components/UI'
import { blankAddress, digitsOnly, formatAddress, hasErrors, localDate, mobileDigits, validateAddress, validateEmail, validateFutureDate, validateQuantity } from '../utils/validation'

const audiences = [
  { icon: Building2, title: 'Businesses & offices', text: 'Reliable pantry and team orders.' },
  { icon: Users, title: 'Events & parties', text: 'Fresh produce for your gathering.' },
  { icon: Package, title: 'Large families', text: 'Bigger baskets, made simple.' },
]
// Must match the BulkOrder model enum.
const orderTypes = ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other']
const DRAFT_KEY = 'janai_bulk_draft'
const MAX_BULK_QUANTITY = 10000

function readDraft() {
  try { const rows = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '[]'); return Array.isArray(rows) && rows.length ? rows : null } catch { return null }
}

export default function BulkOrdersPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const [address, setAddress] = useState({ ...blankAddress })
  const [form, setForm] = useState({ email: '', organization: '', orderType: 'Business', requiredDate: localDate(1), additionalRequirements: '' })
  const [rows, setRows] = useState(() => readDraft() || [{ productId: '', quantity: '1' }])

  useEffect(() => {
    Promise.all([api.get('/products', { params: { bulk: true, limit: 100 } }), user ? api.get('/bulk-orders') : Promise.resolve({ data: { requests: [] } })])
      .then(([catalog, history]) => {
        setProducts(catalog.data.products)
        setRequests(history.data.requests)
        setAddress((current) => ({ ...current, recipient: current.recipient || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(), phone: current.phone || mobileDigits(user?.phone) }))
        setForm((current) => ({ ...current, email: current.email || user?.email || '' }))
      })
      .catch((requestError) => setError(getApiError(requestError)))
      .finally(() => setLoading(false))
  }, [user?._id])

  // A product page links here with ?product=<id>; add it to the request once the catalog is known.
  const linkedProduct = searchParams.get('product')
  useEffect(() => {
    if (!linkedProduct || !products.length) return
    if (products.some((product) => product._id === linkedProduct)) {
      setRows((current) => current.some((row) => row.productId === linkedProduct) ? current : [...current.filter((row) => row.productId), { productId: linkedProduct, quantity: '1' }])
    }
    const next = new URLSearchParams(searchParams)
    next.delete('product')
    setSearchParams(next, { replace: true })
  }, [linkedProduct, products])

  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rows)) } catch { /* storage unavailable */ } }, [rows])

  function setField(field, value) { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: '' })) }
  function updateRow(index, field, value) { setRows((current) => current.map((item, position) => position === index ? { ...item, [field]: value } : item)); setErrors((current) => ({ ...current, [`row${index}`]: '' })) }
  function addRow() { setRows((current) => [...current, { productId: '', quantity: '1' }]) }
  function removeRow(index) { setRows((current) => current.filter((_, position) => position !== index)) }

  function validate() {
    const next = { ...validateAddress(address), email: validateEmail(form.email), requiredDate: validateFutureDate(form.requiredDate, { minOffset: 1 }) }
    const seen = new Set()
    rows.forEach((row, index) => {
      const message = !row.productId ? 'Choose a product.' : seen.has(row.productId) ? 'This product is already in your list.' : validateQuantity(row.quantity, { min: 1, max: MAX_BULK_QUANTITY })
      if (message) next[`row${index}`] = message
      seen.add(row.productId)
    })
    setErrors(next)
    return !hasErrors(next)
  }

  async function submit(event) {
    event.preventDefault(); setError('')
    if (!validate()) { setError('Please fix the highlighted fields.'); return }
    setBusy(true)
    const lines = rows.map((item) => {
      const product = products.find((entry) => entry._id === item.productId)
      return { name: product?.name || '', quantity: Number(item.quantity), unit: product?.unit || 'kg' }
    })
    try {
      const { data } = await api.post('/bulk-orders', { ...form, name: address.recipient.trim(), phone: address.phone, organization: form.organization.trim(), deliveryAddress: formatAddress(address), products: lines })
      toast(data.message || 'Bulk order request submitted.')
      setRows([{ productId: '', quantity: '1' }])
      setForm((current) => ({ ...current, additionalRequirements: '' }))
      if (user) { const { data: history } = await api.get('/bulk-orders'); setRequests(history.requests) }
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  const contactExtra = <><Field label="Business / Organization Name" optional><input autoComplete="organization" value={form.organization} onChange={(event) => setField('organization', event.target.value)} placeholder="e.g. Sunrise Cafe" /></Field><Field label="Email" required error={errors.email}><input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(event) => setField('email', event.target.value.trim())} placeholder="you@example.com" /></Field></>

  return <div className="bulk-page"><section className="bulk-hero page-container"><div className="bulk-hero-copy"><span className="eyebrow">BIGGER PLANS, FRESHER BASKETS</span><h1>Bulk Orders<br /><span>for Businesses,<br />Events &amp; More</span></h1><p>Need groceries for your business, office, event or large gathering? Tell us what you need and our team will help plan your order.</p><a className="button button-primary" href="#bulk-request">Request Bulk Order<ArrowRight size={16} /></a></div><div className="bulk-hero-art"><img src="/grocery.jpg" alt="Fresh groceries for a bulk order" /><span className="bulk-art-caption"><CheckCircle2 size={18} /> Thoughtful local sourcing</span></div></section><section className="page-container bulk-audience"><div className="section-heading"><div><span className="eyebrow">IDEAL FOR</span><h2>One reliable source for more.</h2></div></div><div className="audience-grid">{audiences.map(({ icon: Icon, title, text }) => <article key={title}><span><Icon size={20} /></span><strong>{title}</strong><p>{text}</p></article>)}</div></section><section className="bulk-process-band"><div className="page-container bulk-process"><div><span className="eyebrow">HOW IT WORKS</span><h2>Share your list. We’ll take it from there.</h2></div><div className="process-steps"><span><i>1</i>Send your request</span><span><i>2</i>We review quantities</span><span><i>3</i>We follow up to confirm</span></div></div></section>
    <section className="page-container bulk-request-section" id="bulk-request"><div className="bulk-form-intro"><span className="eyebrow">LET’S PLAN YOUR ORDER</span><h2>Request a bulk order</h2><p>Share the items, quantities and delivery date you have in mind. Submitting this form is a request, not a confirmed order.</p><div className="bulk-response-note"><Package size={19} /><span><strong>Every request is reviewed by Janai.</strong><br />We’ll follow up to confirm availability and pricing.</span></div>{!user && <p className="signed-in-note">Have an account? <Link to="/login" state={{ from: '/bulk-orders' }}>Sign in</Link> to see request history.</p>}</div>
      <form className="bulk-form" onSubmit={submit} noValidate>
        <div className="bulk-product-fields"><div className="bulk-form-subheading"><div><h3>Products and quantities</h3><p>Choose from bulk-available items.</p></div><Link className="text-link" to="/shop?bulk=true"><ShoppingBag size={15} /> Add Product</Link></div>
          {loading ? <Loader label="Loading bulk products" /> : rows.map((item, index) => { const product = products.find((entry) => entry._id === item.productId); return <div className={`bulk-product-row${errors[`row${index}`] ? ' has-error' : ''}`} key={`bulk-${index}`}><span className="bulk-product-thumb">{product ? <ProductImage product={product} /> : <Package size={20} />}</span><Field label="Product" required className="bulk-field-product"><select value={item.productId} onChange={(event) => updateRow(index, 'productId', event.target.value)}><option value="">Choose a product</option>{products.map((option) => <option key={option._id} value={option._id}>{option.name} · {formatPrice(option.price)}/{option.unit}</option>)}</select></Field><Field label={`Qty${product ? ` (${product.unit})` : ''}`} required className="bulk-field-qty"><input type="text" inputMode="numeric" pattern="[0-9]*" value={item.quantity} onChange={(event) => updateRow(index, 'quantity', digitsOnly(event.target.value, 5))} aria-label={`Quantity for ${product?.name || 'product'}`} /></Field>{rows.length > 1 && <button className="icon-button remove-item" type="button" aria-label="Remove product" onClick={() => removeRow(index)}><X size={17} /></button> }{errors[`row${index}`] && <small className="field-error bulk-row-error" role="alert">{errors[`row${index}`]}</small>}</div> })}
          {!loading && products.length > 0 && <button type="button" className="add-row-button" onClick={addRow}><Plus size={15} />Add another item</button>}
        </div>
        <div className="form-section"><h3>Order details</h3><div className="form-grid"><Field label="Order Type" required><select value={form.orderType} onChange={(event) => setField('orderType', event.target.value)}>{orderTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field><Field label="Required Date" required error={errors.requiredDate}><input className="date-input" type="date" min={localDate(1)} value={form.requiredDate} onChange={(event) => setField('requiredDate', event.target.value)} /></Field></div></div>
        <div className="form-section"><h3>Contact &amp; delivery address</h3><AddressFields value={address} onChange={(next) => { setAddress(next); setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => next[key] === address[key]))) }} errors={errors} extra={contactExtra} /></div>
        <Field label="Additional Requirements" optional><textarea rows="3" maxLength="2000" value={form.additionalRequirements} onChange={(event) => setField('additionalRequirements', event.target.value)} placeholder="Packaging, delivery window, budget or anything else we should know" /></Field>
        {error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || loading || !products.length}>{busy ? 'Submitting…' : 'Submit Bulk Order Request'}<ArrowRight size={16} /></button></form></section>
    {user && <section className="page-container page-section bulk-history"><div className="section-heading"><div><span className="eyebrow">YOUR REQUESTS</span><h2>Bulk order history</h2></div></div>{requests.length ? <div className="bulk-history-list">{requests.map((request) => <article className="bulk-history-card" key={request._id}><div><strong>{request.organization || request.orderType}</strong><small>{request.products.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</small><small>Needed {new Date(request.requiredDate).toLocaleDateString('en-IN')}</small></div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status}</span></article>)}</div> : <p className="muted-copy">Your bulk order requests will appear here.</p>}</section>}</div>
}
