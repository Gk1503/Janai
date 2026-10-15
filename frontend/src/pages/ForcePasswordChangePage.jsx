import { useState } from 'react'
import { ArrowRight, LogOut } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { AuthFrame } from './AccountPages'

// Shown instead of the whole panel while the account still has a temporary password. Passwords live only in
// component state for the duration of the request and are never written to browser storage.
export default function ForcePasswordChangePage() {
  const { user, refreshUser, logout } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (form.newPassword.length < 8) return setError('Your new password must be at least 8 characters.')
    if (form.newPassword === form.currentPassword) return setError('Choose a password different from your temporary one.')
    if (form.newPassword !== form.confirmPassword) return setError('The new passwords do not match.')
    setBusy(true)
    try {
      await api.post('/auth/change-password', form)
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      await refreshUser() // clears mustChangePassword, so the route guard lets the user through
      toast('Password updated.')
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
    return undefined
  }

  return <AuthFrame standalone eyebrow="JANAI OPERATIONS" title="Choose a new password" description={`Hi ${user?.firstName || 'there'}, you signed in with a temporary password. Set your own password to continue.`}>
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="field"><span>Temporary password</span><input required type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} /></label>
      <label className="field"><span>New password</span><input required type="password" autoComplete="new-password" minLength={8} value={form.newPassword} onChange={set('newPassword')} /></label>
      <label className="field"><span>Confirm new password</span><input required type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} /></label>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button className="button button-primary button-full" disabled={busy || !form.currentPassword || !form.newPassword || !form.confirmPassword}>{busy ? 'Saving…' : 'Save new password'}<ArrowRight size={15} /></button>
      <button type="button" className="auth-switch" onClick={logout}><LogOut size={14} /> Sign out</button>
    </form>
  </AuthFrame>
}
