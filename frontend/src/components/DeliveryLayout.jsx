import { Link, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../context/AppContexts'

// Dedicated chrome for the rider portal: logo + identity + logout only. No admin sidebar, no customer
// shop navigation/cart/footer. DeliveryProtectedRoute (the layout route above this one) handles logging
// out automatically redirecting to /delivery/login once `user` clears, same as AdminSidebar's logout.
export default function DeliveryLayout() {
  const { user, logout } = useAuth()
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'D'
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Delivery Partner'

  return <div className="rider-shell">
    <header className="rider-header">
      <Link className="brand-logo rider-logo" to="/delivery" aria-label="Janai delivery home"><img src="/Janai-logo.jpg" alt="Janai" /></Link>
      <div className="rider-header-identity">
        <span className="rider-avatar">{initials}</span>
        <span className="rider-header-text"><strong>{name}</strong><small>Delivery Partner</small></span>
      </div>
      <button type="button" className="rider-logout" onClick={logout} aria-label="Log out of the delivery portal"><LogOut size={18} /><span>Logout</span></button>
    </header>
    <main className="rider-main"><Outlet /></main>
  </div>
}
