import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ShieldCheck, Truck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { isDeliveryStaff } from '../utils/permissions'
import { Field, PhoneInput } from '../components/Forms'

// Dedicated OTP login for delivery staff. Deliberately not AuthFrame (that wrapper's copy and photo are
// grocery-shopper marketing, not appropriate for a delivery partner) but reuses every shared form/OTP
// style (.auth-form, .phone-input, .otp-input-row, .button, .form-error) so it still looks and behaves
// like the rest of Janai. Mirrors LoginPage's OTP flow exactly; only the endpoints and copy differ.
export default function DeliveryLoginPage() {
  const { user, loginWithDeliveryOtp } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState(Array(6).fill(''))
  const [otpStep, setOtpStep] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const otpRefs = useRef([])

  // Already signed in as an eligible rider? Skip straight to the dashboard (same pattern as
  // AdminLoginPage redirecting an already-signed-in owner/staff member away from the login form).
  useEffect(() => {
    if (isDeliveryStaff(user)) navigate('/delivery', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    if (!cooldown) return undefined
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function sendOtp(resend = false) {
    if (busy) return
    setError('')
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter a valid 10-digit Indian mobile number.'); return }
    setBusy(true)
    try {
      const endpoint = resend ? '/auth/resend-delivery-otp' : '/auth/send-delivery-otp'
      const { data } = await api.post(endpoint, { mobile })
      setOtpStep(true)
      setOtp(Array(6).fill(''))
      setCooldown(30)
      if (!resend) window.setTimeout(() => otpRefs.current[0]?.focus(), 0)
      toast(data.message || (resend ? 'A new OTP has been sent.' : 'OTP sent successfully.'))
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    if (busy) return
    const code = otp.join('')
    if (code.length !== 6) { setError('Enter the complete 6-digit OTP.'); return }
    setBusy(true)
    setError('')
    try {
      const rider = await loginWithDeliveryOtp({ mobile, otp: code })
      toast(`Welcome back, ${rider.firstName || 'partner'}.`)
      navigate('/delivery', { replace: true })
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  function editOtp(index, value) {
    const digits = value.replace(/\D/g, '')
    if (digits.length > 1) {
      const pasted = digits.slice(0, 6).split('')
      setOtp((current) => current.map((digit, position) => pasted[position] ?? digit))
      otpRefs.current[Math.min(pasted.length, 5)]?.focus()
      return
    }
    setOtp((current) => current.map((digit, position) => position === index ? digits : digit))
    if (digits && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function otpKeyDown(index, event) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function changeMobile() {
    setOtpStep(false)
    setOtp(Array(6).fill(''))
    setCooldown(0)
    setError('')
  }

  return <div className="rider-auth-page">
    <div className="rider-auth-card">
      <Link className="brand-logo rider-auth-logo" to="/" aria-label="Janai home"><img src="/Janai-logo.jpg" alt="Janai" /></Link>
      <span className="eyebrow rider-auth-eyebrow"><Truck size={14} />JANAI DELIVERY PARTNERS</span>
      <h1 className="rider-auth-title">{otpStep ? 'Verify OTP' : 'Delivery Partner Login'}</h1>
      <p className="rider-auth-description">{otpStep ? `OTP sent to +91 ${mobile}` : 'Sign in with your registered mobile number to see your assigned deliveries.'}</p>

      {otpStep ? <form className="auth-form" onSubmit={verifyOtp}>
        <p className="otp-instruction">Enter the 6-digit code sent to <strong>+91 {mobile}</strong>.</p>
        <div className="otp-input-row" role="group" aria-label="6-digit one-time password">
          {otp.map((digit, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element }} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`OTP digit ${index + 1}`} maxLength={1} value={digit} onChange={(event) => editOtp(index, event.target.value)} onKeyDown={(event) => otpKeyDown(index, event)} onPaste={(event) => { event.preventDefault(); editOtp(index, event.clipboardData.getData('text')) }} />)}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary button-full" disabled={busy || otp.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify & Sign In'}<ArrowRight size={16} /></button>
        <div className="otp-actions">
          <button type="button" className="text-link" disabled={busy || cooldown > 0} onClick={() => sendOtp(true)}>{cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}</button>
          <button type="button" className="text-link" disabled={busy} onClick={changeMobile}>Change mobile number</button>
        </div>
      </form> : <form className="auth-form" onSubmit={(event) => { event.preventDefault(); sendOtp(false) }}>
        <Field label="Registered Mobile Number" required><PhoneInput value={mobile} onChange={(value) => { setMobile(value); setError('') }} required /></Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary button-full" disabled={busy || mobile.length !== 10}>{busy ? 'Sending OTP…' : 'Send OTP'}<ArrowRight size={16} /></button>
        <p className="auth-secure"><ShieldCheck size={14} />Only active delivery staff accounts can sign in here.</p>
      </form>}

      <p className="rider-auth-footer">Not a delivery partner? <Link to="/login">Customer sign in</Link> · <Link to="/admin/login">Admin sign in</Link></p>
    </div>
  </div>
}
