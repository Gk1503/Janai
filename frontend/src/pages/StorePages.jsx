import { useEffect, useState } from 'react'
import { ArrowRight, BadgePercent, CalendarDays, ChevronDown, Heart, Leaf, Search, ShieldCheck, ShoppingBag, Sprout, Star, Truck, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useCart, useToast } from '../context/AppContexts'
import { CategoryCard, EmptyState, formatPrice, Loader, ProductBadges, ProductCard, ProductImage, QuantitySelector } from '../components/UI'

const benefits = [
  { icon: Sprout, title: 'Farm Fresh Quality', text: 'Picked from trusted farms' },
  { icon: Truck, title: 'On-Time Delivery', text: 'On the date you choose' },
  { icon: ShieldCheck, title: 'Safe & Hygienic', text: 'Carefully packed' },
  { icon: BadgePercent, title: 'Best Prices Always', text: 'Fair, everyday value' },
]

const categories = [
  { title: 'Fruits', description: 'Fresh and naturally sweet fruits.', image: '/fruit.jpg' },
  { title: 'Vegetables', description: 'Fresh vegetables delivered to your doorstep.', image: '/Vegatables.png' },
  { title: 'Groceries', description: 'Everyday essentials for your home.', image: '/grocery.jpg' },
]

export function HomePage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/products', { params: { sort: 'featured', limit: 8 } })
      .then(({ data }) => setProducts(data.products))
      .catch((requestError) => setError(getApiError(requestError)))
      .finally(() => setLoading(false))
  }, [])

  return <>
    <section className="home-hero page-container"><div className="hero-copy"><span className="eyebrow"><Leaf size={14} /> FRESH · LOCAL · AFFORDABLE</span><h1>Freshness Delivered<br /><span>to Your Doorstep</span></h1><p>Fresh fruits, crisp vegetables and daily groceries — straight from farms to your home.</p><div className="hero-actions"><Link className="button button-primary" to="/shop">Shop Now<ArrowRight size={17} /></Link><Link className="button button-outline" to="/pre-orders"><CalendarDays size={15} />Pre Order</Link></div></div><div className="hero-image"><img src="/Hero-image.png" alt="Fresh fruits and vegetables ready for delivery" /></div></section>
    <section className="trust-strip page-container" aria-label="Shopping benefits">{benefits.map(({ icon: Icon, title, text }) => <div key={title}><span className="trust-icon"><Icon /></span><span className="trust-copy"><strong>{title}</strong><small>{text}</small></span></div>)}</section>
    <section id="categories" className="page-section page-container"><div className="section-heading"><div><span className="eyebrow">A GOOD PLACE TO START</span><h2>Shop by Category</h2></div><Link className="text-link" to="/shop">View all<ArrowRight size={16} /></Link></div><div className="category-grid">{categories.map((category) => <CategoryCard key={category.title} {...category} />)}</div></section>
    <section className="page-section page-container"><div className="section-heading"><div><span className="eyebrow">TODAY'S GOOD DEALS</span><h2>Best Deals</h2><p className="section-subtitle">Fresh finds and everyday value, selected for you.</p></div><Link className="text-link" to="/shop">Shop all<ArrowRight size={16} /></Link></div>{loading ? <Loader /> : error ? <div className="inline-error">{error}</div> : products.length ? <div className="product-grid">{products.slice(0, 8).map((product) => <ProductCard key={product._id} product={product} />)}</div> : <EmptyState title="Fresh picks are on the way" message="Products added by Janai will appear here." action="Browse shop" />}</section>
    <section className="feature-banners page-container"><Link className="feature-banner preorder-banner" to="/pre-orders"><span className="feature-copy"><span className="eyebrow">YOUR WEEK, YOUR WAY</span><strong>Plan Ahead,<br />Stay Fresh</strong><span>Schedule a delivery for the date you need.</span><span className="feature-cta">Explore pre-orders<ArrowRight size={16} /></span></span><img src="/fruit.jpg" alt="Fresh fruit for a future delivery" /></Link><Link className="feature-banner bulk-banner" to="/bulk-orders"><span className="feature-copy"><span className="eyebrow">MORE TOGETHER</span><strong>Bulk Orders<br />Made Easy</strong><span>Fresh produce for businesses, events and more.</span><span className="feature-cta">Explore bulk orders<ArrowRight size={16} /></span></span><img src="/grocery.jpg" alt="Fresh groceries for group orders" /></Link></section>
    <section className="seasonal-band"><div className="page-container seasonal-inner"><div><span className="eyebrow">WHY JANAI</span><h2>Fresh from people who care.</h2><p>Farm-fresh quality, reliable delivery and thoughtful service, every day.</p><Link className="button button-light" to="/about">Our story<ArrowRight size={16} /></Link></div><div className="seasonal-benefits"><span><Leaf />Fresh products</span><span><BadgePercent />Best Prices Always</span><span><CalendarDays />Pre-orders</span><span><ShoppingBag />Bulk orders</span></div></div></section>
  </>
}

const shopCategories = ['All', 'Fruits', 'Vegetables', 'Groceries']
export function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState(searchParams.get('category') || 'All')
  const urlQuery = searchParams.get('q') || ''
  const [query, setQuery] = useState(urlQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery)
  const [sort, setSort] = useState('featured')
  const [preOrder, setPreOrder] = useState(searchParams.get('preOrder') === 'true')
  const [bulk, setBulk] = useState(searchParams.get('bulk') === 'true')
  const [maxPrice, setMaxPrice] = useState('')

  // Header search navigates to /shop?q=…; keep the page in sync even when already on Shop.
  useEffect(() => { setQuery(urlQuery); setDebouncedQuery(urlQuery) }, [urlQuery])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => {
    setLoading(true)
    const params = { sort, limit: 100 }
    if (category !== 'All') params.category = category
    if (debouncedQuery.trim()) params.q = debouncedQuery.trim()
    if (preOrder) params.preOrder = true
    if (bulk) params.bulk = true
    if (maxPrice) params.maxPrice = maxPrice
    api.get('/products', { params }).then(({ data }) => { setProducts(data.products); setError('') }).catch((requestError) => setError(getApiError(requestError))).finally(() => setLoading(false))
  }, [category, debouncedQuery, sort, preOrder, bulk, maxPrice])

  function chooseCategory(value) {
    setCategory(value)
    const next = new URLSearchParams(searchParams)
    if (value === 'All') next.delete('category')
    else next.set('category', value)
    setSearchParams(next, { replace: true })
  }

  return <section className="page-container shop-page"><div className="page-title-row"><div><span className="eyebrow">FRESH FROM JANAI</span><h1>Shop</h1></div><span className="shop-total"><strong>{products.length}</strong> products</span></div><div className="shop-toolbar"><label className="shop-search"><Search size={18} /><input type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fruits, vegetables, groceries..." aria-label="Search products" />{query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}</label><label className="sort-select"><ChevronDown size={15} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products"><option value="featured">Featured</option><option value="popular">Top rated</option><option value="priceAsc">Price: low to high</option><option value="priceDesc">Price: high to low</option><option value="newest">Newest</option></select></label></div><div className="category-filter-row">{shopCategories.map((item) => <button type="button" key={item} className={`filter-chip${category === item ? ' selected' : ''}`} onClick={() => chooseCategory(item)}>{item}</button>)}</div><div className="shop-content"><aside className="shop-filters"><h2>Refine picks</h2><label className="filter-check"><input type="checkbox" checked={preOrder} onChange={(event) => setPreOrder(event.target.checked)} /><span>Pre-order available</span></label><label className="filter-check"><input type="checkbox" checked={bulk} onChange={(event) => setBulk(event.target.checked)} /><span>Bulk available</span></label><label className="filter-field"><span>Maximum price (₹)</span><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="No limit" /></label><button className="filter-reset" type="button" onClick={() => { setPreOrder(false); setBulk(false); setMaxPrice(''); chooseCategory('All') }}>Clear filters</button></aside><div className="shop-results">{!loading && !error && <p className="results-summary">{debouncedQuery.trim() ? <>Showing <strong>{products.length}</strong> {products.length === 1 ? 'result' : 'results'} for <strong>“{debouncedQuery.trim()}”</strong></> : <><strong>{products.length}</strong> {products.length === 1 ? 'product' : 'products'}{category !== 'All' ? ` in ${category}` : ''}</>}</p>}{loading ? <Loader label="Loading fresh products" /> : error ? <div className="inline-error">{error}</div> : products.length ? <div className="product-grid">{products.map((product) => <ProductCard key={product._id} product={product} />)}</div> : <EmptyState icon={Search} title="No matching products" message={debouncedQuery.trim() ? `We couldn’t find anything for “${debouncedQuery.trim()}”. Try a different spelling or another category.` : 'Try another category or clear your filters.'} />}</div></div></section>
}

export function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { addItem } = useCart()
  const toast = useToast()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setLoading(true)
    api.get(`/products/${id}`).then(({ data }) => {
      setProduct(data.product)
      return api.get('/products', { params: { category: data.product.category, limit: 5 } })
    }).then(({ data }) => setRelated(data.products.filter((item) => item._id !== id).slice(0, 4))).catch((requestError) => setError(getApiError(requestError))).finally(() => setLoading(false))
  }, [id])
  async function add(goToCart = false) {
    if (!user) { navigate('/login'); return }
    try { await addItem(product._id, quantity); toast(`${product.name} added to cart.`); if (goToCart) navigate('/cart') } catch (requestError) { toast(getApiError(requestError), 'error') }
  }
  function toggleSaved() {
    const current = JSON.parse(localStorage.getItem('janai_wishlist') || '[]')
    const next = saved ? current.filter((item) => item !== id) : [...current, id]
    localStorage.setItem('janai_wishlist', JSON.stringify(next))
    setSaved(!saved)
  }
  if (loading) return <div className="page-container"><Loader /></div>
  if (error || !product) return <div className="page-container"><EmptyState title="Product not found" message={error || 'This product may have been removed.'} action="Return to shop" /></div>
  return <div className="page-container product-detail-page"><div className="breadcrumbs"><Link to="/shop">Shop</Link><span>›</span><span>{product.category}</span></div><div className="product-detail"><div className="product-detail-image"><ProductImage product={product} loading="eager" /><button type="button" className={`wishlist-button detail-heart${saved ? ' saved' : ''}`} onClick={toggleSaved} aria-label="Toggle wishlist"><Heart size={19} fill={saved ? 'currentColor' : 'none'} /></button><ProductBadges product={product} /></div><div className="product-detail-copy"><span className="eyebrow">{product.category}</span><h1>{product.name}</h1><div className="detail-rating"><Star size={15} fill="currentColor" />{Number(product.rating || 0).toFixed(1)} ({product.reviews || 0} reviews)</div><div className="detail-price"><strong>{formatPrice(product.price)}</strong><span>/ {product.unit}</span></div><p>{product.description}</p><div className="product-capabilities">{product.preOrderAvailable && <Link to={`/pre-orders?product=${id}`}><CalendarDays size={18} /><span>Pre-order for your preferred date</span></Link>}{product.bulkAvailable && <Link to={`/bulk-orders?product=${id}#bulk-request`}><PackageCheckIcon /><span>Add to a bulk order request</span></Link>}</div><div className="detail-buy-row"><QuantitySelector value={quantity} onChange={setQuantity} max={Math.max(1, product.stock || 1)} /><span>{product.stock} {product.unit} available</span></div><button className="button button-primary button-full" onClick={() => add(false)} disabled={product.stock < 1}>Add to Cart<ShoppingBag size={17} /></button><button className="button button-outline button-full" onClick={() => add(true)} disabled={product.stock < 1}>Buy Now</button></div></div>{related.length > 0 && <section className="page-section detail-related"><h2>You may also like</h2><div className="product-grid">{related.map((item) => <ProductCard key={item._id} product={item} />)}</div></section>}</div>
}

function PackageCheckIcon() { return <ShoppingBag size={18} /> }
