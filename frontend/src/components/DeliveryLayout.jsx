import { Link, Outlet } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { useBusinessSettings } from '../hooks/useBusinessSettings'
import { Logo } from './Layout'

// Dedicated chrome for the rider portal: logo + identity + logout only. No admin sidebar, no customer
// shop navigation/cart/footer. DeliveryProtectedRoute (the layout route above this one) handles logging
// out automatically redirecting to /delivery/login once `user` clears, same as AdminSidebar's logout.
export default function DeliveryLayout() {
  const { user, logout } = useAuth()
  // Same shared fetch/cache the storefront and admin panel use — no extra request here either, and the
  // owner's General Settings save invalidates it, so the next rider-portal load shows new branding.
  const { businessName } = useBusinessSettings()
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'D'
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Delivery Partner'

  return <div className="rider-shell">
    <header className="rider-header">
      <Logo className="rider-logo" to="/delivery" alt={businessName} label={`${businessName} delivery home`} />
      <div className="rider-header-identity">
        <span className="rider-avatar">{initials}</span>
        <span className="rider-header-text"><strong>{name}</strong><small>Delivery Partner</small></span>
      </div>
      <Link to="/delivery/settings" className="rider-icon-link" aria-label="Settings"><Settings size={18} /></Link>
      <button type="button" className="rider-logout" onClick={logout} aria-label="Log out of the delivery portal"><LogOut size={18} /><span>Logout</span></button>
    </header>
    <main className="rider-main"><Outlet /></main>
  </div>
}
