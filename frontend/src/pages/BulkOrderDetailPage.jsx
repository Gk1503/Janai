import { useEffect, useState } from 'react'
import { ArrowLeft, MessageSquareText } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, formatPrice, Loader } from '../components/UI'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// A customer's own bulk-order request: status, the business's quotation and response, and cancellation
// while the request is still eligible. The backend only ever returns requests owned by the signed-in account.
export default function BulkOrderDetailPage() {
  const { id } = useParams()
  const toast = useToast()
  const [request, setRequest] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/bulk-orders/${id}`).then(({ data }) => setRequest(data.request)).catch((requestError) => setError(getApiError(requestError)))
  }, [id])

  async function cancel() {
    if (!window.confirm('Cancel this bulk order request?')) return
    setBusy(true)
    try {
      const { data } = await api.put(`/bulk-orders/${id}/cancel`)
      setRequest(data.request)
      toast(data.message || 'Bulk order request cancelled.')
    } catch (requestError) { toast(getApiError(requestError), 'error') } finally { setBusy(false) }
  }

  if (error) return <div className="page-container"><EmptyState title="Request not found" message={error} action="My orders" to="/orders" /></div>
  if (!request) return <Loader />
  const quote = request.quotation

  return <section className="page-container content-page">
    <Link className="text-link back-link" to="/orders"><ArrowLeft size={16} />My orders</Link>
    <div className="page-title-row"><div><span className="eyebrow">BULK REQUEST #{String(request._id).slice(-8).toUpperCase()}</span><h1>Bulk order details</h1></div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status}</span></div>
    <div className="order-detail-layout">
      <section className="form-panel">
        <h2>Requested products</h2>
        {request.products.map((item, index) => <div className="order-detail-item" key={`${item.name}-${index}`}><span>{item.name}<small>Quantity: {item.quantity} {item.unit}</small></span></div>)}
        {request.additionalRequirements && <p className="muted-copy"><strong>Notes:</strong> {request.additionalRequirements}</p>}
      </section>
      <aside className="summary-panel">
        <h2>Request</h2>
        <div><span>Type</span><strong>{request.orderType}</strong></div>
        <div><span>Needed by</span><strong>{formatDate(request.requiredDate)}</strong></div>
        <div><span>Submitted</span><strong>{formatDate(request.createdAt)}</strong></div>
        <p className="muted-copy">{request.deliveryAddress}</p>
        {request.canCancel && <button type="button" className="button button-full" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel request'}</button>}
      </aside>
    </div>
    {request.adminResponse && <section className="form-panel bulk-response"><h2><MessageSquareText size={18} /> Message from Janai</h2><p>{request.adminResponse.message}</p></section>}
    {quote ? <section className="form-panel bulk-quote">
      <h2>Quotation</h2>
      {quote.items.map((item, index) => <div className="order-detail-item" key={`${item.name}-${index}`}><span>{item.name}<small>{item.quantity} {item.unit} × {formatPrice(item.unitPrice)}</small></span><strong>{formatPrice(item.lineTotal)}</strong></div>)}
      <div className="summary-panel summary-inline">
        <div><span>Delivery charge</span><strong>{formatPrice(quote.deliveryCharge)}</strong></div>
        <div className="summary-total"><span>Total</span><strong>{formatPrice(quote.totalAmount)}</strong></div>
      </div>
      {quote.validUntil && <p className="muted-copy">Valid until {formatDate(quote.validUntil)}.</p>}
      {quote.message && <p>{quote.message}</p>}
    </section> : request.status !== 'Cancelled' && request.status !== 'Rejected' && <p className="muted-copy">Our team is reviewing your request. A quotation will appear here once it is ready.</p>}
  </section>
}
