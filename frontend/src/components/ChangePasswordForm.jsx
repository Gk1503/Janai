import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { Field } from './Forms'

// Mirrors the backend rule in controllers/authController.js (changePassword) exactly — the backend stays
// authoritative and nothing stronger is invented here, so the form can never reject a password the API
// would have accepted.
export const MIN_PASSWORD_LENGTH = 8

const blankForm = () => ({ currentPassword: '', newPassword: '', confirmPassword: '' })

// Pure, exported so the rules can be unit-tested without rendering or hitting the network.
export function validateChangePasswordForm(form) {
  const errors = {}
  if (!form.currentPassword) errors.currentPassword = 'Enter your current password.'
  if (!form.newPassword) errors.newPassword = 'Enter a new password.'
  else if (form.newPassword.length < MIN_PASSWORD_LENGTH) errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  else if (form.newPassword === form.currentPassword) errors.newPassword = 'Choose a password different from your current one.'
  if (!form.confirmPassword) errors.confirmPassword = 'Re-enter your new password.'
  else if (form.newPassword && form.newPassword !== form.confirmPassword) errors.confirmPassword = 'The new passwords do not match.'
  return errors
}

function PasswordField({ label, name, value, onChange, error, autoComplete, hint }) {
  const [visible, setVisible] = useState(false)
  return <Field label={label} required error={error} hint={hint}>
    <span className="adm-password-row">
      <input
        type={visible ? 'text' : 'password'}
        name={name}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="adm-icon-button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  </Field>
}

/**
 * Change-password form for the signed-in account, used by the owner (Settings → Security & System) and
 * by staff (/admin/account). Both go through the one existing endpoint, POST /auth/change-password,
 * which authorises by session alone — so this component needs no role logic of its own.
 *
 * Passwords live in component state only for the duration of the request: never written to
 * localStorage/sessionStorage, never put in a URL, and never logged.
 */
export default function ChangePasswordForm() {
  const { refreshUser } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState(blankForm())
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    const nextErrors = validateChangePasswordForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    try {
      const { data } = await api.post('/auth/change-password', form)
      // Cleared immediately on success so the plaintext does not sit in component state afterwards.
      setForm(blankForm())
      setErrors({})
      setError('')
      // Keeps the session's user in sync (the endpoint also clears mustChangePassword). The JWT itself
      // stays valid — the session is not invalidated by a password change, so no re-login is needed.
      await refreshUser()
      toast(data?.message || 'Password updated.')
    } catch (requestError) {
      // getApiError surfaces the backend's own message ("Your current password is incorrect.",
      // "Choose a password different from your current one.", …). The submitted values are never logged.
      setError(getApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  const incomplete = !form.currentPassword || !form.newPassword || !form.confirmPassword

  return <form className="adm-settings-form adm-password-form" onSubmit={submit} noValidate>
    <div className="form-grid">
      <PasswordField
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        value={form.currentPassword}
        onChange={(value) => set('currentPassword', value)}
        error={errors.currentPassword}
      />
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        value={form.newPassword}
        onChange={(value) => set('newPassword', value)}
        error={errors.newPassword}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, and different from your current password.`}
      />
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        value={form.confirmPassword}
        onChange={(value) => set('confirmPassword', value)}
        error={errors.confirmPassword}
      />
    </div>

    {error && <div className="inline-error" role="alert">{error}</div>}

    <div className="adm-settings-actions">
      <button type="submit" className="button button-primary" disabled={saving || incomplete}>
        <KeyRound size={15} />{saving ? 'Updating…' : 'Update Password'}
      </button>
    </div>
  </form>
}
