import { useState } from 'react'
import { Bell, CreditCard, ShieldCheck, Store, Truck } from 'lucide-react'
import { EmptyState } from '../components/UI'
import GeneralSettingsForm from '../components/GeneralSettingsForm'
import OrderDeliverySettingsForm from '../components/OrderDeliverySettingsForm'
import NotificationSettingsForm from '../components/NotificationSettingsForm'
import ChangePasswordForm from '../components/ChangePasswordForm'

// Route-level access (owner-only) is enforced by <RequirePermission ownerOnly /> in App.jsx, the same
// guard already used for /admin/staff and /admin/delivery-staff — never rely on this page, or on the
// sidebar link being hidden, to keep non-owner staff out.
const CATEGORIES = [
  { key: 'general', label: 'General', icon: Store, description: 'Store identity, contact details and basic business information.' },
  { key: 'orders-delivery', label: 'Orders & Delivery', icon: Truck, description: 'Delivery fee rules, time slots and order workflow defaults.' },
  { key: 'payments', label: 'Payments', icon: CreditCard, description: 'Accepted payment methods and related configuration.' },
  { key: 'notifications', label: 'Notifications', icon: Bell, description: 'Alerts and messages sent to staff and customers.' },
  { key: 'security-system', label: 'Security & System', icon: ShieldCheck, description: 'Account security, sessions and system-level configuration.' },
]

export default function AdminSettingsPage() {
  const [activeKey, setActiveKey] = useState(CATEGORIES[0].key)
  const active = CATEGORIES.find((category) => category.key === activeKey) || CATEGORIES[0]

  return <div className="adm-settings-page">
    <div className="adm-page-head"><div><h1>Settings</h1><p>Business-wide configuration for Janai.</p></div></div>
    <div className="adm-settings-layout">
      <nav className="adm-settings-nav" aria-label="Settings categories">
        {CATEGORIES.map((category) => <button type="button" key={category.key} className={`adm-settings-nav-item${category.key === activeKey ? ' active' : ''}`} aria-current={category.key === activeKey ? 'page' : undefined} onClick={() => setActiveKey(category.key)}>
          <category.icon size={16} />{category.label}
        </button>)}
      </nav>
      <section className="adm-panel adm-settings-content">
        <h2 className="adm-modal-section-title">{active.label}</h2>
        <p className="adm-muted">{active.description}</p>
        {active.key === 'general' ? <GeneralSettingsForm /> : active.key === 'orders-delivery' ? <OrderDeliverySettingsForm /> : active.key === 'notifications' ? <NotificationSettingsForm /> : active.key === 'security-system' ? (
          <div className="adm-settings-subsection adm-settings-first">
            <h3>Change Password</h3>
            <p className="adm-muted">Updates the password for the account you are signed in as. You stay signed in on this device.</p>
            <ChangePasswordForm />
          </div>
        ) : (
          // Placeholder only — no persistence exists yet for these remaining categories, so no inputs,
          // toggles or save actions are shown here.
          <EmptyState icon={active.icon} title={`${active.label} is not configured yet`} message="This section will let you manage these settings in a future update. Nothing here can be changed yet." />
        )}
      </section>
    </div>
  </div>
}
