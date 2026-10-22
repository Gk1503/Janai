import { Link } from 'react-router-dom'
import { ArrowLeft, LogOut, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { MyPermissions } from './DeliveryDashboardPage'

// Personal settings for a delivery rider. Reuses DeliveryLayout (mounted the same way as the dashboard
// in App.jsx) — route-level access (role 'staff' + delivery:view) is already enforced by
// <DeliveryProtectedRoute />, unchanged.
export default function DeliverySettingsPage() {
  const { user, can, logout } = useAuth()
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Delivery Partner'
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'D'

  return <div className="rider-dashboard">
    <Link to="/delivery" className="adm-back-link"><ArrowLeft size={15} />Back to My Deliveries</Link>
    <div className="rider-dashboard-head"><h1>Settings</h1><p>Your account details and access.</p></div>

    <section className="adm-panel rider-account-summary">
      <span className="rider-avatar rider-account-avatar">{initials}</span>
      <div><strong>{name}</strong><small>Delivery Partner</small></div>
    </section>

    <section className="adm-panel">
      <h2 className="adm-modal-section-title">Account details</h2>
      <div className="adm-profile-grid">
        <div className="adm-profile-item"><span className="adm-profile-icon"><UserRound size={16} /></span><div className="adm-profile-item-body"><small>Login ID</small><strong>{user?.adminId || '—'}</strong></div></div>
        {user?.phone && <div className="adm-profile-item"><span className="adm-profile-icon"><Phone size={16} /></span><div className="adm-profile-item-body"><small>Registered mobile</small><strong>+91 {user.phone}</strong></div></div>}
        <div className="adm-profile-item"><span className="adm-profile-icon"><ShieldCheck size={16} /></span><div className="adm-profile-item-body"><small>Status</small><strong>{user?.isActive === false ? 'Inactive' : 'Active'}</strong></div></div>
      </div>
      {/* Delivery staff sign in by OTP only, never email/password — no login form or credential edit is shown here. */}
    </section>

    <MyPermissions can={can} />

    <section className="adm-panel">
      <button type="button" className="button button-outline" onClick={logout}><LogOut size={16} />Logout</button>
    </section>
  </div>
}
