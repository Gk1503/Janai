import { useState } from 'react'
import { ArrowRight, Heart, Minus, PackageCheck, Plus, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth, useCart, useToast } from '../context/AppContexts'

const categoryImages = { Fruits: '/fruit.jpg', Vegetables: '/Vegatables.png', Groceries: '/grocery.jpg', 'Combo Packs': '/grocery.jpg', 'Seasonal Specials': '/fruit.jpg' }
const fallbackImage = (product = {}) => categoryImages[product.category] || '/fruit.jpg'

// Accepts local paths (/apple.jpg), bare file names (apple.jpg) and full http(s) URLs saved from the admin panel.
export function productImage(product = {}) {
  const image = String(product.images?.[0] || product.image || '').trim()
  if (/^(https?:)?\/\//.test(image) || image.startsWith('/') || image.startsWith('data:image/')) return image
  if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(image)) return `/${image}`
  return fallbackImage(product)
}

// Product photo that falls back to the category image if the stored URL is broken.
export function ProductImage({ product, alt = product?.name || '', ...props }) {
  return <img src={productImage(product)} alt={alt} loading="lazy" onError={(event) => { const fallback = fallbackImage(product); if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback }} {...props} />
}

export const formatPrice = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
// Mirrors the backend rule in orderController: ₹25 delivery below ₹500, free above.
export const FREE_DELIVERY_MIN = 500
export const deliveryFeeFor = (subtotal) => (!subtotal || subtotal >= FREE_DELIVERY_MIN ? 0 : 25)

export function Loader({ label = 'Loading Janai' }) { return <div className="loading-state"><span className="spinner" />{label}</div> }

export function EmptyState({ icon: Icon = PackageCheck, title, message, action, to = '/shop' }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><h2>{title}</h2><p>{message}</p>{action && <Link className="button button-primary" to={to}>{action}<ArrowRight size={16} /></Link>}</div>
}

export function QuantitySelector({ value, onChange, min = 1, max = 99, compact = false, label = 'quantity' }) {
  return <div className={`quantity-selector${compact ? ' is-compact' : ''}`}><button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={15} /></button><span aria-live="polite">{value}</span><button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={15} /></button></div>
}

export function CategoryCard({ title, description, image, to }) {
  return <Link className="category-card" to={to || `/shop?category=${encodeURIComponent(title)}`}><img src={image} alt={title} loading="lazy" /><span className="category-card-copy"><strong>{title}</strong><small>{description}</small></span><span className="category-arrow"><ArrowRight size={15} /></span></Link>
}

// Badges share one flow container so they stack with a gap and never sit on top of each other.
export function ProductBadges({ product }) {
  if (!product.preOrderAvailable && !product.bulkAvailable) return null
  return <span className="product-badges">{product.preOrderAvailable && <span className="product-badge">Pre-Order</span>}{product.bulkAvailable && <span className="product-badge badge-bulk">Bulk Available</span>}</span>
}

export function ProductCard({ product }) {
  const [quantity, setQuantity] = useState(1)
  const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem('janai_wishlist') || '[]').includes(product._id))
  const { user } = useAuth()
  const { addItem } = useCart()
  const toast = useToast()
  async function add() {
    if (!user) { toast('Sign in to add products to your cart.', 'error'); return }
    try { await addItem(product._id, quantity); toast(`${product.name} added to cart.`) } catch (error) { toast(error.response?.data?.message || 'Could not add that product.', 'error') }
  }
  function toggleSaved(event) {
    event.preventDefault()
    const current = JSON.parse(localStorage.getItem('janai_wishlist') || '[]')
    const next = saved ? current.filter((id) => id !== product._id) : [...current, product._id]
    localStorage.setItem('janai_wishlist', JSON.stringify(next))
    setSaved(!saved)
  }
  return <article className="product-card"><Link to={`/product/${product._id}`} className="product-photo"><ProductImage product={product} /><ProductBadges product={product} /><button type="button" className={`wishlist-button${saved ? ' saved' : ''}`} aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'} onClick={toggleSaved}><Heart size={16} fill={saved ? 'currentColor' : 'none'} /></button></Link><div className="product-card-content"><Link to={`/product/${product._id}`} className="product-name">{product.name}</Link><div className="product-meta"><span className="product-category">{product.category}</span><span className="product-rating"><Star size={12} fill="currentColor" />{Number(product.rating || 0).toFixed(1)}<span>({product.reviews || 0})</span></span></div><p>{product.description}</p><div className="product-price"><strong>{formatPrice(product.price)}</strong><span>/ {product.unit}</span></div><div className="product-actions"><QuantitySelector value={quantity} onChange={setQuantity} max={Math.max(1, product.stock || 99)} compact /><button className="button button-primary add-button" disabled={product.stock === 0} onClick={add} aria-label={product.stock === 0 ? `${product.name} is sold out` : `Add ${product.name} to cart`}>{product.stock === 0 ? 'Sold out' : 'Add'}</button></div></div></article>
}

export function OrderCard({ order }) {
  return <article className="order-card"><div className="order-card-head"><span>#{String(order._id).slice(-8).toUpperCase()}{order.orderType === 'preorder' && <em className="order-type-tag">Pre-Order</em>}</span><span className={`status-pill status-${order.orderStatus}`}>{order.orderStatus?.replaceAll('_', ' ')}</span></div><div className="order-card-items">{order.items?.slice(0, 3).map((item) => <ProductImage key={item.name} product={item} alt={item.name} />)}<span>{order.items?.length || 0} items</span></div><div className="order-card-foot"><span>{new Date(order.createdAt).toLocaleDateString('en-IN')}</span><strong>{formatPrice(order.totalAmount)}</strong><Link to={`/orders/${order._id}`} aria-label="View order"><ArrowRight size={17} /></Link></div></article>
}
