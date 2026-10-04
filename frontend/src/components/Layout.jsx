import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarDays, CircleUserRound, Heart, Home, Leaf, Menu, Package, Search, ShoppingBag, ShoppingCart, X } from 'lucide-react'
import { useAuth, useCart } from '../context/AppContexts'

const navItems = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/shop', label: 'Shop', icon: ShoppingBag },
  { to: '/pre-orders', label: 'Pre Orders', icon: CalendarDays },
  { to: '/bulk-orders', label: 'Bulk Orders', icon: Package },
]
const titles = { '/shop': 'Shop', '/cart': 'My Cart', '/pre-orders': 'Pre Orders', '/bulk-orders': 'Bulk Orders', '/orders': 'My Orders', '/profile': 'My Profile', '/about': 'About Janai', '/contact': 'Contact', '/login': 'Login', '/register': 'Create Account' }

function Logo({ className = '' }) {
  return <Link className={`brand-logo ${className}`} to="/" aria-label="Janai home"><img src="/Janai-logo.jpg" alt="Janai, Fruits Vegetables Groceries" /></Link>
}

function CartLink() {
  const { count } = useCart()
  return <Link className="nav-icon cart-link" to="/cart" aria-label={`Cart, ${count} items`}><ShoppingCart size={19} /><span className="cart-count">{count > 99 ? '99+' : count}</span></Link>
}

function Navbar() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const productPage = pathname.startsWith('/product/') || pathname.startsWith('/products/')
  const isHome = pathname === '/'
  const title = productPage ? 'Product Details' : pathname.startsWith('/orders/') ? 'Order Details' : titles[pathname] || 'Janai'
  const submit = (event) => {
    event.preventDefault()
    navigate(`/shop${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
  }
  const account = user ? '/profile' : '/login'

  return <header className="site-header">
    <div className="mobile-header">
      {isHome ? <button className="icon-button" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button> : <button className="icon-button" aria-label="Go back" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>}
      {isHome ? <Logo className="mobile-logo" /> : <strong className="mobile-page-title">{title}</strong>}
      {productPage ? <button className="icon-button" aria-label="Save product"><Heart size={19} /></button> : <CartLink />}
    </div>
    <div className="desktop-header page-container">
      <Logo className="desktop-logo" />
      <nav className="desktop-links" aria-label="Main navigation">{navItems.map(({ to, label, end }) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}<NavLink to="/about">About</NavLink><NavLink to="/contact">Contact</NavLink></nav>
      <form className="nav-search" onSubmit={submit}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search produce" aria-label="Search products" /><button aria-label="Submit search"><Search size={15} /></button></form>
      <Link className="account-link" to={account}><CircleUserRound size={18} />{user ? 'Account' : 'Sign in'}</Link>
      <CartLink />
    </div>
    <form className="mobile-search" onSubmit={submit}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fruits, vegetables, groceries..." aria-label="Search products" /><button aria-label="Search"><Search size={16} /></button></form>
    {menuOpen && <nav className="mobile-menu" aria-label="More navigation">{[...navItems, { to: '/about', label: 'About' }, { to: '/contact', label: 'Contact' }].map(({ to, label }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>{label}<ArrowLeft size={14} /></NavLink>)}</nav>}
  </header>
}

function MobileBottomNav() {
  const { user } = useAuth()
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{[...navItems, { to: user ? '/profile' : '/login', label: 'Account', icon: CircleUserRound }].map(({ to, label, icon: Icon, end }) => <NavLink key={label} to={to} end={end} className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-inner page-container"><div><Logo className="footer-logo" /><p>Fresh picks from growers and makers we trust.</p></div><div><h3>Shop Janai</h3><Link to="/shop">All produce</Link><Link to="/pre-orders">Pre-orders</Link><Link to="/bulk-orders">Bulk orders</Link></div><div><h3>About</h3><Link to="/about">Our story</Link><Link to="/contact">Contact us</Link><Link to="/orders">Track an order</Link></div><div className="footer-motto"><Leaf size={18} /><span>Freshness at your doorstep</span></div></div><div className="footer-bottom page-container">© {new Date().getFullYear()} Janai Foods</div></footer>
}

export default function Layout() {
  const { pathname } = useLocation()
  const authPage = ['/login', '/register'].includes(pathname)
  return <div className="app-shell">{!authPage && <Navbar />}<main><Outlet /></main>{!authPage && <Footer />}{!authPage && <MobileBottomNav />}</div>
}
