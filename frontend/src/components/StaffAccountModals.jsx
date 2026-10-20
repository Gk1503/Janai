import { useState } from 'react'
import api, { getApiError } from '../services/api'
import { Modal } from './UI'
import PermissionGrid from './PermissionGrid'
import TemporaryPasswordField from './TemporaryPasswordField'
import { ROLE_PRESETS, presetKeyFor } from '../utils/permissions'

export function ModalActions({ onCancel, children }) {
  return <div className="adm-modal-foot"><button type="button" className="button button-outline" onClick={onCancel}>Cancel</button>{children}</div>
}

// Shown once after creating or resetting: the only moment the owner can read the temporary password, because it
// comes from the form they just filled in. It is never retrieved from the server or kept after closing.
export function HandoverNotice({ title, loginId, temporaryPassword, onClose }) {
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

export function PermissionsModal({ staff, onClose, onSaved }) {
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

export function ResetPasswordModal({ staff, onClose, onDone }) {
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

export function StatusModal({ staff, onClose, onSaved }) {
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
