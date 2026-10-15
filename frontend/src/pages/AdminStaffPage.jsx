import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, Search, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader, Modal } from '../components/UI'
import PermissionGrid from '../components/PermissionGrid'
import StaffFormModal from '../components/StaffFormModal'
import TemporaryPasswordField from '../components/TemporaryPasswordField'
import { ROLE_PRESETS, presetKeyFor } from '../utils/permissions'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never')

function ModalActions({ onCancel, children }) {
  return <div className="adm-modal-foot"><button type="button" className="button button-outline" onClick={onCancel}>Cancel</button>{children}</div>
}

// Shown once after creating or resetting: the only moment the owner can read the temporary password, because it
// comes from the form they just filled in. It is never retrieved from the server or kept after closing.
function HandoverNotice({ title, loginId, temporaryPassword, onClose }) {
  return <Modal title={title} onClose={onClose}>
    <p className="adm-modal-text">Give these sign-in details to <strong>{loginId}</strong> through a secure channel.</p>
    <dl className="adm-detail-list">
      <div className="adm-detail-row"><dt>Login ID</dt><dd><code>{loginId}</code></dd></div>
      <div className="adm-detail-row"><dt>Temporary password</dt><dd><code>{temporaryPassword}</code></dd></div>
    </dl>
    <p className="adm-note">They must choose a new password the first time they sign in, and cannot use any part of the panel until they do. This password cannot be shown again.</p>
    <div className="adm-modal-foot"><button type="button" className="button button-primary" onClick={onClose}>Done</button></div>
  </Modal>
}

function PermissionsModal({ staff, onClose, onSaved }) {
  const [permissions, setPermissions] = useState(staff.permissions)
  const [preset, setPreset] = useState(staff.preset.key)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.patch(`/admin/staff/${staff._id}/permissions`, { permissions, preset: presetKeyFor(preset, permissions) })
      onSaved(data.staff, 'Permissions updated. They apply on the next request.')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`Permissions · ${staff.fullName}`} onClose={onClose} wide>
    <div className="adm-status-row">
      <label className="sort-select"><select value={preset} onChange={(event) => { setPreset(event.target.value); setPermissions([...ROLE_PRESETS[event.target.value].permissions]) }} aria-label="Apply a role preset">
        {Object.entries(ROLE_PRESETS).map(([key, item]) => <option key={key} value={key}>Apply preset: {item.label}</option>)}
      </select></label>
    </div>
    <PermissionGrid value={permissions} onChange={setPermissions} />
    <p className="adm-muted">Staff &amp; Access can never be granted; only the owner manages staff. Removing a permission blocks it immediately.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <ModalActions onCancel={onClose}><button type="button" className="button button-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save permissions'}</button></ModalActions>
  </Modal>
}

function ResetPasswordModal({ staff, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post(`/admin/staff/${staff._id}/reset-password`, { temporaryPassword: password })
      onDone(data.staff, password)
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`Reset password · ${staff.fullName}`} onClose={onClose}>
    <form className="adm-product-form" onSubmit={submit}>
      <p className="adm-modal-text">Set a new temporary password for <strong>{staff.loginId}</strong>. Their current password stops working and they must choose their own at next sign-in. The existing password cannot be viewed.</p>
      <TemporaryPasswordField value={password} onChange={setPassword} label="New temporary password" />
      {error && <div className="form-error" role="alert">{error}</div>}
      <ModalActions onCancel={onClose}><button type="submit" className="button button-primary" disabled={busy || !password}>{busy ? 'Resetting…' : 'Reset password'}</button></ModalActions>
    </form>
  </Modal>
}

function StatusModal({ staff, onClose, onSaved }) {
  const activating = !staff.isActive
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.patch(`/admin/staff/${staff._id}/status`, { isActive: activating })
      onSaved(data.staff, data.message)
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={activating ? 'Reactivate account?' : 'Deactivate account?'} onClose={onClose}>
    <p className="adm-modal-text">{activating
      ? <>Allow <strong>{staff.fullName}</strong> ({staff.loginId}) to sign in again with their current permissions.</>
      : <>Deactivating <strong>{staff.fullName}</strong> ({staff.loginId}) blocks their sign-in and every request they make <strong>immediately</strong>, including from a session that is already open. You can reactivate the account later.</>}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <ModalActions onCancel={onClose}><button type="button" className={`button ${activating ? 'button-primary' : 'button-danger'}`} disabled={busy} onClick={confirm}>{busy ? 'Saving…' : activating ? 'Reactivate' : 'Deactivate'}</button></ModalActions>
  </Modal>
}

export default function AdminStaffPage() {
  const toast = useToast()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [presetFilter, setPresetFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dialog, setDialog] = useState(null) // { type: 'create' | 'edit' | 'permissions' | 'reset' | 'status' | 'handover', ... }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/staff')
      setStaff(data.staff)
      setError('')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return staff.filter((member) => (presetFilter === 'all' || member.preset.key === presetFilter)
      && (statusFilter === 'all' || (statusFilter === 'active') === member.isActive)
      && (!needle || member.fullName.toLowerCase().includes(needle) || member.loginId.toLowerCase().includes(needle)))
  }, [staff, search, presetFilter, statusFilter])
  const filtersActive = Boolean(search.trim()) || presetFilter !== 'all' || statusFilter !== 'all'

  function saved(updated, message, extra) {
    setStaff((current) => (current.some((member) => member._id === updated._id) ? current.map((member) => (member._id === updated._id ? updated : member)) : [updated, ...current]))
    if (message) toast(message)
    setDialog(extra || null)
    load() // re-read from the server so the table always shows stored state
  }

  return <div className="adm-products-page adm-orders-page">
    <div className="adm-page-head">
      <div><h1>Staff &amp; Access</h1><p>Create staff accounts and control exactly what each person can see and do.</p></div>
      <button type="button" className="button button-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={15} />Add Staff</button>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or login ID…" aria-label="Search staff" /></label>
        <label className="sort-select"><select value={presetFilter} onChange={(event) => setPresetFilter(event.target.value)} aria-label="Filter by role"><option value="all">All roles</option>{Object.entries(ROLE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>
        <label className="sort-select"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={() => { setSearch(''); setPresetFilter('all'); setStatusFilter('all') }}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading && !staff.length ? <Loader label="Loading staff" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !staff.length ? (
        <>
          <EmptyState icon={ShieldCheck} title="No staff accounts yet" message="Add a staff member and choose what they are allowed to do." />
          <div className="adm-empty-action"><button type="button" className="button button-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={15} />Add Staff</button></div>
        </>
      ) : !rows.length ? (
        <EmptyState title="No staff found" message="Try changing your search or filters." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th>Status</th><th>Created</th><th>Last login</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((member) => <tr key={member._id}>
                <td data-label="Name" className="adm-col-customer"><span className="adm-cell-stack"><strong>{member.fullName}</strong><small>{member.email || member.phone || ' '}</small></span></td>
                <td data-label="Login ID"><code>{member.loginId}</code></td>
                <td data-label="Role"><span className="adm-cell-stack"><span>{member.preset.label}</span><small>{member.permissions.length} permission{member.permissions.length === 1 ? '' : 's'}</small></span></td>
                <td data-label="Status"><span className="adm-cell-stack"><span className={`status-pill ${member.isActive ? 'status-delivered' : 'status-cancelled'}`}>{member.isActive ? 'Active' : 'Inactive'}</span>{member.mustChangePassword && <small>Password change pending</small>}</span></td>
                <td data-label="Created">{formatDate(member.createdAt)}</td>
                <td data-label="Last login">{formatDateTime(member.lastLoginAt)}</td>
                <td data-label="Actions" className="adm-col-actions"><span className="adm-row-actions">
                  <button type="button" className="table-action" onClick={() => setDialog({ type: 'edit', staff: member })}><Pencil size={14} />Edit</button>
                  <button type="button" className="table-action" onClick={() => setDialog({ type: 'permissions', staff: member })}><ShieldCheck size={14} />Permissions</button>
                  <button type="button" className="table-action" onClick={() => setDialog({ type: 'reset', staff: member })}><KeyRound size={14} />Reset password</button>
                  <button type="button" className={`table-action${member.isActive ? ' danger' : ''}`} onClick={() => setDialog({ type: 'status', staff: member })}>{member.isActive ? <><UserX size={14} />Deactivate</> : <><UserCheck size={14} />Reactivate</>}</button>
                </span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {dialog?.type === 'create' && <StaffFormModal staff={null} onClose={() => setDialog(null)} onSaved={({ staff: created, message, temporaryPassword }) => saved(created, message, { type: 'handover', title: 'Account created', loginId: created.loginId, temporaryPassword })} />}
    {dialog?.type === 'edit' && <StaffFormModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={({ staff: updated, message }) => saved(updated, message)} />}
    {dialog?.type === 'permissions' && <PermissionsModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={(updated, message) => saved(updated, message)} />}
    {dialog?.type === 'reset' && <ResetPasswordModal staff={dialog.staff} onClose={() => setDialog(null)} onDone={(updated, password) => saved(updated, 'Password reset.', { type: 'handover', title: 'Password reset', loginId: updated.loginId, temporaryPassword: password })} />}
    {dialog?.type === 'status' && <StatusModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={(updated, message) => saved(updated, message)} />}
    {dialog?.type === 'handover' && <HandoverNotice title={dialog.title} loginId={dialog.loginId} temporaryPassword={dialog.temporaryPassword} onClose={() => setDialog(null)} />}
  </div>
}
