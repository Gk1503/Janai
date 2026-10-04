import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { adminNav } from './adminNav'
import './admin.css'

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const current = adminNav.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
  const title = current?.label || 'Admin'
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`

  function signOut() {
    logout()
    navigate('/')
  }

  return <div className="adm-shell">
    <button type="button" className={`adm-backdrop${menuOpen ? ' is-visible' : ''}`} aria-label="Close menu" tabIndex={menuOpen ? 0 : -1} onClick={() => setMenuOpen(false)} />
    <aside className={`adm-sidebar${menuOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
      <div className="adm-sidebar-top">
        <Link className="adm-brand" to="/admin" aria-label="Janai admin dashboard"><img src="/Janai-logo.jpg" alt="Janai" /></Link>
        <button type="button" className="adm-icon-button adm-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
      </div>
      <nav className="adm-nav">
        {adminNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="adm-sidebar-foot">
        <Link to="/" className="adm-store-link"><ArrowLeft size={15} />Back to store</Link>
      </div>
    </aside>
    <div className="adm-main">
      <header className="adm-topbar">
        <button type="button" className="adm-icon-button adm-menu-toggle" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <h1 className="adm-topbar-title">{title}</h1>
        <div className="adm-topbar-actions">
          <div className="adm-user"><span className="adm-avatar">{initials || 'A'}</span><span className="adm-user-text"><strong>{user?.firstName} {user?.lastName}</strong><small>Administrator</small></span></div>
          <button type="button" className="adm-icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button>
        </div>
      </header>
      <main className="adm-body">
        <Outlet />
      </main>
    </div>
  </div>
}
