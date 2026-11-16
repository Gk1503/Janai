import { ArrowLeft, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SeasonalBanner, useDealsData } from '../components/Deals'
import { EmptyState, Loader, ProductCard } from '../components/UI'

// The two customer pages share their states: loading, a failed request, a section the owner switched off,
// nothing live, and the promotions themselves. All data comes from the public promotions API, which already
// applies the ON/OFF switch, the active flag and the date window. The *View components take that state as a
// prop so every state can be rendered on its own.
function DealsPageShell({ state, eyebrow, name, intro, keepEmpty, render }) {
  const { status, enabled, promotions, reload } = state
  const shown = promotions.filter((promotion) => promotion.products.length || keepEmpty)
  let body
  if (status === 'loading') body = <Loader label={`Loading ${name}`} />
  else if (status === 'error') body = <div className="inline-error" role="alert">We could not load {name} right now.<button type="button" className="text-link" onClick={reload}>Try again</button></div>
  else if (!enabled) body = <EmptyState title={`${name} are not available right now`} message="Please check back soon, or browse the whole shop." action="Browse shop" />
  else if (!shown.length) body = <EmptyState title={`No ${name.toLowerCase()} right now`} message="New offers will appear here as soon as they go live." action="Browse shop" />
  else body = <div className="deal-page-groups">{shown.map((promotion, index) => render(promotion, index))}</div>
  return <section className="page-container content-page deal-page">
    <Link className="text-link back-link" to="/"><ArrowLeft size={16} />Home</Link>
    <div className="page-title-row"><div><span className="eyebrow">{eyebrow}</span><h1>{name}</h1>{intro && <p>{intro}</p>}</div></div>
    {body}
  </section>
}

const Products = ({ promotion }) => (promotion.products.length
  ? <div className="product-grid deal-products">{promotion.products.map((product) => <ProductCard key={product._id} product={product} note={promotion.description} compact />)}</div>
  : null)

export function BestDealsView({ state }) {
  return <DealsPageShell state={state} eyebrow="TODAY'S BEST DEALS" name="Best Deals" intro="Discover great deals on your daily essentials." render={(promotion) => {
    const title = (promotion.title || '').trim()
    const hasHead = Boolean(title || promotion.description || promotion.bannerImage)
    return <article className="deal-group" key={promotion._id}>
      {hasHead && <div className="deal-group-head">
        {promotion.bannerImage && <img className="deal-thumb" src={promotion.bannerImage} alt="" loading="lazy" />}
        <div className="deal-copy">
          {title && <h2>{title}</h2>}
          {promotion.description && <p>{promotion.description}</p>}
          {promotion.discount && <small className="deal-ends"><Clock size={13} /> Offer ends {new Date(promotion.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>}
        </div>
      </div>}
      <Products promotion={promotion} />
    </article>
  }} />
}

export function SeasonalDealsView({ state }) {
  return <DealsPageShell state={state} eyebrow="IN SEASON" name="Seasonal Deals" keepEmpty render={(promotion) => <article className="deal-group seasonal-group" key={promotion._id}>
    <SeasonalBanner promotion={promotion} as="h2" showProducts={false} />
    <Products promotion={promotion} />
  </article>} />
}

export const BestDealsPage = () => <BestDealsView state={useDealsData('best-deals', { full: true })} />
export const SeasonalDealsPage = () => <SeasonalDealsView state={useDealsData('seasonal-deals', { full: true })} />
