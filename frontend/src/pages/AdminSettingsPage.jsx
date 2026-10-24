import { useRef, useState } from 'react'
import { Bell, CreditCard, ShieldCheck, Store, Truck } from 'lucide-react'
import { EmptyState } from '../components/UI'
import GeneralSettingsForm from '../components/GeneralSettingsForm'
import OrderDeliverySettingsForm from '../components/OrderDeliverySettingsForm'
import NotificationSettingsForm from '../components/NotificationSettingsForm'
import ChangePasswordForm from '../components/ChangePasswordForm'
import SettingsNavGuardDialog from '../components/SettingsNavGuardDialog'
import { decideCategorySwitch } from '../utils/settingsNavGuard'

// Route-level access (owner-only) is enforced by <RequirePermission ownerOnly /> in App.jsx, the same
// guard already used for /admin/staff and /admin/delivery-staff — never rely on this page, or on the
// sidebar link being hidden, to keep non-owner staff out.
//
// `hasForm` marks the categories backed by a real editable form — the only ones whose formGuardRef
// value is ever trusted (see requestSwitch below). A category with no form (Payments today, any future
// placeholder) is always safe to leave, regardless of whatever a previously active form last left in
// that ref.
const CATEGORIES = [
  { key: 'general', label: 'General', icon: Store, description: 'Store identity, contact details and basic business information.', hasForm: true },
  { key: 'orders-delivery', label: 'Orders & Delivery', icon: Truck, description: 'Delivery fee rules, time slots and order workflow defaults.', hasForm: true },
  { key: 'payments', label: 'Payments', icon: CreditCard, description: 'Accepted payment methods and related configuration.' },
  { key: 'notifications', label: 'Notifications', icon: Bell, description: 'Alerts and messages sent to staff and customers.', hasForm: true },
  { key: 'security-system', label: 'Security & System', icon: ShieldCheck, description: 'Account security, sessions and system-level configuration.', hasForm: true },
]

export default function AdminSettingsPage() {
  const [activeKey, setActiveKey] = useState(CATEGORIES[0].key)
  // The category the owner tried to switch to while the active form was dirty; non-null means the
  // dialog is open. Only one form is ever mounted at a time, so one shared ref is unambiguous — see
  // formGuardRef below.
  const [pendingKey, setPendingKey] = useState(null)
  const [dialogSaving, setDialogSaving] = useState(false)
  // Whatever the currently-mounted form last exposed via registerSettingsFormGuard: {dirty, saving,
  // save}. Written during the active form's own render (it owns this ref only as a prop, never creates
  // or writes it itself — see hooks/useSettingsFormGuard.js), so this is always current by the time a
  // nav click reads it. This component itself never reads or writes `.current` during render — only
  // inside requestSwitch below, an event handler, which is the place React's own guidance names as safe.
  const formGuardRef = useRef(null)
  const active = CATEGORIES.find((category) => category.key === activeKey) || CATEGORIES[0]

  function requestSwitch(nextKey) {
    // Reading `.current` here, not during render: this runs only in response to a click. A category
    // with no form (active.hasForm is falsy) never consults the ref at all — whatever stale handle a
    // previously active form may have left there is simply never looked at, so it can't matter.
    const guard = active.hasForm ? formGuardRef.current : null
    const decision = decideCategorySwitch(guard, activeKey, nextKey)
    if (decision === 'confirm') setPendingKey(nextKey)
    else if (decision === 'switch') setActiveKey(nextKey)
    // 'none' (already active) and 'blocked' (a save is in flight) both do nothing — in particular,
    // 'blocked' never offers a dialog, so an in-flight save can't be interrupted or raced.
  }

  function stayEditing() { setPendingKey(null) }

  function discardAndSwitch() {
    if (dialogSaving) return
    const nextKey = pendingKey
    setPendingKey(null)
    setActiveKey(nextKey) // unmounts the current form, which discards its own local state for free
  }

  async function saveAndContinue() {
    if (dialogSaving || pendingKey === null) return
    const guard = formGuardRef.current
    const targetKey = pendingKey
    setDialogSaving(true)
    let ok = false
    try {
      ok = guard ? await guard.save() : false
    } catch {
      ok = false
    } finally {
      setDialogSaving(false)
    }
    setPendingKey(null)
    // A failed save (validation or the API) leaves the owner on the current category with their edits
    // intact, and the form's own existing error feedback (inline field errors or a toast) already
    // explains why — nothing further is shown here.
    if (ok) setActiveKey(targetKey)
  }

  let content
  if (active.key === 'general') content = <GeneralSettingsForm formGuardRef={formGuardRef} />
  else if (active.key === 'orders-delivery') content = <OrderDeliverySettingsForm formGuardRef={formGuardRef} />
  else if (active.key === 'notifications') content = <NotificationSettingsForm formGuardRef={formGuardRef} />
  else if (active.key === 'security-system') {
    content = <div className="adm-settings-subsection adm-settings-first">
      <h3>Change Password</h3>
      <p className="adm-muted">Updates the password for the account you are signed in as. You stay signed in on this device.</p>
      <ChangePasswordForm formGuardRef={formGuardRef} />
    </div>
  } else {
    // Placeholder only — no persistence exists yet for this category, so no inputs, toggles or save
    // actions are shown here. Nothing to register: active.hasForm is falsy for this category, so
    // requestSwitch above never reads whatever the ref still holds from a previously active form.
    content = <EmptyState icon={active.icon} title={`${active.label} is not configured yet`} message="This section will let you manage these settings in a future update. Nothing here can be changed yet." />
  }

  return <div className="adm-settings-page">
    <div className="adm-page-head"><div><h1>Settings</h1><p>Business-wide configuration for Janai.</p></div></div>
    <div className="adm-settings-layout">
      <nav className="adm-settings-nav" aria-label="Settings categories">
        {CATEGORIES.map((category) => <button type="button" key={category.key} className={`adm-settings-nav-item${category.key === activeKey ? ' active' : ''}`} aria-current={category.key === activeKey ? 'page' : undefined} onClick={() => requestSwitch(category.key)}>
          <category.icon size={16} />{category.label}
        </button>)}
      </nav>
      <section className="adm-panel adm-settings-content">
        <h2 className="adm-modal-section-title">{active.label}</h2>
        <p className="adm-muted">{active.description}</p>
        {content}
      </section>
    </div>
    <SettingsNavGuardDialog
      open={pendingKey !== null}
      saving={dialogSaving}
      onStay={stayEditing}
      onDiscard={discardAndSwitch}
      onSaveAndContinue={saveAndContinue}
    />
  </div>
}
