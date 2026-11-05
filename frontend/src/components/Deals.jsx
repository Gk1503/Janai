import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Clock, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { ProductCard } from './UI'

// ---------------------------------------------------------------- data
// Loads the eligible promotions of one section from the public API. The server returns an empty list when the
// section is switched off or nothing is currently live. `full` asks for every product a promotion holds (the
// dedicated pages); without it the server returns the short list the homepage needs.
export function useDealsData(section, { full = false } = {}) {
  const [state, setState] = useState({ status: 'loading', enabled: true, promotions: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    api.get(`/promotions/${section}`, full ? { params: { full: 1 } } : undefined)
      .then(({ data }) => { if (current) setState({ status: 'ready', enabled: data.enabled !== false, promotions: Array.isArray(data.promotions) ? data.promotions : [] }) })
      .catch(() => { if (current) setState({ status: 'error', enabled: true, promotions: [] }) })
    return () => { current = false }
  }, [section, full, attempt])
  const reload = useCallback(() => { setState((previous) => ({ ...previous, status: 'loading' })); setAttempt((value) => value + 1) }, [])
  return { ...state, reload }
}

// The homepage only needs the list: a failed request simply renders nothing there, because promotions are an
// extra and never a reason for the homepage to break.
export function useDeals(section) {
  return useDealsData(section).promotions
}

// ---------------------------------------------------------------- helpers
const endsOn = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// An untitled promotion falls back to its section name; nothing is ever invented.
export const dealTitle = (promotion, fallback) => (promotion.title || '').trim() || fallback

const uniqueProducts = (promotions) => {
  const seen = new Map()
  for (const promotion of promotions) {
    for (const product of promotion.products) if (!seen.has(product._id)) seen.set(product._id, { product, note: promotion.description || '' })
  }
  return [...seen.values()]
}

// One category shared by every product sends the customer there; otherwise to the whole shop.
export function shopLink(promotion) {
  const categories = [...new Set(promotion.products.map((product) => product.category))]
  return categories.length === 1 ? `/shop?category=${encodeURIComponent(categories[0])}` : '/shop'
}

// Previous / next buttons for a horizontally scrolling track (touch and trackpad scroll natively).
function ScrollButtons({ trackRef, label }) {
  const move = (direction) => trackRef.current?.scrollBy({ left: direction * Math.max(220, trackRef.current.clientWidth * 0.8), behavior: 'smooth' })
  return <>
    <button type="button" className="slide-arrow prev" aria-label={`${label} left`} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
    <button type="button" className="slide-arrow next" aria-label={`${label} right`} onClick={() => move(1)}><ChevronRight size={18} /></button>
  </>
}

// ---------------------------------------------------------------- Seasonal Deals
// The campaign's Background Image (the promotion's bannerImage) covers the whole section with the title centred
// over it. Below the title sit the campaign's banner products: at most three, chosen on the server from the
// products the admin ticked "Show on Seasonal Deals homepage" (no filler when fewer are ticked). Each is a
// normal compact product card, so it links to the product page and adds to the cart as usual.
// `showProducts={false}` is for the Seasonal Deals page, which lists every campaign product itself; `preview`
// is the admin form, where nothing should navigate; `cta` adds the "Explore Deals" link (homepage only).
export function SeasonalBanner({ promotion, cta = false, preview = false, showProducts = true, as: Heading = 'h2' }) {
  const title = dealTitle(promotion, 'Seasonal Deals')
  const items = showProducts ? (promotion.bannerProducts || []).slice(0, 3) : []
  const image = (promotion.bannerImage || '').replace(/["\\\n\r)]/g, (character) => encodeURIComponent(character))
  return <article className={`seasonal-banner${image ? ' has-bg' : ''}${preview ? ' is-preview' : ''}`} style={image ? { backgroundImage: `url("${image}")` } : undefined}>
    <div className="seasonal-inner">
      {promotion.badgeText && <span className="deal-badge"><Sparkles size={12} />{promotion.badgeText}</span>}
      <Heading>{title}</Heading>
      {promotion.description && <p>{promotion.description}</p>}
      {items.length > 0 && <ul className="seasonal-products">{items.map((product) => <li key={product._id}><ProductCard product={product} compact /></li>)}</ul>}
      {cta && <Link className="seasonal-cta" to="/seasonal-deals" aria-label={`Explore Deals: ${title}`}><span>Explore Deals</span><ArrowRight size={18} /></Link>}
    </div>
  </article>
}

const MAX_HOME_CAMPAIGNS = 5

// Homepage: one banner, or a compact horizontal carousel when several campaigns are live.
export function SeasonalDeals({ promotions }) {
  const trackRef = useRef(null)
  const shown = promotions.slice(0, MAX_HOME_CAMPAIGNS)
  if (!shown.length) return null
  const many = shown.length > 1
  return <section className="page-container seasonal-deals-section" aria-label="Seasonal Deals">
    <div className="seasonal-carousel">
      <div className={`seasonal-track${many ? ' is-multi' : ''}`} ref={trackRef}>
        {shown.map((promotion) => <div className="seasonal-slide" key={promotion._id}><SeasonalBanner promotion={promotion} cta /></div>)}
      </div>
      {many && <ScrollButtons trackRef={trackRef} label="Scroll campaigns" />}
    </div>
  </section>
}

// ---------------------------------------------------------------- Best Deals
const MAX_HOME_PRODUCTS = 16

// Homepage: one horizontal carousel of the products in every live Best Deals promotion.
export function BestDeals({ promotions }) {
  const trackRef = useRef(null)
  const items = uniqueProducts(promotions).slice(0, MAX_HOME_PRODUCTS)
  if (!items.length) return null
  return <section className="page-container best-deals-section" aria-label="Best Deals">
    <div className="best-deals-band">
      <div className="best-deals-head">
        <div><h2>Best Deals</h2><p className="section-subtitle">Discover great deals on your daily essentials.</p></div>
        <Link className="view-all" to="/best-deals" aria-label="View all Best Deals"><span>View all</span><ArrowRight size={18} /></Link>
      </div>
      <div className="deal-carousel-wrap">
        <ScrollButtons trackRef={trackRef} label="Scroll deals" />
        <div className="deal-carousel" ref={trackRef} tabIndex={0} aria-label="Best Deals products">
          {items.map(({ product, note }) => <div className="deal-slide" key={product._id}><ProductCard product={product} note={note} compact /></div>)}
        </div>
      </div>
    </div>
  </section>
}
