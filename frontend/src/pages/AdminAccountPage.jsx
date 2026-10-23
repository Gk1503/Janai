import { Navigate } from 'react-router-dom'
import { LogOut, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { ROLE_PRESETS } from '../utils/permissions'
import { MyPermissions } from './DeliveryDashboardPage'
import ChangePasswordForm from '../components/ChangePasswordForm'

// Personal settings for a staff account that uses the admin panel (reuses AdminLayout — no route-level
// access check needed here beyond what <ProtectedRoute admin /> already enforces in App.jsx: any active
// staff or the owner). The owner's own "settings" are the business ones, so they land on /admin/settings
// instead of an otherwise-empty personal page.
export default function AdminAccountPage() {
  const { user, can, isOwner, logout } = useAuth()
  if (isOwner) return <Navigate to="/admin/settings" replace />

  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Staff'
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'S'
  const presetLabel = ROLE_PRESETS[user?.staffRole]?.label || 'Custom Role'

  return <div className="adm-account-page">
    <div className="adm-page-head"><div><h1>My Account</h1><p>Your personal account details and access.</p></div></div>

    <section className="adm-panel adm-account-summary">
      <span className="adm-avatar adm-account-avatar">{initials}</span>
      <div><strong>{name}</strong><small>{presetLabel}</small></div>
    </section>

    <section className="adm-panel">
      <h2 className="adm-modal-section-title">Account details</h2>
      <div className="adm-profile-grid">
        <div className="adm-profile-item"><span className="adm-profile-icon"><UserRound size={16} /></span><div className="adm-profile-item-body"><small>Login ID</small><strong>{user?.adminId || '—'}</strong></div></div>
        {user?.email && <div className="adm-profile-item"><span className="adm-profile-icon"><Mail size={16} /></span><div className="adm-profile-item-body"><small>Email</small><strong>{user.email}</strong></div></div>}
        {user?.phone && <div className="adm-profile-item"><span className="adm-profile-icon"><Phone size={16} /></span><div className="adm-profile-item-body"><small>Phone</small><strong>{user.phone}</strong></div></div>}
        <div className="adm-profile-item"><span className="adm-profile-icon"><ShieldCheck size={16} /></span><div className="adm-profile-item-body"><small>Status</small><strong>{user?.isActive === false ? 'Inactive' : 'Active'}</strong></div></div>
      </div>
      {/* No edit controls: PUT /auth/me explicitly rejects staff profile edits today (see authController.js), so nothing here is presented as editable or saveable. */}
    </section>

    {/* A staff member cannot edit their own identity (PUT /auth/me rejects that, unchanged), but they
        can change their own password: POST /auth/change-password authorises by session, not by role. */}
    <section className="adm-panel">
      <h2 className="adm-modal-section-title">Change password</h2>
      <p className="adm-muted">Updates the password you sign in with. You stay signed in on this device.</p>
      <ChangePasswordForm />
    </section>

    <MyPermissions can={can} />

    <section className="adm-panel">
      <button type="button" className="button button-outline" onClick={logout}><LogOut size={16} />Logout</button>
    </section>
  </div>
}
