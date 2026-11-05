// Deals & promotional pricing: component-level checks, using the same approach as access-control.test.mjs
// (Vite's SSR loader compiles the real components; react-dom/server renders them; the auth context is a stub).
// Run with: npm test
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let renderToStaticMarkup;
let MemoryRouter;
let React;
let mods;

const authStub = `
import { createCan, hasPanelAccess, isOwnerAccount } from '/src/utils/permissions.js'
export function useAuth() {
  const state = globalThis.__testAuth || { user: null, authLoading: false }
  const user = state.user
  return { user, authLoading: state.authLoading, can: createCan(user), isOwner: isOwnerAccount(user), hasPanelAccess: hasPanelAccess(user), logout() {}, refreshUser: async () => user }
}
export function useToast() { return () => {} }
export function useCart() { const items = globalThis.__testCartItems || []; return { cart: { items }, items, addItem: async () => {}, setQuantity: async () => {}, removeItem: async () => {}, priceNotice: [], dismissPriceNotice() {} } }
`;

// ProductCard reads the wishlist from localStorage when it first renders; the server-side renderer has none.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

before(async () => {
  server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    plugins: [{
      name: 'auth-context-stub',
      enforce: 'pre',
      resolveId(source) { return source.endsWith('/context/AppContexts') || source.endsWith('/context/AppContexts.jsx') ? '\0auth-stub' : null; },
      load(id) { return id === '\0auth-stub' ? authStub : null; },
    }],
  });
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ({ MemoryRouter } = await import('react-router-dom'));
  const ui = await server.ssrLoadModule('/src/components/UI.jsx');
  const deals = await server.ssrLoadModule('/src/components/Deals.jsx');
  const admin = await server.ssrLoadModule('/src/pages/AdminOrderPages.jsx');
  mods = {
    ProductCard: ui.ProductCard, PriceTag: ui.PriceTag, unitPriceOf: ui.unitPriceOf, offerLabel: ui.offerLabel,
    BestDeals: deals.BestDeals, SeasonalDeals: deals.SeasonalDeals,
    HomePage: (await server.ssrLoadModule('/src/pages/StorePages.jsx')).HomePage,
    OrderDetailsModal: admin.OrderDetailsModal,
    AdminSidebar: (await server.ssrLoadModule('/src/components/AdminSidebar.jsx')).default,
    DealProductPicker: (await server.ssrLoadModule('/src/components/DealProductPicker.jsx')).default,
    ProductFormModal: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).default,
    SeasonalBanner: deals.SeasonalBanner, cartActionFor: ui.cartActionFor,
    BestDealsView: (await server.ssrLoadModule('/src/pages/DealPages.jsx')).BestDealsView,
    SeasonalDealsView: (await server.ssrLoadModule('/src/pages/DealPages.jsx')).SeasonalDealsView,
    AdminDealsPage: (await server.ssrLoadModule('/src/pages/AdminDealsPage.jsx')).default,
    adminNavigation: (await server.ssrLoadModule('/src/components/adminNavigation.js')).adminNavigation,
  };
});

after(async () => { await server?.close(); });

const h = (...args) => React.createElement(...args);
const owner = { role: 'admin', isActive: true, firstName: 'Janai', lastName: 'Admin' };
const staff = (permissions) => ({ role: 'staff', isActive: true, firstName: 'Sam', lastName: 'Staff', permissions });

function render(element, user = null, path = '/') {
  globalThis.__testAuth = { user, authLoading: false };
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, element));
}

const mango = { _id: 'p1', name: 'Mango', category: 'Fruits', description: 'Sweet', price: 100, unit: 'kg', images: [], stock: 20, rating: 4.5, reviews: 3, offer: null };
const percentOffer = { promotionId: 'd1', title: 'Mango Season', badgeText: '', discountType: 'percentage', discountValue: 20, originalPrice: 100, discountPerUnit: 20, finalPrice: 80, discountPercent: 20 };
const fixedOffer = { ...percentOffer, discountType: 'fixed', discountValue: 15, discountPerUnit: 15, finalPrice: 85, discountPercent: 15 };
const promotion = (extra = {}) => ({ _id: 'd1', title: 'Weekend Grocery Deals', description: 'Stock up for the weekend', bannerImage: '', badgeText: 'Hot Deal', section: 'best_deals', promotionType: 'actual_discount', discount: { type: 'percentage', value: 20 }, endAt: new Date(Date.now() + 3600e3).toISOString(), products: [{ ...mango, offer: percentOffer }], ...extra });

// The price area of a card is everything after the image link; the image link must stay clean.
const photoOf = (html) => html.slice(html.indexOf('class="product-photo"'), html.indexOf('</a>', html.indexOf('class="product-photo"')));

describe('promotional prices on product cards', () => {
  it('shows the original price struck through, the offer price and the saving below the image', () => {
    const html = render(h(mods.ProductCard, { product: { ...mango, offer: percentOffer } }));
    assert.match(html, /<s class="original-price">₹100<\/s>/);
    assert.match(html, /<strong class="offer-price">₹80<\/strong>/);
    assert.match(html, /<em class="offer-pill">20% OFF — Save ₹20<\/em>/);
    assert.ok(html.indexOf('offer-pill') > html.indexOf('</a>'), 'the saving sits in the price area, after the image');
  });

  it('never overlays a discount badge or sticker on the product image', () => {
    const photo = photoOf(render(h(mods.ProductCard, { product: { ...mango, offer: { ...percentOffer, badgeText: 'Limited Offer' } } })));
    assert.ok(!/OFF|badge-offer|Limited Offer|offer-pill|%/.test(photo), photo);
  });

  it('still shows the stock-style badges (pre-order, bulk) on the image', () => {
    const photo = photoOf(render(h(mods.ProductCard, { product: { ...mango, preOrderAvailable: true, bulkAvailable: true, offer: percentOffer } })));
    assert.match(photo, /Pre-Order/);
    assert.match(photo, /Bulk Available/);
  });

  it('words a fixed-amount discount with the saving in rupees', () => {
    const html = render(h(mods.ProductCard, { product: { ...mango, offer: fixedOffer } }));
    assert.match(html, /15% OFF — Save ₹15/);
    assert.match(html, /₹85/);
  });

  it('shows only the normal price, with no discount wording, when there is no offer', () => {
    const html = render(h(mods.ProductCard, { product: mango }));
    assert.match(html, /<strong>₹100<\/strong>/);
    assert.ok(!/original-price|offer-price|OFF/.test(html), 'a display-only promotion must not create a false discount');
  });

  it('uses a promotion note under the name when one is given, and the product description otherwise', () => {
    assert.match(render(h(mods.ProductCard, { product: mango, note: 'Stock up for the weekend' })), /Stock up for the weekend/);
    assert.match(render(h(mods.ProductCard, { product: mango })), /Sweet/);
  });

  it('prices from the server offer only', () => {
    assert.equal(mods.unitPriceOf({ ...mango, offer: percentOffer }), 80);
    assert.equal(mods.unitPriceOf(mango), 100);
  });
});

describe('homepage deal sections', () => {
  const seasonal = (extra = {}) => promotion({ section: 'seasonal_deals', ...extra });

  it('render nothing at all when there are no eligible promotions (section off or empty)', () => {
    assert.equal(render(h(mods.BestDeals, { promotions: [] })), '');
    assert.equal(render(h(mods.SeasonalDeals, { promotions: [] })), '');
  });

  it('Best Deals is a horizontal product carousel with a working arrow to /best-deals', () => {
    const html = render(h(mods.BestDeals, { promotions: [promotion()] }));
    assert.match(html, /<h2>Best Deals<\/h2>/);
    assert.match(html, /Discover great deals on your daily essentials/);
    assert.match(html, /class="deal-carousel"/);
    assert.match(html, /<a class="view-all"[^>]*aria-label="View all Best Deals"[^>]*href="\/best-deals"|<a [^>]*href="\/best-deals"[^>]*>/);
    assert.match(html, /View all/);
    assert.match(html, /Mango/);
    assert.match(html, /₹80/);
    assert.match(html, /20% OFF — Save ₹20/);
    assert.match(html, /Stock up for the weekend/, 'the promotion description appears on its cards');
  });

  it('Best Deals cards keep the image clean and show Add to cart', () => {
    const html = render(h(mods.BestDeals, { promotions: [promotion()] }));
    assert.ok(!/OFF|offer-pill/.test(photoOf(html)));
    assert.match(html, /aria-label="Add Mango to cart"/);
  });

  it('a display-only Best Deals card shows the normal price and no discount', () => {
    const html = render(h(mods.BestDeals, { promotions: [promotion({ promotionType: 'display_only', discount: null, products: [mango] })] }));
    assert.match(html, /₹100/);
    assert.ok(!/original-price|OFF|Offer ends/.test(html));
  });

  it('lists a product once even when two promotions hold it', () => {
    const html = render(h(mods.BestDeals, { promotions: [promotion({ _id: 'a' }), promotion({ _id: 'b' })] }));
    assert.equal(html.match(/class="product-card is-compact"/g).length, 1);
  });

  it('a Best Deals promotion with no products renders no empty section', () => {
    assert.equal(render(h(mods.BestDeals, { promotions: [promotion({ products: [] })] })), '');
  });

  it('Seasonal Deals is a large campaign banner with a working "Explore Deals" action to /seasonal-deals', () => {
    const html = render(h(mods.SeasonalDeals, { promotions: [seasonal({ title: 'Happy Dhanteras', bannerImage: 'data:image/png;base64,AAAA' })] }));
    assert.match(html, /seasonal-banner has-bg/);
    assert.match(html, /style="background-image:url\(&quot;data:image\/png;base64,AAAA&quot;\)"/, 'the background image covers the whole section');
    assert.ok(!/<img /.test(html), 'the background is not a small separate image');
    assert.match(html, /<h2>Happy Dhanteras<\/h2>/);
    assert.match(html, /Stock up for the weekend/);
    assert.match(html, /Hot Deal/);
    assert.match(html, /<a [^>]*href="\/seasonal-deals"[^>]*>(<span>)?Explore Deals/);
    assert.ok(!/slide-arrow/.test(html), 'a single banner needs no carousel controls');
  });

  it('several campaigns become a compact horizontal carousel with scroll buttons, in the configured order', () => {
    const html = render(h(mods.SeasonalDeals, { promotions: [seasonal({ _id: 'a', title: 'Mango Season' }), seasonal({ _id: 'b', title: 'Monsoon Offers', bannerImage: '' })] }));
    assert.ok(html.indexOf('Mango Season') < html.indexOf('Monsoon Offers'));
    assert.match(html, /seasonal-track is-multi/);
    assert.match(html, /aria-label="Scroll campaigns right"/);
    assert.equal(html.match(/class="seasonal-slide"/g).length, 2);
    assert.ok(!/has-bg/.test(html), 'a campaign without a background image uses the clean fallback colour');
  });

  it('does not overload the homepage with more than five banners', () => {
    const many = Array.from({ length: 8 }, (_, index) => seasonal({ _id: `c${index}`, title: `Campaign ${index}` }));
    assert.equal(render(h(mods.SeasonalDeals, { promotions: many })).match(/class="seasonal-slide"/g).length, 5);
  });

  it('an untitled promotion falls back to the section name and never prints undefined or null', () => {
    const html = render(h(mods.SeasonalDeals, { promotions: [seasonal({ title: '', description: '', badgeText: '' })] }));
    assert.match(html, /<h2>Seasonal Deals<\/h2>/);
    assert.ok(!/undefined|null/.test(html));
    const untitled = render(h(mods.SeasonalDeals, { promotions: [seasonal({ title: undefined, description: undefined })] }));
    assert.match(untitled, /<h2>Seasonal Deals<\/h2>/);
    assert.ok(!/undefined|null/.test(untitled));
    assert.ok(!/<p>/.test(html), 'an empty description is hidden, not rendered empty');
  });
});

describe('dedicated Best Deals and Seasonal Deals pages', () => {
  const ready = (promotions, extra = {}) => ({ status: 'ready', enabled: true, promotions, reload() {}, ...extra });
  const bestPage = (state) => render(h(mods.BestDealsView, { state }));
  const seasonPage = (state) => render(h(mods.SeasonalDealsView, { state }));

  it('shows a loading state, an error with retry, and the disabled and empty states', () => {
    assert.match(bestPage({ status: 'loading', enabled: true, promotions: [] }), /Loading Best Deals/);
    assert.match(bestPage({ status: 'error', enabled: true, promotions: [], reload() {} }), /could not load Best Deals[\s\S]*Try again/);
    assert.match(bestPage(ready([], { enabled: false })), /Best Deals are not available right now/);
    assert.match(bestPage(ready([])), /No best deals right now/);
    assert.match(seasonPage(ready([], { enabled: false })), /Seasonal Deals are not available right now/);
    assert.match(seasonPage(ready([])), /No seasonal deals right now/);
  });

  it('Best Deals groups products under their promotion and prices them like the shop does', () => {
    const second = promotion({ _id: 'd2', title: 'Veg Week', description: '', promotionType: 'display_only', discount: null, products: [{ ...mango, _id: 'p2', name: 'Tomato' }] });
    const html = bestPage(ready([promotion(), second]));
    assert.match(html, /<h1>Best Deals<\/h1>/);
    assert.ok(html.indexOf('Weekend Grocery Deals') < html.indexOf('Mango') && html.indexOf('Mango') < html.indexOf('Veg Week') && html.indexOf('Veg Week') < html.indexOf('Tomato'));
    assert.match(html, /20% OFF — Save ₹20/);
    assert.ok(!/OFF|offer-pill/.test(photoOf(html)));
    assert.match(html, /aria-label="Add Mango to cart"/);
    assert.match(html, /aria-label="Add Tomato to cart"/);
  });

  it('Best Deals shows every product it is given, not just a handful', () => {
    const products = Array.from({ length: 30 }, (_, index) => ({ ...mango, _id: `m${index}`, name: `Item ${index}`, offer: null }));
    const html = bestPage(ready([promotion({ products, promotionType: 'display_only', discount: null })]));
    assert.equal(html.match(/class="product-card is-compact"/g).length, 30);
  });

  it('an untitled Best Deals promotion needs no heading of its own, and shows no stray text', () => {
    const html = bestPage(ready([promotion({ title: '', description: '', bannerImage: '' })]));
    assert.ok(!/undefined|null|<h2><\/h2>/.test(html));
    assert.ok(!/deal-group-head/.test(html));
    assert.match(html, /Mango/);
  });

  it('Seasonal Deals shows each campaign banner with its own products beneath', () => {
    const html = seasonPage(ready([
      promotion({ _id: 'a', section: 'seasonal_deals', title: 'Mango Season', bannerImage: 'data:image/png;base64,AAAA' }),
      promotion({ _id: 'b', section: 'seasonal_deals', title: 'Monsoon Offers', products: [{ ...mango, _id: 'p9', name: 'Corn' }] }),
    ]));
    assert.match(html, /<h1>Seasonal Deals<\/h1>/);
    assert.ok(html.indexOf('Mango Season') < html.indexOf('Mango<') && html.indexOf('Mango<') < html.indexOf('Monsoon Offers') && html.indexOf('Monsoon Offers') < html.indexOf('Corn'));
    assert.match(html, /background-image:url\(&quot;data:image\/png;base64,AAAA&quot;\)/);
    assert.ok(!/Explore Deals/.test(html), 'the page already is the destination');
  });

  it('an untitled campaign uses the section heading on its page', () => {
    const html = seasonPage(ready([promotion({ section: 'seasonal_deals', title: '' })]));
    assert.match(html, /<h2>Seasonal Deals<\/h2>/);
  });
});

describe('order history shows the pricing snapshot', () => {
  const baseOrder = { _id: 'o1', orderType: 'normal', orderStatus: 'placed', user: { firstName: 'A', lastName: 'B' }, createdAt: new Date().toISOString(), deliveryDate: new Date().toISOString(), deliveryAddress: { recipient: 'A', phone: '9876543210', street: 'S', postalCode: '411001' }, paymentMethod: 'cod', paymentStatus: 'pending', statusHistory: [] };
  const modal = (order) => render(h(mods.OrderDetailsModal, { order, onClose() {}, onStatusChange() {}, busy: false }), owner);

  it('shows list price, offer name, discount and payable subtotal for a discounted order', () => {
    const html = modal({ ...baseOrder, totalAmount: 185, items: [{ name: 'Mango', unit: 'kg', quantity: 2, price: 80, originalPrice: 100, discountPerUnit: 20, discountTotal: 40, lineTotal: 160, promotion: { id: 'd1', title: 'Mango Season', section: 'best_deals' } }] });
    assert.match(html, /list price ₹100/);
    assert.match(html, /Offer: Mango Season/);
    assert.match(html, /Offer discount/);
    assert.match(html, /Original subtotal/);
    assert.match(html, /Payable subtotal/);
    assert.match(html, /₹185/);
  });

  it('still renders an order placed before promotions existed, with no discount lines', () => {
    const html = modal({ ...baseOrder, totalAmount: 125, items: [{ name: 'Mango', unit: 'kg', quantity: 2, price: 50 }] });
    assert.match(html, /Mango/);
    assert.match(html, /₹125/);
    assert.ok(!/list price|Offer discount|Original subtotal|Payable subtotal/.test(html));
  });
});

describe('Deals Management in the admin panel', () => {
  const links = (user) => [...render(h(mods.AdminSidebar, { open: true }), user, '/admin').matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

  it('is in the sidebar for the owner only', () => {
    assert.ok(links(owner).includes('/admin/deals'));
    for (const user of [staff(['orders:view']), staff(['products:view', 'products:manage', 'categories:manage']), staff(['bulk:view', 'bulk:update'])]) assert.ok(!links(user).includes('/admin/deals'));
  });

  it('is an owner-only item, so staff are never routed to it', () => {
    const item = mods.adminNavigation.flatMap((group) => group.items).find((entry) => entry.path === '/admin/deals');
    assert.deepEqual(item.access, { owner: true });
  });

  it('renders the page shell with both tabs', () => {
    const html = render(h(mods.AdminDealsPage), owner, '/admin/deals');
    assert.match(html, /Deals Management/);
    assert.match(html, />Best Deals</);
    assert.match(html, />Seasonal Deals</);
  });
});

describe('there is only one Best Deals and one Seasonal Deals implementation', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
  const sources = walk(srcDir).filter((file) => /\.(jsx?|mjs)$/.test(file)).map((file) => ({ file: file.slice(srcDir.length), text: readFileSync(file, 'utf8') }));
  const filesWith = (pattern) => sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();

  it('the homepage featured-products block is plain product discovery named Fresh Picks', async () => {
    const html = render(h(mods.HomePage), null, '/');
    assert.match(html, /Fresh Picks/);
    assert.ok(!/Best Deals|Seasonal Deals|GOOD DEALS/.test(html), 'with no eligible promotions the homepage shows no deals heading at all');
  });

  it('exactly one component renders each homepage deals heading', () => {
    assert.deepEqual(filesWith(/<h2>Best Deals<\/h2>/), ['components/Deals.jsx']);
    assert.deepEqual(filesWith(/dealTitle\(promotion, 'Seasonal Deals'\)/), ['components/Deals.jsx']);
  });

  it('the homepage gets its promotions only from the public promotions API', () => {
    assert.deepEqual(filesWith(/\/promotions\//), ['components/Deals.jsx']);
    assert.deepEqual(filesWith(/useDeals\(/), ['components/Deals.jsx', 'pages/StorePages.jsx']);
    assert.ok(/from '\.\.\/components\/Deals'/.test(sources.find(({ file }) => file === 'pages/StorePages.jsx').text));
  });

  it('promotions are managed only through the Deals Management admin API', () => {
    assert.deepEqual(filesWith(/api\.\w+\([`'"]\/admin\/deals/), ['components/DealProductPicker.jsx', 'pages/AdminDealsPage.jsx'], 'only Deals Management (its page and product picker) calls the admin deals API');
    assert.deepEqual(filesWith(/label: 'Deals Management'/), ['components/adminNavigation.js'], 'one sidebar entry');
    assert.deepEqual(filesWith(/path="admin\/deals"/), ['App.jsx'], 'one route');
  });
});

describe('promotional placement UI', () => {
  const noop = () => {}
  it('Product Edit shows Promotional Placement to the owner, with the current selections', () => {
    const product = { _id: 'p1', name: 'Mango', category: 'Fruits', description: 'd', price: 10, unit: 'kg', stock: 1, images: [], vendors: [], dealPlacements: { bestDeals: true, seasonalDeals: false } };
    const html = render(h(mods.ProductFormModal, { product, onClose: noop, onSaved: noop }), owner, '/admin/products');
    assert.match(html, /Promotional Placement/);
    assert.match(html, /Best Deals/);
    assert.match(html, /Seasonal Deals/);
    assert.match(html, /Neither/);
    assert.match(html, /does not change its price/);
    const checked = [...html.matchAll(/<label class="placement-choice( selected)?"><input type="checkbox"[^>]*>(?:<span>([^<]+)<\/span>)/g)].map((m) => [m[2], Boolean(m[1])]);
    assert.deepEqual(checked, [['Best Deals', true], ['Seasonal Deals', false], ['Neither', false]]);
  });

  it('a product with no placement shows Neither selected', () => {
    const html = render(h(mods.ProductFormModal, { product: null, onClose: noop, onSaved: noop }), owner, '/admin/products');
    assert.match(html, /placement-choice selected"><input type="checkbox" checked=""[^>]*><span>Neither/);
  });

  it('staff without owner access never see the placement section', () => {
    const html = render(h(mods.ProductFormModal, { product: null, onClose: noop, onSaved: noop }), staff(['products:view', 'products:manage']), '/admin/products');
    assert.ok(!/Promotional Placement/.test(html));
  });

  it('the Add Products picker names the target promotion and explains what is selectable', () => {
    const promotions = [{ _id: 'a1', title: 'Summer', isActive: true }, { _id: 'a2', title: 'Old one', isActive: false }];
    const html = render(h(mods.DealProductPicker, { section: 'best_deals', name: 'Best Deals', promotions, initialPromotionId: 'a2', onClose: noop, onChanged: noop }), owner, '/admin/deals');
    assert.match(html, /Add products to Best Deals/);
    assert.match(html, /Summer/);
    assert.match(html, /Old one \(inactive\)/);
    assert.match(html, /Marked for Best Deals/);
    assert.match(html, /Add selected \(0\)/);
    assert.match(html, /Remove selected \(0\)/);
  });

  it('with no promotion yet the picker creates nothing and says why', () => {
    const html = render(h(mods.DealProductPicker, { section: 'seasonal_deals', name: 'Seasonal Deals', promotions: [], onClose: noop, onChanged: noop }), owner, '/admin/deals');
    assert.match(html, /No Seasonal Deals promotion yet/);
    assert.match(html, /Nothing is created automatically/);
    assert.ok(!/Add selected/.test(html));
  });

  it('Deals Management offers Add Products on each tab', () => {
    const html = render(h(mods.AdminDealsPage), owner, '/admin/deals');
    assert.ok(readFileSync(fileURLToPath(new URL('../src/pages/AdminDealsPage.jsx', import.meta.url)), 'utf8').includes('Add Products'));
    assert.match(html, /Deals Management/);
  });
});

describe('homepage order and public routes', () => {
  const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

  it('the homepage runs hero, Seasonal Deals, Best Deals, then the existing sections', () => {
    const home = read('pages/StorePages.jsx');
    const at = (text) => home.indexOf(text);
    assert.ok(at('className="home-hero') < at('<SeasonalDeals ') && at('<SeasonalDeals ') < at('<BestDeals ') && at('<BestDeals ') < at('className="trust-strip'));
    assert.ok(at('className="trust-strip') < at('id="categories"') && at('id="categories"') < at('Fresh Picks'));
    assert.equal(home.match(/<SeasonalDeals /g).length, 1);
    assert.equal(home.match(/<BestDeals /g).length, 1);
  });

  it('/best-deals and /seasonal-deals are public routes inside the storefront layout', () => {
    const app = read('App.jsx');
    const protectedAt = app.indexOf('<ProtectedRoute />');
    for (const path of ['best-deals', 'seasonal-deals']) {
      const at = app.indexOf(`path="${path}"`);
      assert.ok(at > 0 && at < protectedAt, `${path} must not sit behind sign-in`);
    }
  });
});

describe('the compact deal card is opt-in', () => {
  it('shows the weight under the name and drops the rating row only when compact', () => {
    const compact = render(h(mods.ProductCard, { product: { ...mango, offer: percentOffer }, compact: true }));
    assert.match(compact, /product-card is-compact/);
    assert.match(compact, /<span class="deal-unit">1 kg<\/span>/);
    assert.ok(!/product-rating/.test(compact));
    assert.match(compact, /20% OFF — Save ₹20/);
    assert.match(compact, /aria-label="Add Mango to cart"/);
  });

  it('leaves every ordinary product card exactly as it was', () => {
    const normal = render(h(mods.ProductCard, { product: mango }));
    assert.ok(!/product-card is-compact|deal-unit/.test(normal));
    assert.match(normal, /product-rating/);
    assert.match(normal, /product-category/);
  });
});

describe('Seasonal Deals banner products', () => {
  const PNG = 'data:image/png;base64,AAAA';
  const item = (id, name, extra = {}) => ({ ...mango, _id: id, name, offer: null, ...extra });
  const three = [item('a', 'Diya Set'), item('b', 'Sweets Box', { offer: percentOffer, price: 100 }), item('c', 'Rangoli Kit', { unit: 'pack' })];
  const campaign = (bannerProducts, extra = {}) => ({ _id: 's1', title: 'Diwali Specials', description: '', bannerImage: PNG, badgeText: '', section: 'seasonal_deals', promotionType: 'display_only', discount: null, endAt: new Date(Date.now() + 3600e3).toISOString(), products: bannerProducts || [], bannerProducts, ...extra });
  const home = (promotion) => render(h(mods.SeasonalDeals, { promotions: [promotion] }));

  it('puts the title in the centre of the background image, with the three product cards directly below it', () => {
    const html = home(campaign(three));
    assert.match(html, /style="background-image:url\(&quot;data:image\/png;base64,AAAA&quot;\)"/);
    assert.ok(!/<img src="data:image/.test(html), 'the background is not a small separate image');
    assert.ok(html.indexOf('<h2>Diwali Specials</h2>') < html.indexOf('seasonal-products'));
    assert.equal(html.match(/class="product-card is-compact"/g).length, 3);
    for (const name of ['Diya Set', 'Sweets Box', 'Rangoli Kit']) assert.ok(html.includes(name), name);
  });

  it('each card shows its weight, price and, only for an actual discount, the saving below the image', () => {
    const html = home(campaign(three));
    assert.match(html, /<span class="deal-unit">1 pack<\/span>/);
    assert.equal(html.match(/offer-pill/g).length, 1, 'only the discounted product shows a saving');
    assert.match(html, /20% OFF — Save ₹20/);
    assert.match(html, /<s class="original-price">₹100<\/s>/);
    assert.ok(!/OFF|offer-pill/.test(photoOf(html)), 'no discount sticker on the image');
  });

  it('each card links to the existing product page and keeps Add to cart', () => {
    const html = home(campaign(three));
    assert.match(html, /href="\/product\/a"/);
    assert.match(html, /href="\/product\/c"/);
    assert.match(html, /aria-label="Add Diya Set to cart"/);
  });

  it('shows only the products it is given: never more than three, never filler', () => {
    const many = [...three, item('d', 'Fourth'), item('e', 'Fifth')];
    assert.equal(home(campaign(many)).match(/class="product-card is-compact"/g).length, 3);
    assert.equal(home(campaign(three.slice(0, 1))).match(/class="product-card is-compact"/g).length, 1);
    const none = home(campaign([]));
    assert.ok(!/seasonal-products/.test(none), 'no visible products means no card row');
    assert.match(none, /<h2>Diwali Specials<\/h2>/, 'the campaign still shows gracefully');
    assert.ok(!/seasonal-products/.test(home(campaign(undefined))));
  });

  it('the Seasonal Deals page lists every campaign product itself, not only the banner ones', () => {
    const all = [...three, item('d', 'Hidden One'), item('e', 'Hidden Two')];
    const html = render(h(mods.SeasonalDealsView, { state: { status: 'ready', enabled: true, reload() {}, promotions: [campaign(three, { products: all })] } }));
    assert.equal(html.match(/class="product-card is-compact"/g).length, 5);
    assert.ok(html.includes('Hidden One') && html.includes('Hidden Two'));
    assert.ok(!/seasonal-products/.test(html), 'the page banner does not repeat the products');
    assert.match(html, /background-image/);
  });

  it('the admin preview shows the same layout with inert cards', () => {
    const html = render(h(mods.SeasonalBanner, { promotion: campaign(three), preview: true }));
    assert.match(html, /seasonal-banner has-bg is-preview/);
    assert.equal(html.match(/class="product-card is-compact"/g).length, 3);
  });

  it('an older campaign with only the former banner image and no banner products still renders', () => {
    const html = home({ ...campaign(undefined), title: 'Mango Season', bannerProducts: undefined });
    assert.match(html, /<h2>Mango Season<\/h2>/);
    assert.match(html, /has-bg/);
    assert.ok(!/undefined|null/.test(html));
  });

  it('the Deals Management form has the compulsory product section, the per-product checkbox and the Background Image', () => {
    const page = readFileSync(fileURLToPath(new URL('../src/pages/AdminDealsPage.jsx', import.meta.url)), 'utf8');
    for (const text of ["'Select Seasonal Deal Products'", 'Show on Seasonal Deals homepage', 'Please select at least ${MIN_SEASONAL_PRODUCTS} products for a Seasonal Deal.', "'Background Image'", '} selected', 'homepageHidden']) assert.ok(page.includes(text), text);
    assert.ok(/form\.products\.length < MIN_SEASONAL_PRODUCTS\) \{ setError\(SEASONAL_MIN_MESSAGE\); return \}/.test(page), 'saving is blocked before any request is sent');
  });
});


describe('ADD -> quantity stepper on deal product cards', () => {
  const inCart = (quantity, product = mango) => { globalThis.__testCartItems = [{ product, quantity }]; };
  const card = (extra = {}, user = { _id: 'u1', role: 'customer' }) => render(h(mods.ProductCard, { product: mango, compact: true, ...extra }), user);
  afterEach(() => { globalThis.__testCartItems = []; });

  it('starts as ADD only, with no quantity selector', () => {
    const html = card();
    assert.match(html, />ADD<\/button>/);
    assert.ok(!/deal-stepper|Decrease|Increase/.test(html));
  });

  it('shows the real cart quantity as - n + when the product is already in the cart', () => {
    inCart(3);
    const html = card();
    assert.match(html, /class="deal-stepper"/);
    assert.match(html, /<span aria-live="polite">3<\/span>/);
    assert.ok(!/>ADD</.test(html));
    assert.match(html, /aria-label="Decrease Mango quantity"/);
    assert.match(html, /aria-label="Increase Mango quantity"/);
  });

  it('is driven by the cart, so another page or a refresh shows the same quantity', () => {
    inCart(2);
    assert.match(card(), /aria-live="polite">2</);
    assert.match(card({ product: { ...mango, offer: percentOffer } }), /aria-live="polite">2</, 'also with a promotion price');
    globalThis.__testCartItems = [{ product: { ...mango, _id: 'other' }, quantity: 5 }];
    assert.match(card(), />ADD</, 'a different product in the cart does not affect this card');
  });

  it('cannot go above the available stock, and an out-of-stock product cannot be added', () => {
    inCart(20);
    assert.match(card(), /aria-label="Increase Mango quantity" disabled/);
    inCart(5, { ...mango, stock: 5 });
    assert.match(card({ product: { ...mango, stock: 5 } }), /aria-label="Increase Mango quantity" disabled/);
    globalThis.__testCartItems = [];
    const sold = card({ product: { ...mango, stock: 0 } });
    assert.match(sold, /disabled=""[^>]*aria-label="Mango is sold out"|aria-label="Mango is sold out"[^>]*disabled=""/);
    assert.match(sold, /Sold out/);
    assert.ok(!/deal-stepper/.test(sold));
  });

  it('maps each click to the existing cart calls: add one, set a quantity, remove at zero, never negative', () => {
    assert.equal(mods.cartActionFor(0, 1), 'add');
    assert.equal(mods.cartActionFor(1, 2), 'set');
    assert.equal(mods.cartActionFor(2, 1), 'set');
    assert.equal(mods.cartActionFor(1, 0), 'remove');
    assert.equal(mods.cartActionFor(0, -1), 'none');
    assert.equal(mods.cartActionFor(1, -3), 'remove');
  });

  it('applies to the Best Deals, Seasonal Deals and dedicated page cards', () => {
    inCart(2);
    const deal = promotion({ products: [mango] });
    assert.match(render(h(mods.BestDeals, { promotions: [deal] })), /class="deal-stepper"/);
    assert.match(render(h(mods.SeasonalDeals, { promotions: [{ ...deal, section: 'seasonal_deals', bannerProducts: [mango] }] })), /class="deal-stepper"/);
    assert.match(render(h(mods.BestDealsView, { state: { status: 'ready', enabled: true, reload() {}, promotions: [deal] } })), /class="deal-stepper"/);
    assert.match(render(h(mods.SeasonalDealsView, { state: { status: 'ready', enabled: true, reload() {}, promotions: [{ ...deal, section: 'seasonal_deals' }] } })), /class="deal-stepper"/);
  });

  it('leaves ordinary product cards exactly as they were (quantity selector plus Add)', () => {
    inCart(2);
    const html = card({ compact: false });
    assert.ok(!/deal-stepper/.test(html));
    assert.match(html, /quantity-selector is-compact/);
    assert.match(html, />Add<\/button>/);
  });
});
