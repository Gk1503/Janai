import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, Search, ShieldCheck, UserCheck, UserRoundCheck, UserX } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { EmptyState, Loader } from '../components/UI'
import StaffFormModal from '../components/StaffFormModal'
import { HandoverNotice, PermissionsModal, ResetPasswordModal, StatusModal } from '../components/StaffAccountModals'

const DELIVERY_PRESET = 'delivery_staff'
const DELIVERY_VIEW_PERMISSION = 'delivery:view'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never')

// Delivery Staff is a focused view over the same staff accounts Staff & Access manages. Every account
// created here gets only delivery:view/delivery:update by default. The list is filtered by who currently
// HOLDS delivery:view (every delivery permission requires it) rather than by the staffRole preset label,
// because granting an account extra permissions (e.g. product pricing) relabels it "Custom Role" — a
// label-based filter would make the account vanish from this page the moment it's customised.
export default function AdminDeliveryStaffPage() {
  const toast = useToast()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dialog, setDialog] = useState(null) // { type: 'create' | 'edit' | 'permissions' | 'reset' | 'status' | 'handover', ... }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/staff', { params: { permission: DELIVERY_VIEW_PERMISSION } })
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
    return staff.filter((member) => (statusFilter === 'all' || (statusFilter === 'active') === member.isActive)
      && (!needle || member.fullName.toLowerCase().includes(needle) || member.loginId.toLowerCase().includes(needle)))
  }, [staff, search, statusFilter])
  const filtersActive = Boolean(search.trim()) || statusFilter !== 'all'

  function saved(updated, message, extra) {
    setStaff((current) => (current.some((member) => member._id === updated._id) ? current.map((member) => (member._id === updated._id ? updated : member)) : [updated, ...current]))
    if (message) toast(message)
    setDialog(extra || null)
    load() // re-read from the server so the table always shows stored state
  }

  return <div className="adm-products-page adm-orders-page">
    <div className="adm-page-head">
      <div><h1>Delivery Staff</h1><p>Create delivery staff accounts and control exactly what each rider can see and do.</p></div>
      <button type="button" className="button button-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={15} />Add Delivery Staff</button>
    </div>

    <section className="adm-panel adm-toolbar-panel">
      <div className="adm-toolbar">
        <label className="shop-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or login ID…" aria-label="Search delivery staff" /></label>
        <label className="sort-select"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        {filtersActive && <button type="button" className="filter-reset" onClick={() => { setSearch(''); setStatusFilter('all') }}>Clear filters</button>}
      </div>
    </section>

    <section className="adm-panel">
      {loading && !staff.length ? <Loader label="Loading delivery staff" /> : error ? (
        <div className="inline-error">{error}<button className="text-link" onClick={load}>Retry</button></div>
      ) : !staff.length ? (
        <>
          <EmptyState icon={UserRoundCheck} title="No delivery staff yet" message="Add a delivery staff member — they'll get delivery access only, unless you explicitly grant more." />
          <div className="adm-empty-action"><button type="button" className="button button-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={15} />Add Delivery Staff</button></div>
        </>
      ) : !rows.length ? (
        <EmptyState title="No delivery staff found" message="Try changing your search or filters." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table adm-responsive-table">
            <thead><tr><th>Name</th><th>Login ID</th><th>Access</th><th>Status</th><th>Added</th><th>Last login</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((member) => <tr key={member._id}>
                <td data-label="Name" className="adm-col-customer"><span className="adm-cell-stack"><strong>{member.fullName}</strong><small>{member.email || member.phone || ' '}</small></span></td>
                <td data-label="Login ID"><code>{member.loginId}</code></td>
                <td data-label="Access"><span className="adm-cell-stack"><span>{member.preset.key === DELIVERY_PRESET ? 'Delivery Staff' : 'Customised'}</span><small>{member.permissions.length} permission{member.permissions.length === 1 ? '' : 's'}</small></span></td>
                <td data-label="Status"><span className="adm-cell-stack"><span className={`status-pill ${member.isActive ? 'status-delivered' : 'status-cancelled'}`}>{member.isActive ? 'Active' : 'Inactive'}</span>{member.mustChangePassword && <small>Password change pending</small>}</span></td>
                <td data-label="Added">{formatDate(member.createdAt)}</td>
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

    {dialog?.type === 'create' && <StaffFormModal staff={null} fixedPreset={DELIVERY_PRESET} onClose={() => setDialog(null)} onSaved={({ staff: created, message, temporaryPassword }) => saved(created, message, { type: 'handover', title: 'Account created', loginId: created.loginId, temporaryPassword })} />}
    {dialog?.type === 'edit' && <StaffFormModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={({ staff: updated, message }) => saved(updated, message)} />}
    {dialog?.type === 'permissions' && <PermissionsModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={(updated, message) => saved(updated, message)} />}
    {dialog?.type === 'reset' && <ResetPasswordModal staff={dialog.staff} onClose={() => setDialog(null)} onDone={(updated, password) => saved(updated, 'Password reset.', { type: 'handover', title: 'Password reset', loginId: updated.loginId, temporaryPassword: password })} />}
    {dialog?.type === 'status' && <StatusModal staff={dialog.staff} onClose={() => setDialog(null)} onSaved={(updated, message) => saved(updated, message)} />}
    {dialog?.type === 'handover' && <HandoverNotice title={dialog.title} loginId={dialog.loginId} temporaryPassword={dialog.temporaryPassword} onClose={() => setDialog(null)} />}
  </div>
}
